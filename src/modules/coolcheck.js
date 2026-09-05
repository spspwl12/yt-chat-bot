// ─── coolcheck.js ────────────────────────────────────────────────────────────
// 유저 쿨타임 부분 검색 모듈
// 사용법: !쿨 [닉네임]
// ─────────────────────────────────────────────────────────────────────────────

const statsTracker = require('../stats-db.js');
const msg = require('../../data/config-messages.js');
const { maskProfanity } = require('../func.js');

/**
 * ms → "X분 Y초" 또는 "X초" 형태 문자열 변환
 */
function formatMs(ms) {
    if (!ms || ms <= 0) return null;
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0 && sec > 0) return `${min}분 ${sec}초`;
    if (min > 0) return `${min}분`;
    return `${sec}초`;
}

module.exports = {
    name: 'coolcheck',
    group: 'coolcheck',
    icon: '⏳',
    aliases: ['!쿨타임'],
    description: '상대방 쿨타임 잔여 시간 조회 (닉네임 부분 검색)',

    web: {
        title: '쿨타임 조회',
        icon: '⏳',
        description: '상대방 쿨타임 잔여 시간 조회 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, args, channelId, _input, ctx }) {
        const rawArg = (args && args.length > 0 && typeof args[0] === 'string')
            ? args[0].trim()
            : '';

        // 닉네임 미입력 시 안내
        if (!rawArg) {
            const warnText = msg.error && msg.error.coolcheck_missing_name
                ? msg.error.coolcheck_missing_name(cmd)
                : `⚠️ 닉네임을 입력해 주세요. (예: ${cmd} 닉네임)`;
            return ctx.returnWarning(warnText, cmd, _input);
        }

        // 입력값 안전 제한 (50자 초과 시 차단)
        if (rawArg.length > 50) {
            return ctx.returnWarning('⚠️ 닉네임이 너무 깁니다. (50자 이내로 입력해 주세요)', cmd, _input);
        }

        const selfChannelId = channelId || (_input && _input.channelId);

        const spamGuard = _input && _input.spamGuard;
        if (!spamGuard) {
            const failText = msg.error && msg.error.coolcheck_failed
                ? msg.error.coolcheck_failed
                : '⚠️ 쿨타임 정보를 불러올 수 없습니다.';
            return ctx.returnWarning(failText, cmd, _input);
        }

        const searchTerm = rawArg.toLowerCase();

        // 자기 자신 조회 차단 - 검색 루프 진입 전에 처리
        if (selfChannelId) {
            const selfTrackerEntry = spamGuard.tracker && spamGuard.tracker.get(selfChannelId);
            const selfName = (selfTrackerEntry && selfTrackerEntry.displayName || '').toLowerCase();
            if (selfName && selfName.includes(searchTerm)) {
                const selfCheckText = msg.error && msg.error.coolcheck_self
                    ? msg.error.coolcheck_self
                    : '⚠️ 자기 자신의 쿨타임은 조회할 수 없습니다.';
                return ctx.returnWarning(selfCheckText, cmd, _input);
            }
        }

        const candidateMap = new Map(); // channelId -> displayName

        // 1. spamGuard.tracker 검색 (현재 쿨타임/이력 보유 유저)
        if (spamGuard.tracker) {
            for (const [chId, r] of spamGuard.tracker.entries()) {
                if (chId === selfChannelId) continue; // 본인 제외
                const name = (r.displayName || '').trim();
                if (name && name.toLowerCase().includes(searchTerm)) {
                    candidateMap.set(chId, { displayName: name, tracker: r });
                }
            }
        }

        // 2. spamGuard.banned 검색 (차단된 유저)
        if (spamGuard.banned) {
            for (const [chId, bData] of spamGuard.banned.entries()) {
                if (chId === selfChannelId) continue; // 본인 제외
                const name = (bData.displayName || '').trim();
                if (name && name.toLowerCase().includes(searchTerm)) {
                    const existing = candidateMap.get(chId) || {};
                    candidateMap.set(chId, { ...existing, displayName: name, banned: true });
                }
            }
        }

        // 3. stats-db 검색 (채팅한 적 있는 모든 유저 대상 보완)
        try {
            if (statsTracker && typeof statsTracker.searchUsers === 'function') {
                const dbResults = statsTracker.searchUsers({ query: rawArg, limit: 20 });
                if (dbResults && Array.isArray(dbResults.users)) {
                    for (const u of dbResults.users) {
                        if (u.channelId === selfChannelId) continue; // 본인 제외
                        if (u.channelId && u.displayName) {
                            const existing = candidateMap.get(u.channelId) || {};
                            candidateMap.set(u.channelId, { ...existing, displayName: u.displayName, dbUser: u });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[coolcheck] DB 검색 실패, 트래커 결과로 진행:', e.message);
        }

        // 일치하는 유저가 없는 경우
        if (candidateMap.size === 0) {
            const notFoundText = msg.error && msg.error.coolcheck_not_found
                ? msg.error.coolcheck_not_found(rawArg)
                : `⚠️ "${rawArg}" 닉네임을 가진 유저를 찾을 수 없습니다.`;
            return ctx.returnWarning(notFoundText, cmd, _input);
        }


        // 후보 유저 목록 구성 및 활동성 점수 계산
        const candidates = [];
        for (const [chId, data] of candidateMap.entries()) {
            const name = data.displayName || '시청자';
            const cleanName = maskProfanity(name);
            const lower = name.toLowerCase();

            let totalMessages = data.dbUser ? (data.dbUser.totalMessages || 0) : 0;
            let lastActiveTime = data.dbUser ? (data.dbUser.lastChatTime || 0) : 0;

            // stats-db 상세 조회 보완 (공개 stmt 경유 - stmts 객체와 메서드 모두 존재할 때만 접근)
            if (!data.dbUser) {
                try {
                    const stmt = statsTracker && statsTracker.stmts && statsTracker.stmts.getUserByChannelId;
                    if (stmt && typeof stmt.get === 'function') {
                        const dbRow = stmt.get(chId);
                        if (dbRow) {
                            totalMessages = dbRow.total_messages || 0;
                            lastActiveTime = dbRow.last_chat_time || 0;
                        }
                    }
                } catch (e) {
                    console.warn('[coolcheck] getUserByChannelId 조회 실패 (chId=' + chId + '):', e.message);
                }
            }

            const isExact = (lower === searchTerm);
            const startsWith = lower.startsWith(searchTerm);

            candidates.push({
                channelId: chId,
                name: cleanName,
                isExact,
                startsWith,
                totalMessages,
                lastActiveTime
            });
        }

        // 정렬: 완전 일치 > 접두사 일치 > 총 채팅수(활동성) > 최근 활동 시각
        candidates.sort((a, b) => {
            if (a.isExact !== b.isExact) return b.isExact ? 1 : -1;
            if (a.startsWith !== b.startsWith) return b.startsWith ? 1 : -1;
            if (a.totalMessages !== b.totalMessages) return b.totalMessages - a.totalMessages;
            return b.lastActiveTime - a.lastActiveTime;
        });

        // 가장 활동성이 높은 유저 1명 선택
        const topUser = candidates[0];

        const chId = topUser.channelId;
        const cleanName = topUser.name;

        const isBanned = spamGuard.banned && spamGuard.banned.has(chId);
        const info = spamGuard.getTrackerInfo ? spamGuard.getTrackerInfo(chId) : null;

        let resultText = '';
        if (isBanned) {
            resultText = msg.coolcheck && msg.coolcheck.item_banned
                ? msg.coolcheck.item_banned(cleanName)
                : `[${cleanName}] 🚫 차단됨`;
        } else if (info && info.remainingMs > 0) {
            const timeStr = formatMs(info.remainingMs);
            resultText = msg.coolcheck && msg.coolcheck.item_active
                ? msg.coolcheck.item_active(cleanName, timeStr)
                : `[${cleanName}] 🕐 ${timeStr}`;
        } else {
            resultText = msg.coolcheck && msg.coolcheck.item_clean
                ? msg.coolcheck.item_clean(cleanName)
                : `[${cleanName}] ✅ 쿨타임 없음`;
        }

        ctx.setCooldown(cmd, 0, _input);

        return `${resultText} ${ctx.getCooldownMsg(cmd)}`;
    }
};
