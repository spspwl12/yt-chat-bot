const search_lib = require('./video-matcher/search.js');
const LiveDownloader = require('./video-matcher/live-downloader.js');
const LiveSearcher = require('./video-matcher/live-searcher.js');
const { getYtdlpEnabled, saveYtdlpState } = LiveDownloader;
const configManager = require('./config-manager.js');
const { cfg, schCfg } = configManager;
const eventBus = require('./event-bus.js');

let lastEpisodeIndex = -1;

/**
 * 에피소드가 다음 화로 넘어갔을 때 이를 감지하여
 * episode_changed 이벤트 발행
 */
function checkEpisodeChange() {
    try {
        const rtn = search_lib.getEpisodeInfo();
        if (!rtn) return;

        if (lastEpisodeIndex >= 0 && rtn.index !== lastEpisodeIndex) {
            eventBus.emit('episode_changed', {
                previousIndex: lastEpisodeIndex,
                currentIndex: rtn.index,
                rtn: rtn
            });
        }

        lastEpisodeIndex = rtn.index;
    } catch (e) {
        console.warn('⚠️ [tracker] checkEpisodeChange 오류:', e.message);
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

    // 에피소드 전환 주기적 체크
    setInterval(checkEpisodeChange, (cfg.notice && cfg.notice.check_interval_ms) || 5000);

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
    checkEpisodeChange,
    noticeChangeEpisode: checkEpisodeChange,
    isYtdlpRunning,
    setYtdlpRunning,
    getEpisodeInfo: search_lib.getEpisodeInfo,
    onMatchResult: search_lib.onMatchResult,
    copyQuery: search_lib.copyQuery,
    get lastQuery() { return search_lib.lastQuery; }
};
