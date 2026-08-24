const cfg = require('../../../data/config-youtube.js');
const msg = require('../../../data/config-messages.js');
const statsTracker = require('../../stats-db.js');
const { maskProfanity } = require('../../func.js');

function buildRankMessage(title, rows, valExtractor, cmd, ctx, attempt = 0) {
    const limitLength = (cfg.stats && (cfg.stats.rank_chat_len_limit || cfg.stats.chat_len_limit)) || 160;
    const maxNickLen = (cfg.stats && cfg.stats.rank_chat_nick_len_limit) || 10;
    const cooldownMsg = ctx.getCooldownMsg(cmd);

    const header = msg.stats && msg.stats.rank_header ? msg.stats.rank_header(title) : `🏆 [${title}] `;
    let itemsStr = "";

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rank = i + 1;
        const rankStr = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}위`;

        let cleanName = maskProfanity(row.display_name || '시청자');
        if (cleanName.length > maxNickLen) {
            cleanName = cleanName.slice(0, maxNickLen) + '...';
        }
        const valStr = valExtractor(row);

        const itemStr = msg.stats && msg.stats.rank_item
            ? msg.stats.rank_item(rankStr, cleanName, valStr)
            : `${rankStr} ${cleanName}(${valStr})`;

        const sep = itemsStr ? (msg.stats && msg.stats.rank_separator ? msg.stats.rank_separator : " ") : "";
        const candidate = itemsStr + sep + itemStr;

        const fullMsgTest = msg.stats && msg.stats.rank_list
            ? msg.stats.rank_list(title, candidate, cooldownMsg)
            : `${header}${candidate} ${cooldownMsg}`.trim();

        if (fullMsgTest.length > limitLength && itemsStr.length > 0) {
            break;
        }
        itemsStr = candidate;
    }

    if (!itemsStr) {
        itemsStr = "기록이 없습니다.";
    }

    const finalRaw = msg.stats && msg.stats.rank_list
        ? msg.stats.rank_list(title, itemsStr, cooldownMsg)
        : `${header}${itemsStr} ${cooldownMsg}`.trim();

    const spaces = " ".repeat(attempt);
    return `${finalRaw}${spaces}`;
}

module.exports = {
    name: 'stats',
    group: 'stats',
    aliases: ['!스탯', '!스텟', '!내정보', '!내스탯', '!내스텟', '!stats', '!stat'],
    description: '유저 통계, 전체 요약 및 부문별 랭킹 조회',

    async execute({ cmd, args, displayName, _input, ctx }) {
        if (cfg.stats && !cfg.stats.enable) {
            return ctx.returnWarning(msg.error.stats_disabled, cmd, _input);
        }

        const rawArg = (args && args.length > 0 && typeof args[0] === 'string') ? args[0].trim() : "";

        // 인자가 없는 경우: 기존 내 스탯 조회
        if (!rawArg) {
            const channelId = _input && _input.channelId;
            if (!channelId) {
                return ctx.returnWarning(msg.error.stats_not_found, cmd, _input);
            }

            const stats = statsTracker.getUserStats(channelId, displayName);
            if (!stats) {
                return ctx.returnWarning(msg.error.stats_not_found, cmd, _input);
            }

            ctx.setCooldown(cmd, 0, _input);

            const cleanName = maskProfanity(stats.name);

            const makeMsg = (attempt) => {
                const spaces = " ".repeat(attempt);
                const builtMsg = msg.stats.user_stats(
                    cleanName,
                    stats.totalMsgs,
                    stats.totalRank,
                    stats.daysCount,
                    stats.todayMsgs,
                    stats.todayRank,
                    stats.todayWatchStr,
                    stats.todayWatchRank,
                    stats.totalWatchStr,
                    stats.totalWatchRank,
                    ctx.getCooldownMsg(cmd)
                );
                return `${builtMsg}${spaces}`;
            };

            return {
                msg: makeMsg(0),
                proc: (attempt) => makeMsg(attempt)
            };
        }

        // 1. 전체 통계: '전체'
        if (rawArg === '전체' || rawArg.toLowerCase() === 'all') {
            const overview = statsTracker.getGlobalOverview();
            if (!overview) {
                return ctx.returnWarning(msg.error.stats_not_found, cmd, _input);
            }

            ctx.setCooldown(cmd, 0, _input);

            const makeMsg = (attempt) => {
                const spaces = " ".repeat(attempt);
                const builtMsg = msg.stats.overview(
                    overview.todayUsers.toLocaleString('ko-KR'),
                    overview.todayMessages.toLocaleString('ko-KR'),
                    overview.totalUsers.toLocaleString('ko-KR'),
                    overview.totalMessages.toLocaleString('ko-KR'),
                    ctx.getCooldownMsg(cmd)
                );
                return `${builtMsg}${spaces}`;
            };

            return {
                msg: makeMsg(0),
                proc: (attempt) => makeMsg(attempt)
            };
        }

        // 2. 총시간: 전체 시청시간 랭킹
        if (rawArg === '총시간' || rawArg === '전체시간') {
            ctx.setCooldown(cmd, 0, _input);
            const rows = statsTracker.getTopTotalWatch(30);
            return {
                msg: buildRankMessage('총 시청시간 순위', rows, (r) => statsTracker.formatWatchTime(r.total_watch_seconds), cmd, ctx, 0),
                proc: (attempt) => buildRankMessage('총 시청시간 순위', rows, (r) => statsTracker.formatWatchTime(r.total_watch_seconds), cmd, ctx, attempt)
            };
        }

        // 3. 총채팅: 전체 채팅수 랭킹
        if (rawArg === '총채팅' || rawArg === '전체채팅') {
            ctx.setCooldown(cmd, 0, _input);
            const rows = statsTracker.getTopTotalMessages(30);
            return {
                msg: buildRankMessage('총 채팅 순위', rows, (r) => `${r.total_messages.toLocaleString('ko-KR')}개`, cmd, ctx, 0),
                proc: (attempt) => buildRankMessage('총 채팅 순위', rows, (r) => `${r.total_messages.toLocaleString('ko-KR')}개`, cmd, ctx, attempt)
            };
        }

        // 4. 오늘채팅 / 채팅: 오늘 채팅수 랭킹
        if (rawArg === '오늘채팅' || rawArg === '채팅') {
            ctx.setCooldown(cmd, 0, _input);
            const rows = statsTracker.getTopTodayMessages(30);
            return {
                msg: buildRankMessage('오늘 채팅 순위', rows, (r) => `${r.message_count.toLocaleString('ko-KR')}개`, cmd, ctx, 0),
                proc: (attempt) => buildRankMessage('오늘 채팅 순위', rows, (r) => `${r.message_count.toLocaleString('ko-KR')}개`, cmd, ctx, attempt)
            };
        }

        // 5. 오늘시간 / 시간: 오늘 시청시간 랭킹
        if (rawArg === '오늘시간' || rawArg === '시간') {
            ctx.setCooldown(cmd, 0, _input);
            const rows = statsTracker.getTopTodayWatch(30);
            return {
                msg: buildRankMessage('오늘 시청시간 순위', rows, (r) => statsTracker.formatWatchTime(r.watch_seconds), cmd, ctx, 0),
                proc: (attempt) => buildRankMessage('오늘 시청시간 순위', rows, (r) => statsTracker.formatWatchTime(r.watch_seconds), cmd, ctx, attempt)
            };
        }

        // 5개 인자 이외의 입력 시 경고
        return ctx.returnWarning(msg.stats.invalid_arg, cmd, _input);
    }
};
