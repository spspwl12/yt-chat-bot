const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const configManager = require('./config-manager.js');
const { cfg } = configManager;

class AntiMacroDetector {
    constructor(maxHistory = 15, expireMs = 30 * 60 * 1000, maxUsers = 5000) {
        this.maxHistory = (cfg.stats && cfg.stats.anti_macro_max_history) || maxHistory;
        this.expireMs = (cfg.stats && cfg.stats.anti_macro_expire_ms) || expireMs;
        this.maxUsers = (cfg.stats && cfg.stats.anti_macro_max_users) || maxUsers;
        this.userHistory = new Map(); // channelId -> { lastSeen: number, messages: [] }
        this._cleanupInterval = null;
    }

    _ensureTimer() {
        if (!this._cleanupInterval) {
            this._cleanupInterval = setInterval(() => this.cleanup(), 10 * 60 * 1000);
            if (this._cleanupInterval && this._cleanupInterval.unref) {
                this._cleanupInterval.unref();
            }
        }
    }

    normalizeText(text) {
        if (!text || typeof text !== 'string') return '';
        return text
            .normalize('NFKC')
            .trim()
            .toLowerCase()
            .replace(/[\u200B-\u200D\u200E\u200F\uFEFF\u0000-\u001F\uFE00-\uFE0F\u202A-\u202E\u2060-\u206F]/g, '')
            .replace(/\s+/g, ' ');
    }

    getCoreText(normText) {
        if (!normText) return '';
        return normText.replace(/(.)\1{2,}/gu, '$1$1');
    }

    getStrippedText(normText) {
        if (!normText) return '';
        return normText
            .replace(/[\d\s\p{P}\p{S}\p{Emoji_Presentation}\p{Extended_Pictographic}]+/gu, '')
            .trim();
    }

    getTokenBag(normText) {
        if (!normText) return '';
        const tokens = normText
            .split(/\s+/)
            .map(t => t.replace(/[\p{P}\p{S}]+/gu, '').trim())
            .filter(t => t.length > 0);
        if (tokens.length === 0) return '';
        return tokens.sort().join(' ');
    }

    checkAndRecord(channelId, text, timestamp) {
        if (!channelId || typeof channelId !== 'string') return false;

        this._ensureTimer();

        const norm = this.normalizeText(text);
        const core = this.getCoreText(norm);
        const stripped = this.getStrippedText(norm);
        const tokenBag = this.getTokenBag(norm);
        const now = typeof timestamp === 'number' && !isNaN(timestamp) ? timestamp : Date.now();

        let record = this.userHistory.get(channelId);
        if (!record) {
            // LRU capacity protection
            if (this.userHistory.size >= this.maxUsers) {
                const oldestKey = this.userHistory.keys().next().value;
                if (oldestKey) this.userHistory.delete(oldestKey);
            }
            record = { lastSeen: now, messages: [] };
        } else {
            // Refresh position in Map for true LRU
            this.userHistory.delete(channelId);
        }
        record.lastSeen = now;
        this.userHistory.set(channelId, record);

        const msgs = record.messages;
        const prevMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const intervalMs = prevMsg ? (now - prevMsg.timestamp) : 0;

        const currentItem = {
            norm,
            core,
            stripped,
            tokenBag,
            timestamp: now,
            interval: intervalMs < 0 ? 0 : intervalMs
        };

        if (msgs.length === 0) {
            msgs.push(currentItem);
            return false;
        }

        // history 배열 스프레드 복사 없이 직접 msgs 참조로 평가
        const isAbuse = this._evaluatePatterns(msgs, currentItem);

        msgs.push(currentItem);
        if (msgs.length > this.maxHistory) {
            msgs.shift();
        }

        return isAbuse;
    }

