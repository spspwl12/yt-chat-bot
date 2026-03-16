const fs = require('fs');
const { sendChat, banUser } = require('./innertube.js');
const path2 = require('./path.js');
const BANNED_PATH = path2.findPath('./data/youtube-banned.json');

class SpamGuard {
    constructor(opts) {
        opts = opts || {};
        this.windowMs = (opts.windowSec || 10) * 1000;
        this.maxCount = opts.maxCount || 1;
        this.warnLimit = opts.warnLimit || 5;
        this.tracker = new Map();
        this.banned = this._loadBanned();

        console.log(
            '🛡️  도배 방지 — ' +
            (opts.windowSec || 10) + '초/' +
            this.maxCount + '회, ' +
            this.warnLimit + '회 경고 후 차단'
        );
    }

    check(channelId, counts) {
        if (this.banned.has(channelId))
            return 'ban';
        const now = Date.now();
        let r = this.tracker.get(channelId);
        if (!r) {
            if (counts <= 0)
                return 'ok';
            r = { timestamps: [], warns: 0 };
            this.tracker.set(channelId, r);
        }
        r.timestamps = r.timestamps.filter(function (t) {
            return now - t < this.windowMs;
        }.bind(this));
        if (r.timestamps.length <= 0)
            r.warns = 0;
        if (counts <= 0 && r.warns <= 0)
            return 'ok';
        r.timestamps.push(now + (this.windowMs * r.warns));
        if (r.timestamps.length <= this.maxCount)
            return 'ok';
        r.warns += counts;
        return r.warns >= this.warnLimit ? 'ban' : 'warn';
    }

    addPenalty(channelId, displayName, warnCount) {
        if (!warnCount || this.banned.has(channelId)) return;

        const now = Date.now();
        let r = this.tracker.get(channelId);
        if (!r) {
            r = { timestamps: [], warns: 0 };
            this.tracker.set(channelId, r);
        }

        for (let i = 0; i < warnCount; i++) {
            r.timestamps.push(now + (this.windowMs * r.warns));
            if (r.timestamps.length > this.maxCount) {
                r.warns++;
            }
        }

        console.log('⚠️  경고 [' + displayName + '] ' + r.warns + '/' + this.warnLimit);
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

        const result = this.check(channelId, 1);
        if (result === 'ok')
            return false;

        if (result === 'warn') {
            const r = this.tracker.get(channelId);
            const remaining = this.warnLimit - r.warns;
            if (remaining > 0) {
                console.log('⚠️  경고 [' + displayName + '] ' + r.warns + '/' + this.warnLimit);
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
