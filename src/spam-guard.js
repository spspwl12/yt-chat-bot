const fs = require('fs');
const { sendChat, banUser } = require('./innertube.js');
const path2 = require('./path.js');
const BANNED_PATH = path2.findPath('./data/youtube-banned.json');

class SpamGuard {
    constructor(opts) {
        opts = opts || {};
        this.baseWindowMs = (opts.windowSec || 10) * 1000;
        this.maxCount = opts.maxCount || 1;
        this.warnLimit = opts.warnLimit || 5;
        this.penaltyDurationMs = (opts.penaltyDurationHrs !== undefined ? opts.penaltyDurationHrs : 12) * 60 * 60 * 1000;
        this.penaltyAddMs = (opts.penaltyAddSec || 0) * 1000;
        this.tracker = new Map();
        this.banned = this._loadBanned();

        console.log(
            '🛡️  도배 방지 — 기본 ' +
            (opts.windowSec || 10) + '초 (누적량 비례 +' + (opts.penaltyAddSec || 0) + '초, ' +
            (opts.penaltyDurationHrs !== undefined ? opts.penaltyDurationHrs : 12) + '시간 유지) / ' +
            this.maxCount + '회, ' +
            this.warnLimit + '회 경고 후 차단'
        );
    }

    /**
     * 현재 유저의 쿨다운 윈도우(ms) 계산.
     * baseWindowMs + (penaltyAddMs × 유효 명령어 사용 횟수)
     */
    _calcWindowMs(r) {
        const now = Date.now();
        const history = (r.commandHistory || []).filter(t => now - t < this.penaltyDurationMs);
        return this.baseWindowMs + (history.length * this.penaltyAddMs);
    }

    /**
     * 패널티 만료 시각을 갱신.
     * 공식: baseWindowMs × warns + penaltyAddMs × commandCount
     */
    _refreshExpiry(r) {
        if (r.warns <= 0) {
            r.penaltyExpiresAt = 0;
            return;
        }
        const now = Date.now();
        const historyCount = (r.commandHistory || []).filter(t => now - t < this.penaltyDurationMs).length;
        r.penaltyExpiresAt = now + (this.baseWindowMs * r.warns) + (this.penaltyAddMs * historyCount);
    }

    /**
     * 패널티가 만료됐으면 경고 카운트를 리셋.
     */
    _cleanupIfExpired(r) {
        if (r.warns > 0 && r.penaltyExpiresAt > 0 && Date.now() >= r.penaltyExpiresAt) {
            r.warns = 0;
            r.penaltyExpiresAt = 0;
        }
    }

    check(channelId, counts, displayName) {
        if (this.banned.has(channelId))
            return 'ban';
        const now = Date.now();
        let r = this.tracker.get(channelId);
        if (!r) {
            if (counts <= 0)
                return 'ok';
            r = { warns: 0, commandHistory: [], penaltyExpiresAt: 0 };
            this.tracker.set(channelId, r);
        }
        if (displayName) r.displayName = displayName;

        if (!r.commandHistory)
            r.commandHistory = [];
        // penaltyDuration 이내의 명령어 이력만 보존
        r.commandHistory = r.commandHistory.filter(t => now - t < this.penaltyDurationMs);

        // 만료된 패널티 리셋
        this._cleanupIfExpired(r);

        if (counts <= 0 && r.warns <= 0)
            return 'ok';

        // 명령어 사용 이력 추가
        for (let i = 0; i < counts; i++) {
            r.commandHistory.push(now);
        }

        // 쿨다운 윈도우 계산
        const windowMs = this._calcWindowMs(r);

        // 패널티 중이면(아직 만료 안 됨) → 추가 사용은 경고 누적
        if (r.warns > 0 && now < r.penaltyExpiresAt) {
            r.warns += counts;
            // 만료 시각 재계산 (누적된 경고 기반)
            this._refreshExpiry(r);
            r.lastWarnedAt = now;
            return r.warns >= this.warnLimit ? 'ban' : 'warn';
        }

        // 패널티 없는 상태에서의 쿨다운 체크:
        // 최근 windowMs 내의 명령어 사용 횟수가 maxCount를 초과하면 경고
        const recentCount = r.commandHistory.filter(t => now - t < windowMs).length;
        if (recentCount <= this.maxCount)
            return 'ok';

        // 경고 발생
        r.warns += counts;
        r.lastWarnedAt = now;
        this._refreshExpiry(r);
        return r.warns >= this.warnLimit ? 'ban' : 'warn';
    }