    _evaluatePatterns(history, currentItem) {
        // history는 msgs 배열 (currentItem 미포함), len은 history + currentItem 기준
        const histLen = history.length; // currentItem 제외한 기존 메시지 수
        const len = histLen + 1;        // currentItem 포함 논리적 len
        if (histLen < 1) return false;

        const currentNorm = currentItem.norm;
        const currentCore = currentItem.core;
        const currentStripped = currentItem.stripped;
        const currentTokenBag = currentItem.tokenBag;
        const currentInterval = currentItem.interval;

        // 자주 참조하는 직전 메시지 직접 접근 (배열 전체 구성 없이)
        const prev1 = history[histLen - 1]; // len-2 위치
        const prev2 = histLen >= 2 ? history[histLen - 2] : null; // len-3 위치
        const prev3 = histLen >= 3 ? history[histLen - 3] : null;

        // ── 1. 연속 동일 메시지 / 골격 / 토큰 반복 감지 ──
        // (1) 2회 연속 동일 메시지 (모든 메시지 대상) - 배열 없이 직접 prev1 참조
        if (currentCore === prev1.core) {
            // 3초 미만의 단문 반응(예: 자연스러운 웃음 연타) 2회차는 허용하되, 3회 이상 연속이거나 3초 이상 간격이면 즉시 차단
            const isBurst = currentInterval < 3000 && currentCore.length <= 5;
            if (!isBurst || (prev2 && prev1.core === prev2.core)) {
                return true;
            }
        }

        // (2) 2회 연속 동일 골격(stripped) 템플릿
        if (currentStripped && currentStripped.length >= 2 && currentStripped === prev1.stripped) {
            const isBurst = currentInterval < 3000 && currentCore.length <= 5;
            if (!isBurst || (prev2 && currentStripped === prev2.stripped)) {
                return true;
            }
        }

        // (3) 2회 연속 단어 셔플 (2개 이상 어절)
        if (currentTokenBag && prev1.tokenBag && currentTokenBag === prev1.tokenBag) {
            // 어절이 2개 이상인지 확인 (공백이 존재하면 2개 이상)
            if (currentNorm.indexOf(' ') !== -1) {
                return true;
            }
        }

        // ── 2. 다주기 순환 매크로 (Cyclic Rotation: P = 2, 3, 4, 5) ──
        for (let p = 2; p <= 5; p++) {
            if (len < 2 * p) break;
            // history의 마지막 2*p-1개 + currentItem 으로 순환 검사
            // history 인덱스: [histLen - (2p-1), ..., histLen-1] + currentItem
            const base = histLen - (2 * p - 1); // 첫 인덱스
            if (base < 0) continue;

            // core 순환: history[base..histLen-1] + currentItem
            // 앞쪽 p개: history[base..base+p-2] + history[histLen-p+1..histLen-1]?
            // 실제로: 전체 2p 길이 = history[base..histLen-1](길이 2p-1) + currentItem
            let coreMatch = true;
            let strippedMatch = true;
            const hasStripped = currentStripped && currentStripped.length >= 2;

            for (let j = 0; j < p; j++) {
                // j번째 vs j+p번째
                const idxA = base + j;          // history 인덱스
                const idxB = base + j + p;      // history 인덱스 or currentItem
                const cA = idxA < histLen ? history[idxA].core : currentCore;
                const cB = idxB < histLen ? history[idxB].core : currentCore;
                if (cA !== cB) { coreMatch = false; }

                if (hasStripped) {
                    const sA = idxA < histLen ? history[idxA].stripped : currentStripped;
                    const sB = idxB < histLen ? history[idxB].stripped : currentStripped;
                    if (!sA || sA.length < 2 || sA !== sB) { strippedMatch = false; }
                } else {
                    strippedMatch = false;
                }
            }

            if (coreMatch) {
                // 단일 문구 전체 반복(uniqueCores==1)은 Rule 1에서 이미 처리됨, 2개 이상인 경우만
                let firstCore = base < histLen ? history[base].core : currentCore;
                let allSame = true;
                for (let j = 1; j < p; j++) {
                    const idx = base + j;
                    const c = idx < histLen ? history[idx].core : currentCore;
                    if (c !== firstCore) { allSame = false; break; }
                }
                if (!allSame) return true;
            }
            if (strippedMatch) {
                let firstStripped = base < histLen ? history[base].stripped : currentStripped;
                let allSame = true;
                for (let j = 1; j < p; j++) {
                    const idx = base + j;
                    const s = idx < histLen ? history[idx].stripped : currentStripped;
                    if (!s || s !== firstStripped) { allSame = false; break; }
                }
                if (!allSame) return true;
            }
        }

        // ── 3. 특정 메시지 풀(Pool) 섞기 반복 감지 (슬라이딩 윈도우 unique 카운트) ──
        // history 끝 + currentItem으로 윈도우 구성, slice 없이 카운트
        if (len >= 4) {
            // 최근 4개 unique core
            let set4 = new Set();
            set4.add(currentCore);
            for (let i = histLen - 1; i >= 0 && set4.size <= 3; i--) {
                set4.add(history[i].core);
                if (histLen - i >= 3) break; // 3개만 더 봄 (currentItem 포함 4개)
            }
            // 위 방식보다 명확하게: 뒤에서 min(histLen,3)개 + currentItem
            set4 = new Set();
            set4.add(currentCore);
            const start4 = Math.max(0, histLen - 3);
            for (let i = start4; i < histLen; i++) set4.add(history[i].core);
            if (set4.size <= 2) return true;

            // stripped 4개
            if (currentStripped && currentStripped.length >= 2) {
                let sset4 = new Set();
                sset4.add(currentStripped);
                for (let i = start4; i < histLen; i++) {
                    const s = history[i].stripped;
                    if (s && s.length >= 2) sset4.add(s);
                }
                if (sset4.size === 1 && (histLen - start4 + 1) === 4) return true;
                if (sset4.size <= 2 && (histLen - start4) + 1 === 4) return true;
            }
        }

        if (len >= 6) {
            const start6 = Math.max(0, histLen - 5);
            const set6 = new Set();
            set6.add(currentCore);
            for (let i = start6; i < histLen; i++) set6.add(history[i].core);
            if (set6.size <= 3) return true;

            if (currentStripped && currentStripped.length >= 2) {
                const sset6 = new Set();
                sset6.add(currentStripped);
                let validCount = 1;
                for (let i = start6; i < histLen; i++) {
                    const s = history[i].stripped;
                    if (s && s.length >= 2) { sset6.add(s); validCount++; }
                }
                if (validCount === 6 && sset6.size <= 3) return true;
            }
        }

        if (len >= 8) {
            const start8 = Math.max(0, histLen - 7);
            const set8 = new Set();
            set8.add(currentCore);
            for (let i = start8; i < histLen; i++) set8.add(history[i].core);
            if (set8.size <= 4) return true;

            if (currentStripped && currentStripped.length >= 2) {
                const sset8 = new Set();
                sset8.add(currentStripped);
                let validCount = 1;
                for (let i = start8; i < histLen; i++) {
                    const s = history[i].stripped;
                    if (s && s.length >= 2) { sset8.add(s); validCount++; }
                }
                if (validCount === 8 && sset8.size <= 4) return true;
            }
        }

        if (len >= 10) {
            const start10 = Math.max(0, histLen - 9);
            const set10 = new Set();
            set10.add(currentCore);
            for (let i = start10; i < histLen; i++) set10.add(history[i].core);
            if (set10.size <= 5) return true;
        }

        // ── 4. 특정 메시지 고빈도 점유 (Dominance) 감지 ──
        if (len >= 5) {
            let count5 = 1; // currentItem 포함
            const start5 = Math.max(0, histLen - 4);
            for (let i = start5; i < histLen; i++) {
                if (history[i].core === currentCore) count5++;
            }
            if (count5 >= 3) return true;

            if (currentStripped && currentStripped.length >= 2) {
                let sc5 = 1;
                for (let i = start5; i < histLen; i++) {
                    if (history[i].stripped === currentStripped) sc5++;
                }
                if (sc5 >= 3) return true;
            }
        }

        if (len >= 8) {
            let count8 = 1;
            const start8d = Math.max(0, histLen - 7);
            for (let i = start8d; i < histLen; i++) {
                if (history[i].core === currentCore) count8++;
            }
            if (count8 >= 4) return true;

            if (currentStripped && currentStripped.length >= 2) {
                let sc8 = 1;
                for (let i = start8d; i < histLen; i++) {
                    if (history[i].stripped === currentStripped) sc8++;
                }
                if (sc8 >= 4) return true;
            }
        }

        // ── 5. 시간 간격 기반 매크로 감지 (타이머 기반) ──
        // intervals: history[1..histLen-1]의 interval 값들 + currentItem.interval
        // = [history[1].interval, ..., history[histLen-1].interval, currentInterval]
        const iLen = histLen; // history[0]에는 interval=0(첫 메시지), intervals 개수 = histLen (index 1~histLen-1 of orig) + currentInterval
        // 실제 interval 배열 구성을 최소화: 최근 4개만 필요
        if (histLen >= 3) {
            // recentIntervals: 최근 4개 = history[histLen-3], history[histLen-2], history[histLen-1], currentItem
            const r0 = history[Math.max(0, histLen - 3)].interval;
            const r1 = history[Math.max(0, histLen - 2)].interval;
            const r2 = history[histLen - 1].interval;
            const r3 = currentInterval;
            const recentIntervals = [r0, r1, r2, r3].slice(histLen >= 3 ? 0 : 4 - histLen);
            const k = recentIntervals.length;
            if (k >= 3) {
                const mean = (recentIntervals[0] + recentIntervals[1] + recentIntervals[2] + (k > 3 ? recentIntervals[3] : 0)) / k;
                if (mean >= 5000) {
                    let maxI = recentIntervals[0], minI = recentIntervals[0], sumSq = 0;
                    for (let i = 0; i < k; i++) {
                        const v = recentIntervals[i];
                        if (v > maxI) maxI = v;
                        if (v < minI) minI = v;
                        sumSq += (v - mean) * (v - mean);
                    }
                    const range = maxI - minI;
                    const stdDev = Math.sqrt(sumSq / k);

                    if (range <= 500 || stdDev <= 300) return true;
                    if ((range <= 2500 || stdDev <= 2000) && (currentNorm.length <= 12 || currentCore === prev1.core)) {
                        return true;
                    }
                }
            }
        }

        // (2) 2회 연속 거의 동일 간격 + 동일/반복 텍스트
        if (histLen >= 2) {
            const i1 = history[histLen - 1].interval;
            const i2 = currentInterval;
            if (i1 >= 5000 && i2 >= 5000 && (i1 > i2 ? i1 - i2 : i2 - i1) <= 2000) {
                if (currentCore === prev1.core || (prev2 && currentCore === prev2.core) ||
                    (currentStripped && currentStripped.length >= 2 &&
                        (currentStripped === prev1.stripped || (prev2 && currentStripped === prev2.stripped)))) {
                    return true;
                }
            }
        }

        // (3) 교차 주기 타이머 매크로 (A-B-A-B 간격)
        if (histLen >= 4) {
            const gi1 = history[histLen - 3].interval;
            const gi2 = history[histLen - 2].interval;
            const gi3 = history[histLen - 1].interval;
            const gi4 = currentInterval;
            const d13 = gi1 > gi3 ? gi1 - gi3 : gi3 - gi1;
            const d24 = gi2 > gi4 ? gi2 - gi4 : gi4 - gi2;
            const d12 = gi1 > gi2 ? gi1 - gi2 : gi2 - gi1;
            if (d13 <= 1000 && d24 <= 1000 && (gi1 >= 5000 || gi2 >= 5000) && d12 >= 5000) {
                return true;
            }
        }

        return false;
    }

