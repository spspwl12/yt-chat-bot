const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const configManager = require('./config-manager.js');
const { cfg } = configManager;

class StatsTracker {
    constructor() {
        this.db = null;
        this.stmts = {};
        this._init();
    }

    _init() {
        if (!cfg.stats) return;

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
        this.stmts.rankTotalMessages  = this.db.prepare('SELECT COUNT(*) + 1 AS rank FROM users WHERE total_messages > ?');
        this.stmts.rankTotalWatch     = this.db.prepare('SELECT COUNT(*) + 1 AS rank FROM users WHERE total_watch_seconds > ?');
        this.stmts.rankTodayMessages  = this.db.prepare('SELECT COUNT(*) + 1 AS rank FROM user_daily_stats WHERE date = ? AND message_count > ?');
        this.stmts.rankTodayWatch     = this.db.prepare('SELECT COUNT(*) + 1 AS rank FROM user_daily_stats WHERE date = ? AND watch_seconds > ?');
        this.stmts.globalUserSummary  = this.db.prepare(`
            SELECT COUNT(*) AS total_users, COALESCE(SUM(total_messages),0) AS total_messages,
                   COALESCE(SUM(total_watch_seconds),0) AS total_watch_seconds FROM users
        `);
        this.stmts.globalTodaySummary = this.db.prepare(`
            SELECT COUNT(DISTINCT user_id) AS today_users, COALESCE(SUM(message_count),0) AS today_messages,
                   COALESCE(SUM(watch_seconds),0) AS today_watch_seconds
            FROM user_daily_stats WHERE date = ?
        `);
        this.stmts.getUserDailyHistory = this.db.prepare(
            'SELECT date, message_count, watch_seconds FROM user_daily_stats WHERE user_id = ? ORDER BY date DESC LIMIT 60'
        );
    }

    getKSTDateInt(timestamp = Date.now()) {
        const utc = timestamp + (new Date(timestamp).getTimezoneOffset() * 60000);
        const kst = new Date(utc + (9 * 3600000));
        const y = kst.getFullYear();
        const m = String(kst.getMonth() + 1).padStart(2, '0');
        const d = String(kst.getDate()).padStart(2, '0');
        return parseInt(y + m + d, 10);
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
        const days  = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins  = Math.floor((seconds % 3600) / 60);
        const secs  = seconds % 60;
        const parts = [];
        if (days  > 0) parts.push(days.toLocaleString('ko-KR') + '일');
        if (hours > 0) parts.push(hours + '시간');
        if (mins  > 0) parts.push(mins + '분');
        return parts.length === 0 ? secs + '초' : parts.join(' ');
    }

