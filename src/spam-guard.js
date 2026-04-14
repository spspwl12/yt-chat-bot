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

    check(channelId, counts, displayName) {
        if (this.banned.has(channelId))
            return 'ban';
        const now = Date.now();
        let r = this.tracker.get(channelId);
        if (!r) {
            if (counts <= 0)
                return 'ok';
            r = { timestamps: [], warns: 0, commandHistory: [] };
            this.tracker.set(channelId, r);
        }
        if (displayName) r.displayName = displayName;

        if (!r.commandHistory)
            r.commandHistory = [];
        r.commandHistory = r.commandHistory.filter(t => now - t < this.penaltyDurationMs);

        let currentWindowMs = this.baseWindowMs + (r.commandHistory.length * this.penaltyAddMs);

        r.timestamps = r.timestamps.filter(t => now - t < currentWindowMs);
        if (r.timestamps.length <= 0)
            r.warns = 0;
        if (counts <= 0 && r.warns <= 0)
            return 'ok';

        for (let i = 0; i < counts; i++) {
            r.commandHistory.push(now);
        }

        currentWindowMs = this.baseWindowMs + (r.commandHistory.length * this.penaltyAddMs);

        r.timestamps.push(now + (currentWindowMs * r.warns));
        if (r.timestamps.length <= this.maxCount)
            return 'ok';
        r.warns += counts;
        r.lastWarnedAt = now;
        return r.warns >= this.warnLimit ? 'ban' : 'warn';
    }

    addPenalty(channelId, displayName, warnCount) {
        if (!warnCount || this.banned.has(channelId)) return;

        const now = Date.now();
        let r = this.tracker.get(channelId);
        if (!r) {
            r = { timestamps: [], warns: 0, commandHistory: [] };
            this.tracker.set(channelId, r);
        }
        if (displayName) r.displayName = displayName;

        for (let i = 0; i < warnCount; i++) {
            r.timestamps.push(now + (this.baseWindowMs * r.warns));
            if (r.timestamps.length > this.maxCount) {
                r.warns++;
                r.lastWarnedAt = now;
            }
        }

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
        const history = (r.commandHistory || []).filter(t => now - t < this.penaltyDurationMs);
        const lastWarned = r.lastWarnedAt || 0;
        // windowMs × 경고횟수 + penaltyAddMs × 명령어사용횟수
        const totalMs = (this.baseWindowMs * r.warns) + (this.penaltyAddMs * history.length);
        const elapsed = lastWarned > 0 ? (now - lastWarned) : 0;
        const remainingMs = lastWarned > 0 ? Math.max(0, totalMs - elapsed) : 0;
        return {
            displayName: r.displayName || null,
            warns: r.warns,
            remainingMs: remainingMs,
            totalMs: totalMs,
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
