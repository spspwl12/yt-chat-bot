const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('../data/config-youtube.js');

class StatsTracker {
    constructor() {
        this.db = null;
        this.stmts = {};
        this._init();
    }

    _init() {
        if (!cfg.stats) {
            return;
        }

        const rawDbPath = cfg.stats.db_path || '../data/chat_stats.db';
        const dbPath = path.isAbsolute(rawDbPath)
            ? rawDbPath
            : path.resolve(__dirname, rawDbPath);

        // 상위 디렉터리 확인 및 생성
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new DatabaseSync(dbPath);

        // WAL 모드 및 성능 최적화
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');

        // 테이블 생성
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                channel_id TEXT PRIMARY KEY,
                display_name TEXT,
                total_messages INTEGER DEFAULT 0,
                total_watch_seconds INTEGER DEFAULT 0,
                last_chat_time INTEGER DEFAULT 0,
                last_chat_date TEXT,
                updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS user_daily_stats (
                channel_id TEXT,
                date TEXT,
                message_count INTEGER DEFAULT 0,
                watch_seconds INTEGER DEFAULT 0,
                PRIMARY KEY (channel_id, date)
            );

            CREATE INDEX IF NOT EXISTS idx_users_total_messages ON users(total_messages DESC);
            CREATE INDEX IF NOT EXISTS idx_users_total_watch ON users(total_watch_seconds DESC);
            CREATE INDEX IF NOT EXISTS idx_daily_date_msg ON user_daily_stats(date, message_count DESC);
            CREATE INDEX IF NOT EXISTS idx_daily_date_watch ON user_daily_stats(date, watch_seconds DESC);
            CREATE INDEX IF NOT EXISTS idx_daily_channel ON user_daily_stats(channel_id);
        `);

        // PreparedStatement 준비
        this.stmts.getUser = this.db.prepare(`
            SELECT channel_id, display_name, total_messages, total_watch_seconds, last_chat_time, last_chat_date 
            FROM users WHERE channel_id = ?
        `);

        this.stmts.upsertUser = this.db.prepare(`
            INSERT INTO users (channel_id, display_name, total_messages, total_watch_seconds, last_chat_time, last_chat_date, updated_at)
            VALUES (?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(channel_id) DO UPDATE SET
                display_name = excluded.display_name,
                total_messages = total_messages + 1,
                total_watch_seconds = total_watch_seconds + excluded.total_watch_seconds,
                last_chat_time = excluded.last_chat_time,
                last_chat_date = excluded.last_chat_date,
                updated_at = excluded.updated_at
        `);

        this.stmts.getDaily = this.db.prepare(`
            SELECT message_count, watch_seconds FROM user_daily_stats 
            WHERE channel_id = ? AND date = ?
        `);

        this.stmts.upsertDaily = this.db.prepare(`
            INSERT INTO user_daily_stats (channel_id, date, message_count, watch_seconds)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(channel_id, date) DO UPDATE SET
                message_count = message_count + 1,
                watch_seconds = watch_seconds + excluded.watch_seconds
        `);

        this.stmts.addDailyWatch = this.db.prepare(`
            INSERT INTO user_daily_stats (channel_id, date, message_count, watch_seconds)
            VALUES (?, ?, 0, ?)
            ON CONFLICT(channel_id, date) DO UPDATE SET
                watch_seconds = watch_seconds + excluded.watch_seconds
        `);

        this.stmts.getActiveDays = this.db.prepare(`
            SELECT COUNT(*) AS count FROM user_daily_stats 
            WHERE channel_id = ? AND message_count > 0
        `);

        this.stmts.rankTotalMessages = this.db.prepare(`
            SELECT COUNT(*) + 1 AS rank FROM users WHERE total_messages > ?
        `);

        this.stmts.rankTotalWatch = this.db.prepare(`
            SELECT COUNT(*) + 1 AS rank FROM users WHERE total_watch_seconds > ?
        `);

        this.stmts.rankTodayMessages = this.db.prepare(`
            SELECT COUNT(*) + 1 AS rank FROM user_daily_stats 
            WHERE date = ? AND message_count > ?
        `);

        this.stmts.rankTodayWatch = this.db.prepare(`
            SELECT COUNT(*) + 1 AS rank FROM user_daily_stats 
            WHERE date = ? AND watch_seconds > ?
        `);
    }

    /**
     * KST (한국 표준시) 기준 YYYY-MM-DD 문자열 반환
     */
    getKSTDateString(timestamp = Date.now()) {
        const d = new Date(timestamp);
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        const kst = new Date(utc + (9 * 3600000));
        const year = kst.getFullYear();
        const month = String(kst.getMonth() + 1).padStart(2, '0');
        const day = String(kst.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * KST 기준 특정 날짜의 자정(00:00:00) UTC 밀리초 타임스탬프 계산
     */
    getKSTMidnightMs(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        // Date.UTC(year, month - 1, day, 0, 0, 0) is UTC 00:00. KST 00:00 is UTC - 9 hours.
        return Date.UTC(year, month - 1, day, 0, 0, 0) - (9 * 3600000);
    }

    /**
     * 초 단위를 보기 좋은 한국어 시간 문자열로 변환
     */
    formatWatchTime(seconds) {
        if (!seconds || seconds <= 0) return '0분';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const parts = [];
        if (days > 0) parts.push(`${days.toLocaleString('ko-KR')}일`);
        if (hours > 0) parts.push(`${hours}시간`);
        if (mins > 0) parts.push(`${mins}분`);

        if (parts.length === 0) {
            return `${secs}초`;
        }
        return parts.join(' ');
    }

    /**
     * 채팅 메시지 수신 시 호출되어 통계 데이터를 DB에 기록
     */
    recordChatMessage(msg) {
        if (!this.db || !msg || !msg.channelId) return;

        const channelId = msg.channelId;
        const displayName = msg.displayName || '';
        const timestamp = typeof msg.timestamp === 'number' && !isNaN(msg.timestamp) ? msg.timestamp : Date.now();
        const currentDate = this.getKSTDateString(timestamp);
        const watchThresholdMs = ((cfg.stats && cfg.stats.watch_threshold_min) || 10) * 60 * 1000;

        try {
            const user = this.stmts.getUser.get(channelId);
            let watchDeltaSec = 0;

            if (user && user.last_chat_time > 0) {
                const diffMs = timestamp - user.last_chat_time;
                if (diffMs > 0 && diffMs <= watchThresholdMs) {
                    watchDeltaSec = Math.round(diffMs / 1000);
                }
            }

            // 자정을 넘겨 연속 채팅한 경우 어제/오늘 시청시간 분할
            if (watchDeltaSec > 0 && user && user.last_chat_date && user.last_chat_date !== currentDate) {
                const midnightMs = this.getKSTMidnightMs(currentDate);
                const yesterdaySec = Math.max(0, Math.min(watchDeltaSec, Math.round((midnightMs - user.last_chat_time) / 1000)));
                const todaySec = Math.max(0, watchDeltaSec - yesterdaySec);

                if (yesterdaySec > 0) {
                    this.stmts.addDailyWatch.run(channelId, user.last_chat_date, yesterdaySec);
                }
                this.stmts.upsertDaily.run(channelId, currentDate, todaySec);
            } else {
                this.stmts.upsertDaily.run(channelId, currentDate, watchDeltaSec);
            }

            this.stmts.upsertUser.run(
                channelId,
                displayName,
                watchDeltaSec,
                timestamp,
                currentDate,
                Date.now()
            );
        } catch (err) {
            console.error('❌ [StatsTracker] DB 기록 실패:', err.message);
        }
    }

    /**
     * 특정 유저의 종합 스탯 및 순위 조회
     */
    getUserStats(channelId, displayName) {
        if (!this.db) return null;

        const currentDate = this.getKSTDateString(Date.now());
        const user = this.stmts.getUser.get(channelId);
        const daily = this.stmts.getDaily.get(channelId, currentDate);
        const activeDaysRow = this.stmts.getActiveDays.get(channelId);

        const totalMsgs = user ? user.total_messages : 0;
        const totalWatchSec = user ? user.total_watch_seconds : 0;
        const daysCount = activeDaysRow ? activeDaysRow.count : 0;
        const todayMsgs = daily ? daily.message_count : 0;
        const todayWatchSec = daily ? daily.watch_seconds : 0;

        const totalRank = this.stmts.rankTotalMessages.get(totalMsgs)?.rank || 1;
        const totalWatchRank = this.stmts.rankTotalWatch.get(totalWatchSec)?.rank || 1;
        const todayRank = this.stmts.rankTodayMessages.get(currentDate, todayMsgs)?.rank || 1;
        const todayWatchRank = this.stmts.rankTodayWatch.get(currentDate, todayWatchSec)?.rank || 1;

        const name = displayName || (user && user.display_name) || '시청자';

        return {
            name: name,
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

    close() {
        if (this.db) {
            try {
                this.db.close();
            } catch (e) { }
            this.db = null;
        }
    }
}

const statsTracker = new StatsTracker();
module.exports = statsTracker;
