// ─── notice.js ─────────────────────────────────────────────────────────────
// 에피소드 변경 시 현재 회차 안내 메시지(now_episode) 자동 발송 백그라운드 서비스
// 트래커의 episode_changed 이벤트를 수신하여 동작
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const configManager = require('../config-manager.js');
const { cfg, msg } = configManager;
const { videoInfo } = require('../video-matcher/search.js');
const { sendChat } = require('../innertube.js');
const { insertSpaces, toUnicodeNumber } = require('../func.js');

const retryPattern = ["$1", "$1 ", " $1", "", ""];

let boundListener = null;
let pendingTimer = null;
let lastNoticeTime = 0;
let lastNotifiedIndex = -1;

/**
 * video-metadata.json을 호출마다 fresh하게 읽음
 * (config 리로드 시 최신 데이터 반영)
 */
function getVideoMetaMap() {
    try {
        const metaPath = (configManager.PATHS && configManager.PATHS.videoMetadata)
            ? configManager.PATHS.videoMetadata
            : path.join(__dirname, '../../data/video-metadata.json');
        if (!fs.existsSync(metaPath)) return new Map();
        const raw = require(metaPath);
        const arr = Array.isArray(raw) ? raw : Object.values(raw);
        return new Map(arr.map(m => [m.name, m]));
    } catch (e) {
        console.warn('⚠️ [notice] video-metadata.json 로드 실패:', e.message);
        return new Map();
    }
}

/**
 * 에피소드 안내 메시지 포맷 함수
 * @param {number} episodeIndex 
 * @param {number} [attempt=0] 
 * @returns {string|null}
 */
function formatNoticeMessage(episodeIndex, attempt = 0) {
    const info = videoInfo[episodeIndex];
    if (!info) return null;

    const unicodenum = toUnicodeNumber(info.alias);
    const meta = getVideoMetaMap().get(info.name);
    const rankSuffix = (meta && msg.notice && typeof msg.notice.rank_suffix === 'function')
        ? msg.notice.rank_suffix(toUnicodeNumber(meta.views_rank), toUnicodeNumber(meta.funny_rank))
        : '';

    const safeTitle = insertSpaces(info.title, retryPattern[attempt] !== undefined ? retryPattern[attempt] : retryPattern[0]);
    if (msg.notice && typeof msg.notice.now_episode === 'function') {
        return msg.notice.now_episode(unicodenum, safeTitle, rankSuffix);
    }
    return `📢 현재 회차는 "${unicodenum}. ${safeTitle}" 입니다.${rankSuffix}`;
}

/**
 * 유튜브 채팅창에 안내 메시지 전송
 * @param {number} episodeIndex 
 */
function announceNowEpisode(episodeIndex) {
    try {
        const info = videoInfo[episodeIndex];
        if (!info) return false;

        lastNoticeTime = Date.now();
        lastNotifiedIndex = episodeIndex;

        sendChat(
            formatNoticeMessage(episodeIndex, 0),
            function (attempt) {
                return formatNoticeMessage(episodeIndex, attempt);
            }
        );
        return true;
    } catch (e) {
        console.warn('⚠️ [notice] 회차 알림 전송 실패:', e.message);
        return false;
    }
}

/**
 * episode_changed 이벤트 핸들러
 */
function handleEpisodeChanged({ previousIndex, currentIndex, rtn }) {
    if (typeof currentIndex !== 'number' || currentIndex < 0) return;

    // 쿨다운 계산 (sleep_count * check_interval_ms)
    const noticeCfg = cfg.notice || {};
    const sleepCount = typeof noticeCfg.sleep_count === 'number' ? noticeCfg.sleep_count : 60;
    const checkInterval = typeof noticeCfg.check_interval_ms === 'number' ? noticeCfg.check_interval_ms : 5000;
    const cooldownMs = sleepCount * checkInterval;
    const now = Date.now();

    if (now - lastNoticeTime < cooldownMs && currentIndex === lastNotifiedIndex) {
        return;
    }

    if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
    }

    const delayBase = typeof noticeCfg.delay_base_ms === 'number' ? noticeCfg.delay_base_ms : 5000;
    const delayRandom = typeof noticeCfg.delay_random_ms === 'number' ? noticeCfg.delay_random_ms : 5000;
    const delay = delayBase + Math.random() * delayRandom;

    pendingTimer = setTimeout(() => {
        pendingTimer = null;
        announceNowEpisode(currentIndex);
    }, delay);
}

module.exports = {
    name: 'notice',
    icon: '📢',
    description: '회차 변경 감지 시 현재 회차 안내 메시지(now_episode) 자동 발송 서비스',

    init({ eventBus }) {
        if (boundListener) {
            eventBus.off('episode_changed', boundListener);
        }

        boundListener = (payload) => {
            handleEpisodeChanged(payload);
        };

        eventBus.on('episode_changed', boundListener);
    },

    destroy() {
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
        boundListener = null;
    },

    web: {
        title: '회차 변경 알림',
        icon: '📢',
        description: '회차 변경 감지 시 현재 회차 및 순위 정보 자동 안내 서비스',
        category: 'Background Services',
        badge: 'Service'
    },

    getVideoMetaMap,
    formatNoticeMessage,
    announceNowEpisode,
    handleEpisodeChanged,
    getStatus: () => ({
        lastNoticeTime,
        lastNotifiedIndex,
        hasPendingTimer: pendingTimer !== null
    })
};