    cleanup() {
        const now = Date.now();
        for (const [channelId, record] of this.userHistory.entries()) {
            if (now - record.lastSeen > this.expireMs) {
                this.userHistory.delete(channelId);
            }
        }
        if (this.userHistory.size === 0 && this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
    }

    reset() {
        this.userHistory.clear();
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
    }

    close() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        this.userHistory.clear();
    }
}

class StatsTracker {
    constructor() {
        this.db = null;
        this.stmts = {};
        this.antiMacro = null;
        this._stmtCache = new Map();
        this._init();
    }

    _init() {
        if (!cfg.stats || cfg.stats.enable === false) return;

        if (cfg.stats.anti_macro_enable !== false) {
            this.antiMacro = new AntiMacroDetector();
        }

        const rawDbPath = cfg.stats.db_path || '../data/chat_stats.db';
        const dbPath = path.isAbsolute(rawDbPath)
            ? rawDbPath
            : path.resolve(__dirname, rawDbPath);

        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new DatabaseSync(dbPath);

        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');
        this.db.exec('PRAGMA cache_size = -32768;');
        this.db.exec('PRAGMA foreign_keys = ON;');

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id          TEXT    UNIQUE NOT NULL,
                display_name        TEXT,
                total_messages      INTEGER DEFAULT 0,
                total_watch_seconds INTEGER DEFAULT 0,
                active_days         INTEGER DEFAULT 0,
                last_chat_time      INTEGER DEFAULT 0,
                last_chat_date      INTEGER DEFAULT 0,
                updated_at          INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS user_daily_stats (
                user_id       INTEGER NOT NULL,
                date          INTEGER NOT NULL,
                message_count INTEGER DEFAULT 0,
                watch_seconds INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, date),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_users_channel     ON users(channel_id);
            CREATE INDEX IF NOT EXISTS idx_users_total_msg   ON users(total_messages DESC);
            CREATE INDEX IF NOT EXISTS idx_users_total_watch ON users(total_watch_seconds DESC);
            CREATE INDEX IF NOT EXISTS idx_users_active_days ON users(active_days DESC);
            CREATE INDEX IF NOT EXISTS idx_daily_date_msg    ON user_daily_stats(date, message_count DESC);
            CREATE INDEX IF NOT EXISTS idx_daily_date_watch  ON user_daily_stats(date, watch_seconds DESC);
            CREATE INDEX IF NOT EXISTS idx_daily_user_id     ON user_daily_stats(user_id);
        `);

        this._prepareStatements();
        this._purgeExcludedUsers();
    }

    _purgeExcludedUsers() {
        const excludeList = cfg.stats && cfg.stats.exclude_channel_ids;
        if (!Array.isArray(excludeList) || excludeList.length === 0) return;

        const placeholders = excludeList.map(() => '?').join(', ');
        try {
            // user_daily_stats 먼저 삭제 (외래키 참조)
            this.db.prepare(
                `DELETE FROM user_daily_stats WHERE user_id IN (SELECT id FROM users WHERE channel_id IN (${placeholders}))`
            ).run(...excludeList);
            // users 삭제
            const result = this.db.prepare(
                `DELETE FROM users WHERE channel_id IN (${placeholders})`
            ).run(...excludeList);
            if (result.changes > 0) {
                console.log(`[StatsTracker] exclude_channel_ids 계정 ${result.changes}개 DB에서 삭제됨`);
            }
        } catch (err) {
            console.error('[StatsTracker] 제외 계정 삭제 실패:', err.message);
        }
    }

    _prepareStatements() {
        this.stmts.getUserByChannelId = this.db.prepare(
            'SELECT id, channel_id, display_name, total_messages, total_watch_seconds, active_days, last_chat_time, last_chat_date FROM users WHERE channel_id = ?'
        );
        this.stmts.upsertUser = this.db.prepare(`
            INSERT INTO users (channel_id, display_name, total_messages, total_watch_seconds, active_days, last_chat_time, last_chat_date, updated_at)
            VALUES (?, ?, 1, ?, 1, ?, ?, ?)
            ON CONFLICT(channel_id) DO UPDATE SET
                display_name        = excluded.display_name,
                total_messages      = total_messages + 1,
                total_watch_seconds = total_watch_seconds + excluded.total_watch_seconds,
                active_days         = CASE WHEN last_chat_date != excluded.last_chat_date THEN active_days + 1 ELSE active_days END,
                last_chat_time      = excluded.last_chat_time,
                last_chat_date      = excluded.last_chat_date,
                updated_at          = excluded.updated_at
        `);
        this.stmts.getDaily = this.db.prepare(
            'SELECT message_count, watch_seconds FROM user_daily_stats WHERE user_id = ? AND date = ?'
        );
        this.stmts.upsertDaily = this.db.prepare(`
            INSERT INTO user_daily_stats (user_id, date, message_count, watch_seconds) VALUES (?, ?, 1, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET
                message_count = message_count + 1,
                watch_seconds = watch_seconds + excluded.watch_seconds
        `);
        this.stmts.addDailyWatch = this.db.prepare(`
            INSERT INTO user_daily_stats (user_id, date, message_count, watch_seconds) VALUES (?, ?, 0, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET watch_seconds = watch_seconds + excluded.watch_seconds
        `);
        this.stmts.rankTotalMessages = this.db.prepare('SELECT COUNT(*) + 1 AS rank FROM users WHERE total_messages > ?');
        this.stmts.rankTotalWatch = this.db.prepare('SELECT COUNT(*) + 1 AS rank FROM users WHERE total_watch_seconds > ?');
        this.stmts.rankTodayMessages = this.db.prepare('SELECT COUNT(*) + 1 AS rank FROM user_daily_stats WHERE date = ? AND message_count > ?');
        this.stmts.rankTodayWatch = this.db.prepare('SELECT COUNT(*) + 1 AS rank FROM user_daily_stats WHERE date = ? AND watch_seconds > ?');
        this.stmts.globalUserSummary = this.db.prepare(`
            SELECT COUNT(*) AS total_users, COALESCE(SUM(total_messages),0) AS total_messages,
                    COALESCE(SUM(total_watch_seconds),0) AS total_watch_seconds FROM users
        `);
        this.stmts.top100MessagesSummary = this.db.prepare(`
            SELECT COALESCE(SUM(total_messages), 0) AS top_messages
            FROM (SELECT total_messages FROM users ORDER BY total_messages DESC LIMIT 100)
        `);
        this.stmts.top100WatchSummary = this.db.prepare(`
            SELECT COALESCE(SUM(total_watch_seconds), 0) AS top_watch_seconds
            FROM (SELECT total_watch_seconds FROM users ORDER BY total_watch_seconds DESC LIMIT 100)
        `);
        this.stmts.globalTodaySummary = this.db.prepare(`
            SELECT COUNT(DISTINCT user_id) AS today_users, COALESCE(SUM(message_count),0) AS today_messages,
                    COALESCE(SUM(watch_seconds),0) AS today_watch_seconds
            FROM user_daily_stats WHERE date = ?
        `);
        this.stmts.getUserDailyHistory = this.db.prepare(
            'SELECT date, message_count, watch_seconds FROM user_daily_stats WHERE user_id = ? ORDER BY date DESC LIMIT 60'
        );
        this.stmts.getTopTotalWatch = this.db.prepare(
            'SELECT display_name, total_watch_seconds FROM users WHERE total_watch_seconds > 0 ORDER BY total_watch_seconds DESC LIMIT ?'
        );
        this.stmts.getTopTotalMessages = this.db.prepare(
            'SELECT display_name, total_messages FROM users WHERE total_messages > 0 ORDER BY total_messages DESC LIMIT ?'
        );
        this.stmts.getTopTodayMessages = this.db.prepare(
            'SELECT u.display_name, d.message_count FROM user_daily_stats d JOIN users u ON d.user_id = u.id WHERE d.date = ? AND d.message_count > 0 ORDER BY d.message_count DESC LIMIT ?'
        );
        this.stmts.getTopTodayWatch = this.db.prepare(
            'SELECT u.display_name, d.watch_seconds FROM user_daily_stats d JOIN users u ON d.user_id = u.id WHERE d.date = ? AND d.watch_seconds > 0 ORDER BY d.watch_seconds DESC LIMIT ?'
        );
    }

    _getPreparedStatement(sql) {
        let stmt = this._stmtCache.get(sql);
        if (!stmt) {
            stmt = this.db.prepare(sql);
            this._stmtCache.set(sql, stmt);
        }
        return stmt;
    }

    getKSTDateInt(timestamp = Date.now()) {
        // KST = UTC+9, 순수 산술 연산으로 Date 객체 최소화
        const kstMs = timestamp + 9 * 3600000;
        const kst = new Date(kstMs);
        // getUTC* 사용 → 내부적으로 UTC 오프셋 재계산 없이 직접 조회
        const y = kst.getUTCFullYear();
        const m = kst.getUTCMonth() + 1;
        const d = kst.getUTCDate();
        return y * 10000 + m * 100 + d;
    }

    getKSTMidnightMs(dateInt) {
        const s = String(dateInt);
        return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), 0, 0, 0) - (9 * 3600000);
    }

    formatDateDisplay(dateInt) {
        if (!dateInt) return '';
        const s = String(dateInt);
        return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    }

    formatWatchTime(seconds) {
        if (!seconds || seconds <= 0) return '0분';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const parts = [];
        if (days > 0) parts.push(days.toLocaleString('ko-KR') + '일');
        if (hours > 0) parts.push(hours + '시간');
        if (mins > 0) parts.push(mins + '분');
        return parts.length === 0 ? secs + '초' : parts.join(' ');
    }

    recordChatMessage(msg) {
        if (!this.db || !msg || typeof msg.channelId !== 'string' || !msg.channelId) return;

        const channelId = msg.channelId;
        const statsCfg = cfg.stats;

        // 제외 목록(봇 계정 등)에 포함된 channel_id는 스탯 집계에서 제외
        // Set으로 캐싱하여 O(1) 조회
        if (!this._excludeSet) {
            const excludeList = statsCfg && statsCfg.exclude_channel_ids;
            this._excludeSet = Array.isArray(excludeList) && excludeList.length > 0
                ? new Set(excludeList) : null;
        }
        if (this._excludeSet && this._excludeSet.has(channelId)) return;

        const displayName = typeof msg.displayName === 'string' ? msg.displayName : '';
        const timestamp = typeof msg.timestamp === 'number' && !isNaN(msg.timestamp) ? msg.timestamp : Date.now();
        const currentDate = this.getKSTDateInt(timestamp);

        // watchThresholdMs: 설정 변경 빈도 낮으므로 캐싱
        if (this._watchThresholdMs === undefined) {
            this._watchThresholdMs = ((statsCfg && statsCfg.watch_threshold_min) || 10) * 60 * 1000;
        }
        const watchThresholdMs = this._watchThresholdMs;

        // 매크로/어뷰징 패턴 감지
        const antiMacroEnabled = !statsCfg || statsCfg.anti_macro_enable !== false;
        let isAbuse = false;
        if (antiMacroEnabled) {
            if (!this.antiMacro) {
                this.antiMacro = new AntiMacroDetector();
            }
            isAbuse = this.antiMacro.checkAndRecord(channelId, msg.text || '', timestamp);
        } else if (this.antiMacro) {
            this.antiMacro.close();
            this.antiMacro = null;
        }

        try {
            this.db.exec('BEGIN TRANSACTION;');
            const user = this.stmts.getUserByChannelId.get(channelId);
            let watchDeltaSec = 0;

            if (user && user.last_chat_time > 0) {
                const diffMs = timestamp - user.last_chat_time;
                if (diffMs > 0 && diffMs <= watchThresholdMs && !isAbuse) {
                    watchDeltaSec = Math.round(diffMs / 1000);
                }
            }

            const upsertResult = this.stmts.upsertUser.run(
                channelId, displayName, watchDeltaSec, timestamp, currentDate, Date.now()
            );

            const userId = user ? user.id : Number(upsertResult.lastInsertRowid);

            if (watchDeltaSec > 0 && user && user.last_chat_date && user.last_chat_date !== currentDate) {
                const midnightMs = this.getKSTMidnightMs(currentDate);
                const yesterdaySec = Math.max(0, Math.min(watchDeltaSec, Math.round((midnightMs - user.last_chat_time) / 1000)));
                const todaySec = Math.max(0, watchDeltaSec - yesterdaySec);
                if (yesterdaySec > 0) this.stmts.addDailyWatch.run(userId, user.last_chat_date, yesterdaySec);
                this.stmts.upsertDaily.run(userId, currentDate, todaySec);
            } else {
                this.stmts.upsertDaily.run(userId, currentDate, watchDeltaSec);
            }
            this.db.exec('COMMIT;');
        } catch (err) {
            try { this.db.exec('ROLLBACK;'); } catch (_) { }
            console.error('[StatsTracker] DB 기록 실패:', err.message);
        }
    }

    getUserStats(channelId, displayName) {
        if (!this.db) return null;

        const currentDate = this.getKSTDateInt();
        const user = this.stmts.getUserByChannelId.get(channelId);
        const userId = user ? user.id : null;
        const daily = userId ? this.stmts.getDaily.get(userId, currentDate) : null;

        const totalMsgs = user ? user.total_messages : 0;
        const totalWatchSec = user ? user.total_watch_seconds : 0;
        const daysCount = user ? user.active_days : 0;
        const todayMsgs = daily ? daily.message_count : 0;
        const todayWatchSec = daily ? daily.watch_seconds : 0;

        const totalRank = this.stmts.rankTotalMessages.get(totalMsgs)?.rank || 1;
        const totalWatchRank = this.stmts.rankTotalWatch.get(totalWatchSec)?.rank || 1;
        const todayRank = this.stmts.rankTodayMessages.get(currentDate, todayMsgs)?.rank || 1;
        const todayWatchRank = this.stmts.rankTodayWatch.get(currentDate, todayWatchSec)?.rank || 1;

        const name = displayName || (user && user.display_name) || '시청자';
        return {
            name,
            totalMsgs: totalMsgs.toLocaleString('ko-KR'),
            totalRank: totalRank.toLocaleString('ko-KR'),
            daysCount: daysCount.toLocaleString('ko-KR'),
            todayMsgs: todayMsgs.toLocaleString('ko-KR'),
            todayRank: todayRank.toLocaleString('ko-KR'),
            todayWatchStr: this.formatWatchTime(todayWatchSec),
            todayWatchRank: todayWatchRank.toLocaleString('ko-KR'),
            totalWatchStr: this.formatWatchTime(totalWatchSec),
            totalWatchRank: totalWatchRank.toLocaleString('ko-KR'),
        };
    }

    getGlobalOverview() {
        if (!this.db) return null;
        const currentDate = this.getKSTDateInt();
        const userSummary = this.stmts.globalUserSummary.get();
        const todaySummary = this.stmts.globalTodaySummary.get(currentDate);

        const totalMessages = userSummary ? userSummary.total_messages : 0;
        const totalWatchSec = userSummary ? userSummary.total_watch_seconds : 0;

        const top100MsgRow = this.stmts.top100MessagesSummary ? this.stmts.top100MessagesSummary.get() : null;
        const top100WatchRow = this.stmts.top100WatchSummary ? this.stmts.top100WatchSummary.get() : null;

        const top100Messages = top100MsgRow ? top100MsgRow.top_messages : 0;
        const top100WatchSec = top100WatchRow ? top100WatchRow.top_watch_seconds : 0;

        const top100MsgRatio = totalMessages > 0
            ? ((top100Messages / totalMessages) * 100).toFixed(1)
            : '0.0';

        const top100WatchRatio = totalWatchSec > 0
            ? ((top100WatchSec / totalWatchSec) * 100).toFixed(1)
            : '0.0';

        return {
            totalUsers: userSummary ? userSummary.total_users : 0,
            totalMessages: totalMessages,
            totalWatchSec: totalWatchSec,
            totalWatchStr: this.formatWatchTime(totalWatchSec),
            top100Messages: top100Messages,
            top100MsgRatio: top100MsgRatio,
            top100WatchSec: top100WatchSec,
            top100WatchRatio: top100WatchRatio,
            todayUsers: todaySummary ? todaySummary.today_users : 0,
            todayMessages: todaySummary ? todaySummary.today_messages : 0,
            todayWatchSec: todaySummary ? todaySummary.today_watch_seconds : 0,
            todayWatchStr: this.formatWatchTime(todaySummary ? todaySummary.today_watch_seconds : 0),
            currentDate: this.formatDateDisplay(currentDate)
        };
    }

    searchUsers({ query = '', sortBy = 'total_messages', sortOrder = 'DESC', limit = 50, offset = 0 } = {}) {
        if (!this.db) return { users: [], total: 0 };
        const currentDate = this.getKSTDateInt();

        const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
        const safeOffset = Math.max(0, Number(offset) || 0);

        const allowedSortFields = {
            'total_messages': 'u.total_messages',
            'total_watch_seconds': 'u.total_watch_seconds',
            'today_messages': 'COALESCE(d.message_count, 0)',
            'today_watch_seconds': 'COALESCE(d.watch_seconds, 0)',
            'active_days': 'u.active_days',
            'last_chat_time': 'u.last_chat_time'
        };
        const sortField = allowedSortFields[sortBy] || 'u.total_messages';
        const order = sortOrder && sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const cleanQuery = (typeof query === 'string' ? query : '').trim();

        const baseSelect = `
            SELECT u.id, u.channel_id, u.display_name, u.total_messages, u.total_watch_seconds, u.active_days,
                   u.last_chat_time, u.last_chat_date,
                   COALESCE(d.message_count, 0) AS today_messages,
                   COALESCE(d.watch_seconds,  0) AS today_watch_seconds
            FROM users u
            LEFT JOIN user_daily_stats d ON u.id = d.user_id AND d.date = ?
        `;

        let countSql, dataSql, countParams, dataParams;

        if (cleanQuery) {
            const like = '%' + cleanQuery + '%';
            countSql = 'SELECT COUNT(*) AS total FROM users WHERE display_name LIKE ? OR channel_id LIKE ?';
            countParams = [like, like];
            dataSql = baseSelect + ' WHERE u.display_name LIKE ? OR u.channel_id LIKE ? ORDER BY ' + sortField + ' ' + order + ' LIMIT ? OFFSET ?';
            dataParams = [currentDate, like, like, safeLimit, safeOffset];
        } else {
            countSql = 'SELECT COUNT(*) AS total FROM users';
            countParams = [];
            dataSql = baseSelect + ' ORDER BY ' + sortField + ' ' + order + ' LIMIT ? OFFSET ?';
            dataParams = [currentDate, safeLimit, safeOffset];
        }

        const totalRow = this._getPreparedStatement(countSql).get(...countParams);
        const total = totalRow ? totalRow.total : 0;
        const rows = this._getPreparedStatement(dataSql).all(...dataParams);

        const users = rows.map(r => {
            const totalRank = this.stmts.rankTotalMessages.get(r.total_messages)?.rank || 1;
            const totalWatchRank = this.stmts.rankTotalWatch.get(r.total_watch_seconds)?.rank || 1;
            const todayRank = this.stmts.rankTodayMessages.get(currentDate, r.today_messages)?.rank || 1;
            const todayWatchRank = this.stmts.rankTodayWatch.get(currentDate, r.today_watch_seconds)?.rank || 1;
            return {
                channelId: r.channel_id,
                displayName: r.display_name || '이름 없음',
                totalMessages: r.total_messages,
                totalMessagesRank: totalRank,
                totalWatchSeconds: r.total_watch_seconds,
                totalWatchStr: this.formatWatchTime(r.total_watch_seconds),
                totalWatchRank,
                todayMessages: r.today_messages,
                todayMessagesRank: todayRank,
                todayWatchSeconds: r.today_watch_seconds,
                todayWatchStr: this.formatWatchTime(r.today_watch_seconds),
                todayWatchRank,
                activeDays: r.active_days || 0,
                lastChatTime: r.last_chat_time,
                lastChatDate: this.formatDateDisplay(r.last_chat_date)
            };
        });

        return { users, total, limit: safeLimit, offset: safeOffset, query: cleanQuery, sortBy, sortOrder };
    }

    getUserDetail(channelId) {
        if (!this.db || !channelId) return null;
        const currentDate = this.getKSTDateInt();
        const user = this.stmts.getUserByChannelId.get(channelId);
        if (!user) return null;

        const userId = user.id;
        const daily = this.stmts.getDaily.get(userId, currentDate);

        const totalMsgs = user.total_messages || 0;
        const totalWatchSec = user.total_watch_seconds || 0;
        const daysCount = user.active_days || 0;
        const todayMsgs = daily ? daily.message_count : 0;
        const todayWatchSec = daily ? daily.watch_seconds : 0;

        const totalRank = this.stmts.rankTotalMessages.get(totalMsgs)?.rank || 1;
        const totalWatchRank = this.stmts.rankTotalWatch.get(totalWatchSec)?.rank || 1;
        const todayRank = this.stmts.rankTodayMessages.get(currentDate, todayMsgs)?.rank || 1;
        const todayWatchRank = this.stmts.rankTodayWatch.get(currentDate, todayWatchSec)?.rank || 1;

        const dailyHistory = this.stmts.getUserDailyHistory.all(userId).map(row => ({
            date: this.formatDateDisplay(row.date),
            messageCount: row.message_count,
            watchSeconds: row.watch_seconds,
            watchStr: this.formatWatchTime(row.watch_seconds)
        }));

        return {
            channelId: user.channel_id,
            displayName: user.display_name || '시청자',
            totalMessages: totalMsgs,
            totalMessagesRank: totalRank,
            totalWatchSeconds: totalWatchSec,
            totalWatchStr: this.formatWatchTime(totalWatchSec),
            totalWatchRank,
            daysCount,
            todayMessages: todayMsgs,
            todayMessagesRank: todayRank,
            todayWatchSeconds: todayWatchSec,
            todayWatchStr: this.formatWatchTime(todayWatchSec),
            todayWatchRank,
            lastChatTime: user.last_chat_time,
            lastChatDate: this.formatDateDisplay(user.last_chat_date),
            dailyHistory
        };
    }

    getTopTotalWatch(limit = 30) {
        if (!this.db) return [];
        return this.stmts.getTopTotalWatch.all(limit);
    }

    getTopTotalMessages(limit = 30) {
        if (!this.db) return [];
        return this.stmts.getTopTotalMessages.all(limit);
    }

    getTopTodayMessages(limit = 30) {
        if (!this.db) return [];
        const currentDate = this.getKSTDateInt();
        return this.stmts.getTopTodayMessages.all(currentDate, limit);
    }

    getTopTodayWatch(limit = 30) {
        if (!this.db) return [];
        const currentDate = this.getKSTDateInt();
        return this.stmts.getTopTodayWatch.all(currentDate, limit);
    }

    close() {
        if (this.antiMacro) {
            try { this.antiMacro.close(); } catch (e) { }
            this.antiMacro = null;
        }
        this.stmts = {};
        this._stmtCache.clear();
        if (this.db) {
            try { this.db.close(); } catch (e) { }
            this.db = null;
        }
    }
}

const statsTracker = new StatsTracker();
statsTracker.AntiMacroDetector = AntiMacroDetector;
module.exports = statsTracker;
