const fs = require('fs');
const path = require('path');
const search_lib = require('./video-matcher/search.js');
const LiveDownloader = require('./video-matcher/live-downloader.js');
const LiveSearcher = require('./video-matcher/live-searcher.js');
const { getYtdlpEnabled, saveYtdlpState } = LiveDownloader;
const configManager = require('./config-manager.js');
const { cfg, msg, schCfg } = configManager;
const eventBus = require('./event-bus.js');
const { sendChat } = require('./innertube.js');
const { insertSpaces, toUnicodeNumber } = require('./func.js');

const retryPattern = ["$1", "$1 ", " $1", "", ""];
const noticeIdx = { index: -1, sleep: 0 };

/**
 * video-metadata.json을 호출마다 fresh하게 읽음
 * (config 리로드 시 require.cache가 삭제되면 최신 데이터 반영)
 */
function getVideoMetaMap() {
    try {
        const metaPath = (configManager.PATHS && configManager.PATHS.videoMetadata)
            ? configManager.PATHS.videoMetadata
            : path.join(__dirname, '../data/video-metadata.json');
        if (!fs.existsSync(metaPath)) return new Map();
        const raw = require(metaPath);
        const arr = Array.isArray(raw) ? raw : Object.values(raw);
        return new Map(arr.map(m => [m.name, m]));
    } catch (e) {
        console.warn('⚠️ [tracker] video-metadata.json 로드 실패:', e.message);
        return new Map();
    }
}

/**
 * 에피소드가 다음 화로 넘어갔을 때 이를 감지하여
 * 유튜브 채팅창에 안내 메시지 발송
 */
function noticeChangeEpisode() {
    try {
        const rtn = search_lib.getEpisodeInfo();
        if (!rtn) return;

        if (noticeIdx.index >= 0) {
            if (rtn.index !== noticeIdx.index && noticeIdx.sleep <= 0) {
                noticeIdx.sleep = cfg.notice.sleep_count;
                const delay = cfg.notice.delay_base_ms + Math.random() * cfg.notice.delay_random_ms;

                setTimeout(() => {
                    try {
                        const info = search_lib.videoInfo[rtn.index];
                        if (!info) return;

                        const unicodenum = toUnicodeNumber(info.alias);
                        const meta = getVideoMetaMap().get(info.name);
                        const rankSuffix = meta
                            ? msg.notice.rank_suffix(toUnicodeNumber(meta.views_rank), toUnicodeNumber(meta.funny_rank))
                            : '';

                        sendChat(
                            msg.notice.now_episode(unicodenum, insertSpaces(info.title, retryPattern[0]), rankSuffix),
                            function (attempt) {
                                return msg.notice.now_episode(unicodenum, insertSpaces(info.title, retryPattern[attempt]), rankSuffix);
                            }
                        );
                    } catch (e) {
                        console.warn('⚠️ [tracker] 에피소드 알림 전송 실패:', e.message);
                    }
                }, delay);
            }
        }

        noticeIdx.index = rtn.index;
        --noticeIdx.sleep;
    } catch (e) {
        console.warn('⚠️ [tracker] noticeChangeEpisode 오류:', e.message);
    }
}

// ─── yt-dlp 프로세스 생명주기 제어 ─────────────────────────────────────────────
let ytdlpEnabled = getYtdlpEnabled();
let globalDownloader = null;
let globalSearcher = null;

function isYtdlpRunning() {
    if (globalDownloader) return globalDownloader.isRunning();
    return ytdlpEnabled;
}

function setYtdlpRunning(start) {
    ytdlpEnabled = start === true;
    saveYtdlpState(ytdlpEnabled);
    if (ytdlpEnabled) {
        if (globalSearcher && !globalSearcher.isRunning()) globalSearcher.start();
        if (globalDownloader && !globalDownloader.isRunning()) globalDownloader.start();
    } else {
        if (globalDownloader && globalDownloader.isRunning()) globalDownloader.stop();
        if (globalSearcher && globalSearcher.isRunning()) globalSearcher.stop();
    }
    return globalDownloader ? globalDownloader.isRunning() : false;
}

// ─── 파이프라인 초기화 및 이벤트 연결 ─────────────────────────────────────────
function initCommand() {
    if (initCommand.__init) return;
    initCommand.__init = true;

    const downloader = new LiveDownloader();
    globalDownloader = downloader;

    const searcher = new LiveSearcher();
    globalSearcher = searcher;

    // 세그먼트 다운로드 완료 → searcher 큐에 추가
    downloader.on('segment', (segmentInfo) => {
        searcher.enqueue(segmentInfo);
    });

    // 매칭 결과 수신 → 싱크 보정 (search.js)
    searcher.on('match', ({ result, segment }) => {
        const cmp = search_lib.getEpisodeInfo();
        const rtn = search_lib.processSearchResult(result, segment, cmp);
        search_lib.onMatchResult(rtn);
    });

    downloader.on('error', (err) => {
        console.error('📥 다운로더 에러:', err.message);
    });

    // 초기 지연 후 데몬 및 다운로더 시작
    setTimeout(() => {
        if (ytdlpEnabled) {
            searcher.start();
            setTimeout(() => {
                downloader.start();
                try {
                    const { broadcastYtdlpState } = require('./web-server.js');
                    if (broadcastYtdlpState) broadcastYtdlpState();
                } catch (_) { }
            }, (schCfg.sync && schCfg.sync.init_delay_ms) || 5000);
        } else {
            console.log('📥 [Tracker] yt-dlp가 OFF 상태로 저장되어 있어 자동 시작하지 않습니다.');
            try {
                const { broadcastYtdlpState } = require('./web-server.js');
                if (broadcastYtdlpState) broadcastYtdlpState();
            } catch (_) { }
        }
    }, 1000);

    // 에피소드 전환 안내 메시지 주기적 체크
    setInterval(noticeChangeEpisode, cfg.notice.check_interval_ms);

    // config-search.js 핫리로드 시 파이프라인 재시작
    eventBus.on('search_config_reloaded', () => {
        console.log('🔄 [Tracker] search_config_reloaded → 파이프라인 재시작');
        if (!ytdlpEnabled) return;
        if (globalDownloader && globalDownloader.isRunning()) {
            globalDownloader.restart();
            try {
                const { broadcastYtdlpState } = require('./web-server.js');
                if (broadcastYtdlpState) broadcastYtdlpState();
            } catch (_) { }
        }
        if (globalSearcher && globalSearcher.isRunning()) {
            globalSearcher.restart();
        }
    });
}

module.exports = {
    initCommand,
    noticeChangeEpisode,
    isYtdlpRunning,
    setYtdlpRunning,
    getEpisodeInfo: search_lib.getEpisodeInfo,
    onMatchResult: search_lib.onMatchResult,
    copyQuery: search_lib.copyQuery,
    get lastQuery() { return search_lib.lastQuery; }
};