    recordChatMessage(msg) {
        if (!this.db || !msg || !msg.channelId) return;

        const channelId = msg.channelId;

        // 제외 목록(봇 계정 등)에 포함된 channel_id는 스탯 집계에서 제외
        const excludeList = cfg.stats && cfg.stats.exclude_channel_ids;
        if (Array.isArray(excludeList) && excludeList.includes(channelId)) return;
        const displayName = msg.displayName || '';
        const timestamp = typeof msg.timestamp === 'number' && !isNaN(msg.timestamp) ? msg.timestamp : Date.now();
        const currentDate = this.getKSTDateInt(timestamp);
        const watchThresholdMs = ((cfg.stats && cfg.stats.watch_threshold_min) || 10) * 60 * 1000;

        try {
            const user = this.stmts.getUserByChannelId.get(channelId);
            let watchDeltaSec = 0;

            if (user && user.last_chat_time > 0) {
                const diffMs = timestamp - user.last_chat_time;
                if (diffMs > 0 && diffMs <= watchThresholdMs) {
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
        } catch (err) {
            console.error('[StatsTracker] DB 기록 실패:', err.message);
        }
    }

    getUserStats(channelId, displayName) {
        if (!this.db) return null;

        const currentDate   = this.getKSTDateInt();
        const user          = this.stmts.getUserByChannelId.get(channelId);
        const userId        = user ? user.id : null;
        const daily         = userId ? this.stmts.getDaily.get(userId, currentDate) : null;

        const totalMsgs     = user ? user.total_messages      : 0;
        const totalWatchSec = user ? user.total_watch_seconds : 0;
        const daysCount     = user ? user.active_days          : 0;
        const todayMsgs     = daily ? daily.message_count : 0;
        const todayWatchSec = daily ? daily.watch_seconds  : 0;

        const totalRank      = this.stmts.rankTotalMessages.get(totalMsgs)?.rank || 1;
        const totalWatchRank = this.stmts.rankTotalWatch.get(totalWatchSec)?.rank || 1;
        const todayRank      = this.stmts.rankTodayMessages.get(currentDate, todayMsgs)?.rank || 1;
        const todayWatchRank = this.stmts.rankTodayWatch.get(currentDate, todayWatchSec)?.rank || 1;

        const name = displayName || (user && user.display_name) || '시청자';
        return {
            name,
            totalMsgs:      totalMsgs.toLocaleString('ko-KR'),
            totalRank:      totalRank.toLocaleString('ko-KR'),
            daysCount:      daysCount.toLocaleString('ko-KR'),
            todayMsgs:      todayMsgs.toLocaleString('ko-KR'),
            todayRank:      todayRank.toLocaleString('ko-KR'),
            todayWatchStr:  this.formatWatchTime(todayWatchSec),
            todayWatchRank: todayWatchRank.toLocaleString('ko-KR'),
            totalWatchStr:  this.formatWatchTime(totalWatchSec),
            totalWatchRank: totalWatchRank.toLocaleString('ko-KR'),
        };
    }

    getGlobalOverview() {
        if (!this.db) return null;
        const currentDate  = this.getKSTDateInt();
        const userSummary  = this.stmts.globalUserSummary.get();
        const todaySummary = this.stmts.globalTodaySummary.get(currentDate);

        return {
            totalUsers:    userSummary  ? userSummary.total_users         : 0,
            totalMessages: userSummary  ? userSummary.total_messages       : 0,
            totalWatchSec: userSummary  ? userSummary.total_watch_seconds  : 0,
            totalWatchStr: this.formatWatchTime(userSummary ? userSummary.total_watch_seconds : 0),
            todayUsers:    todaySummary ? todaySummary.today_users         : 0,
            todayMessages: todaySummary ? todaySummary.today_messages      : 0,
            todayWatchSec: todaySummary ? todaySummary.today_watch_seconds : 0,
            todayWatchStr: this.formatWatchTime(todaySummary ? todaySummary.today_watch_seconds : 0),
            currentDate:   this.formatDateDisplay(currentDate)
        };
    }

    searchUsers({ query = '', sortBy = 'total_messages', sortOrder = 'DESC', limit = 50, offset = 0 } = {}) {
        if (!this.db) return { users: [], total: 0 };
        const currentDate = this.getKSTDateInt();

        const allowedSortFields = {
            'total_messages':      'u.total_messages',
            'total_watch_seconds': 'u.total_watch_seconds',
            'today_messages':      'COALESCE(d.message_count, 0)',
            'today_watch_seconds': 'COALESCE(d.watch_seconds, 0)',
            'active_days':         'u.active_days',
            'last_chat_time':      'u.last_chat_time'
        };
        const sortField  = allowedSortFields[sortBy] || 'u.total_messages';
        const order      = sortOrder && sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const cleanQuery = (query || '').trim();

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
            const like  = '%' + cleanQuery + '%';
            countSql    = 'SELECT COUNT(*) AS total FROM users WHERE display_name LIKE ? OR channel_id LIKE ?';
            countParams = [like, like];
            dataSql     = baseSelect + ' WHERE u.display_name LIKE ? OR u.channel_id LIKE ? ORDER BY ' + sortField + ' ' + order + ' LIMIT ? OFFSET ?';
            dataParams  = [currentDate, like, like, limit, offset];
        } else {
            countSql    = 'SELECT COUNT(*) AS total FROM users';
            countParams = [];
            dataSql     = baseSelect + ' ORDER BY ' + sortField + ' ' + order + ' LIMIT ? OFFSET ?';
            dataParams  = [currentDate, limit, offset];
        }

        const totalRow = this.db.prepare(countSql).get(...countParams);
        const total    = totalRow ? totalRow.total : 0;
        const rows     = this.db.prepare(dataSql).all(...dataParams);

        const users = rows.map(r => {
            const totalRank      = this.stmts.rankTotalMessages.get(r.total_messages)?.rank || 1;
            const totalWatchRank = this.stmts.rankTotalWatch.get(r.total_watch_seconds)?.rank || 1;
            const todayRank      = this.stmts.rankTodayMessages.get(currentDate, r.today_messages)?.rank || 1;
            const todayWatchRank = this.stmts.rankTodayWatch.get(currentDate, r.today_watch_seconds)?.rank || 1;
            return {
                channelId:         r.channel_id,
                displayName:       r.display_name || '이름 없음',
                totalMessages:     r.total_messages,
                totalMessagesRank: totalRank,
                totalWatchSeconds: r.total_watch_seconds,
                totalWatchStr:     this.formatWatchTime(r.total_watch_seconds),
                totalWatchRank,
                todayMessages:     r.today_messages,
                todayMessagesRank: todayRank,
                todayWatchSeconds: r.today_watch_seconds,
                todayWatchStr:     this.formatWatchTime(r.today_watch_seconds),
                todayWatchRank,
                activeDays:        r.active_days || 0,
                lastChatTime:      r.last_chat_time,
                lastChatDate:      this.formatDateDisplay(r.last_chat_date)
            };
        });

        return { users, total, limit, offset, query: cleanQuery, sortBy, sortOrder };
    }

    getUserDetail(channelId) {
        if (!this.db || !channelId) return null;
        const currentDate   = this.getKSTDateInt();
        const user          = this.stmts.getUserByChannelId.get(channelId);
        if (!user) return null;

        const userId        = user.id;
        const daily         = this.stmts.getDaily.get(userId, currentDate);

        const totalMsgs     = user.total_messages      || 0;
        const totalWatchSec = user.total_watch_seconds || 0;
        const daysCount     = user.active_days          || 0;
        const todayMsgs     = daily ? daily.message_count : 0;
        const todayWatchSec = daily ? daily.watch_seconds  : 0;

        const totalRank      = this.stmts.rankTotalMessages.get(totalMsgs)?.rank || 1;
        const totalWatchRank = this.stmts.rankTotalWatch.get(totalWatchSec)?.rank || 1;
        const todayRank      = this.stmts.rankTodayMessages.get(currentDate, todayMsgs)?.rank || 1;
        const todayWatchRank = this.stmts.rankTodayWatch.get(currentDate, todayWatchSec)?.rank || 1;

        const dailyHistory = this.stmts.getUserDailyHistory.all(userId).map(row => ({
            date:         this.formatDateDisplay(row.date),
            messageCount: row.message_count,
            watchSeconds: row.watch_seconds,
            watchStr:     this.formatWatchTime(row.watch_seconds)
        }));

        return {
            channelId:         user.channel_id,
            displayName:       user.display_name || '시청자',
            totalMessages:     totalMsgs,
            totalMessagesRank: totalRank,
            totalWatchSeconds: totalWatchSec,
            totalWatchStr:     this.formatWatchTime(totalWatchSec),
            totalWatchRank,
            daysCount,
            todayMessages:     todayMsgs,
            todayMessagesRank: todayRank,
            todayWatchSeconds: todayWatchSec,
            todayWatchStr:     this.formatWatchTime(todayWatchSec),
            todayWatchRank,
            lastChatTime:  user.last_chat_time,
            lastChatDate:  this.formatDateDisplay(user.last_chat_date),
            dailyHistory
        };
    }

    close() {
        if (this.db) {
            try { this.db.close(); } catch (e) { }
            this.db = null;
        }
    }
}

const statsTracker = new StatsTracker();
module.exports = statsTracker;