    addPenalty(channelId, displayName, warnCount) {
        if (!warnCount || this.banned.has(channelId)) return;

        let r = this.tracker.get(channelId);
        if (!r) {
            r = { warns: 0, commandHistory: [], penaltyExpiresAt: 0 };
            this.tracker.set(channelId, r);
        }
        if (displayName) r.displayName = displayName;

        r.warns += warnCount;
        r.lastWarnedAt = Date.now();
        this._refreshExpiry(r);

        console.log(`⚠️ 경고 [${displayName}] ${r.warns}/${this.warnLimit}(${(r.commandHistory || []).length})`);
    }

    confirm(channelId) {
        if (this.banned.has(channelId))
            return 2;

        const result = this.check(channelId, 0);
        if (result === 'ok')
            return 0;

        if (result === 'warn')
            return 1;

        return 0;
    }

    async enforce(channelId, displayName, contextMenu) {
        if (this.banned.has(channelId))
            return true;

        const result = this.check(channelId, 1, displayName);
        if (result === 'ok')
            return false;

        if (result === 'warn') {
            const r = this.tracker.get(channelId);
            const remaining = this.warnLimit - r.warns;
            if (remaining > 0) {
                console.log(`⚠️ 경고 [${displayName}] ${r.warns}/${this.warnLimit}(${(r.commandHistory || []).length})`);
                return true;
            }
        }

        console.log('🚫 차단: ' + displayName + ' (' + channelId + ')');

        if (contextMenu)
            await banUser(contextMenu);

        this.banned.set(channelId, {
            displayName: displayName,
            reason: '도배',
            bannedAt: new Date().toISOString(),
        });
        this._saveBanned();
        return true;
    }

    async manualBan(channelId, displayName, reason) {
        if (!this.banned.has(channelId)) {
            this.banned.set(channelId, {
                displayName: displayName,
                reason: reason || '수동 밴',
                bannedAt: new Date().toISOString()
            });
            this._saveBanned();
        }
        return true;
    }

    removeBan(channelId) {
        if (this.banned.has(channelId)) {
            this.banned.delete(channelId);
            this._saveBanned();
            return true;
        }
        return false;
    }

    getTrackerInfo(channelId) {
        const r = this.tracker.get(channelId);
        if (!r) return null;
        const now = Date.now();

        // 만료 체크
        this._cleanupIfExpired(r);

        const history = (r.commandHistory || []).filter(t => now - t < this.penaltyDurationMs);
        const remainingMs = (r.penaltyExpiresAt > 0 && r.penaltyExpiresAt > now)
            ? (r.penaltyExpiresAt - now)
            : 0;

        return {
            displayName: r.displayName || null,
            warns: r.warns,
            remainingMs: remainingMs,
            commandCount: history.length
        };
    }

    _loadBanned() {
        try {
            if (fs.existsSync(BANNED_PATH)) {
                return new Map(Object.entries(JSON.parse(fs.readFileSync(BANNED_PATH, 'utf-8'))));
            }
        } catch (e) { /* */ }
        return new Map();
    }

    _saveBanned() {
        const obj = {};
        this.banned.forEach(function (v, k) { obj[k] = v; });
        fs.writeFileSync(BANNED_PATH, JSON.stringify(obj, null, 4), 'utf-8');
    }
}

module.exports = { SpamGuard };
