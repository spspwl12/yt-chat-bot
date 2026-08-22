const fs = require('fs');
const path = require('path');
const search_lib = require('./video-matcher/search.js');
const LiveDownloader = require('./video-matcher/live-downloader.js');
const LiveSearcher = require('./video-matcher/live-searcher.js');
const configManager = require('./config-manager.js');
const { cfg, msg, schCfg, videoMetaMap } = configManager;
const eventBus = require('./event-bus.js');
const { sendChat } = require('./innertube.js');
const { insertSpaces, toUnicodeNumber } = require('./func.js');

const videoInfo = search_lib.videoInfo;
const lastQuery = require(schCfg.searcher.lastquery_path);
const retryPattern = ["$1", "$1 ", " $1", "", ""];
const tempQuery = [];

/**
 * C++ 서치 엔진에서 검색된 현재 라이브 영상 싱크 데이터를 
 * 파일과 메모리(lastQuery)에 저장하여 상태를 동기화합니다.
 * @param {object} obj - 새로 찾은 영상 매칭 정보 객체
 */
function copyQuery(obj) {
    ["index", "now", "requestTime"].forEach(key => {
        lastQuery[key] = obj[key];
    });
    tempQuery.length = 0;
    const json = JSON.stringify(lastQuery, null, 4);
    fs.writeFileSync(schCfg.searcher.lastquery_path, json, 'utf-8');
    // lastquery 이력 이벤트 발생
    eventBus.emit('lastquery_update', { index: lastQuery.index, now: lastQuery.now, requestTime: lastQuery.requestTime, retry: lastQuery.retry });
}

/**
 * 최신 동기화된 데이터를 바탕으로 현재 방송 중인 회차와 시점(초)을 계산해 반환
 * @returns {object|null} 진행 중인 에피소드 정보 및 경과 시간 객체
 */
function getEpisodeInfo() {
    if (!lastQuery.requestTime)
        return null;

    return search_lib.getAdjustedVideoTime(lastQuery.requestTime, lastQuery.now, lastQuery.index);
}

/**
 * 라이브 매칭 결과를 수신하여 방영 시점 싱크를 보정합니다.
 * LiveSearcher의 'match' 이벤트 핸들러.
 *
 * @param {object} rtn - processSearchResult 결과 (getLiveVideoTime 반환값)
 */
function onMatchResult(rtn) {
    if (!rtn)
        return;

    const tolerance = (schCfg.sync && schCfg.sync.tolerance_sec) || 60;

    // 1. tempQuery의 마지막 요소와 현재 rtn 비교하여 연속성 검증
    if (tempQuery.length > 0) {
        const last = tempQuery[tempQuery.length - 1];

        const isIndexMatch = rtn.index === last.index;
        const isTimeValid = Math.abs(rtn.now - last.now) <= tolerance;

        // 연속성이 깨지면 배열 초기화
        if (!isIndexMatch || !isTimeValid) {
            tempQuery.length = 0;
        }
    }

    // 2. 현재 결과물 누적
    tempQuery.push(rtn);

    const minConsecutive = (schCfg.sync && schCfg.sync.min_consecutive) || 4;

    // 3. 샘플이 minConsecutive개 이상 모였으면 확정 채택
    if (tempQuery.length >= minConsecutive) {
        copyQuery(rtn);
        return;
    }

    // 4. 샘플 수 미달 시 기존 기록(cmp)과 대조
    const cmp = getEpisodeInfo();
    if (cmp &&
        rtn.index === cmp.index &&
        Math.abs(rtn.now - cmp.now) <= tolerance) {
        copyQuery(rtn);
        return;
    }
}

const noticeIdx = { index: -1, sleep: 0 };

/**
 * 에피소드가 다음 화로 넘어갔을 때 이를 자가 판독/감지하여
 * 유튜브 채팅창에 안내 메시지 및 봇 사용법 팁을 랜덤 전송합니다.
 */
function noticeChangeEpisode() {
    const rtn = getEpisodeInfo();

    if (!rtn)
        return;

    // 방영 중인 회차를 모니터링하다가 인덱스가 바뀐 경우를 탐지
    if (noticeIdx.index >= 0) {
        // 알림 중복 방지용 슬립(sleep) 카운터가 0 이하일 때만 알림 발생
        if (rtn.index !== noticeIdx.index && noticeIdx.sleep <= 0) {

            // 알림 도배 방지를 위해 sleep_count만큼 쿨다운 세팅
            noticeIdx.sleep = cfg.notice.sleep_count;

            // 방송 송출 딜레이와 사용자가 봇의 채팅을 자연스럽게 보게끔 랜덤 딜레이 적용
            const delay = cfg.notice.delay_base_ms + Math.random() * cfg.notice.delay_random_ms;

            setTimeout(() => {
                const info = videoInfo[rtn.index];
                const unicodenum = toUnicodeNumber(info.alias);

                // 채팅방에 '현재 방영 회차' 기본 안내 메시지 발송
                const meta = videoMetaMap.get(info.name);
                const rankSuffix = meta
                    ? msg.notice.rank_suffix(toUnicodeNumber(meta.views_rank), toUnicodeNumber(meta.funny_rank))
                    : '';
                sendChat(msg.notice.now_episode(unicodenum, insertSpaces(info.title, retryPattern[0]), rankSuffix),
                    function (attempt) {
                        return msg.notice.now_episode(unicodenum, insertSpaces(info.title, retryPattern[attempt]), rankSuffix);
                    });

                // 확률(tip_chance)에 맞춰 사용자 가이드(꿀팁) 중 한 가지 랜덤 추가 발송
                if (Math.random() < cfg.notice.tip_chance) {
                    // tip messages if needed
                }
            }, delay);
        }
    }

    // 감지 상태 갱신 (인덱스 유지, 슬립 감소)
    noticeIdx.index = rtn.index;
    --noticeIdx.sleep;
}

const YTDLP_STATE_FILE = path.join(__dirname, '../data', 'ytdlp-state.json');
let ytdlpEnabled = true;
try {
    ytdlpEnabled = JSON.parse(fs.readFileSync(YTDLP_STATE_FILE, 'utf8')).enabled !== false;
} catch { }

function saveYtdlpState() {
    try {
        fs.writeFileSync(YTDLP_STATE_FILE, JSON.stringify({ enabled: ytdlpEnabled }), 'utf8');
    } catch { }
}

let globalDownloader = null;
let globalSearcher = null;

function isYtdlpRunning() {
    if (globalDownloader) {
        return globalDownloader.isRunning();
    }
    return ytdlpEnabled;
}

function setYtdlpRunning(start) {
    ytdlpEnabled = start === true;
    saveYtdlpState();
    if (ytdlpEnabled) {
        // ON: searcher 먼저 시작, 이후 downloader 시작
        if (globalSearcher && !globalSearcher.isRunning()) {
            globalSearcher.start();
        }
        if (globalDownloader && !globalDownloader.isRunning()) {
            globalDownloader.start();
        }
    } else {
        // OFF: downloader 먼저 종료, 이후 searcher 종료
        if (globalDownloader && globalDownloader.isRunning()) {
            globalDownloader.stop();
        }
        if (globalSearcher && globalSearcher.isRunning()) {
            globalSearcher.stop();
        }
    }
    return globalDownloader ? globalDownloader.isRunning() : false;
}

/**
 * 봇 기동 시 최초 1회만 실행.
 * LiveDownloader + LiveSearcher를 시작하고 이벤트 핸들러를 등록.
 * 에피소드 전환 안내 타이머도 활성화.
 */
function initCommand() {
    // 단축 평가 검사: 이미 초기화가 된 상태라면 중복 스케줄링이 되지 않도록 종료
    if (initCommand.__init)
        return;
    initCommand.__init = true;

    // LiveDownloader 초기화 (실시간 20초 세그먼트 연속 다운로드)
    const downloader = new LiveDownloader();
    globalDownloader = downloader;

    // LiveSearcher 초기화 (searcher.exe 데몬 상시 구동)
    const searcher = new LiveSearcher();
    globalSearcher = searcher;

    // 이벤트 연결: 세그먼트 다운로드 완료 → searcher 큐에 추가
    downloader.on('segment', (segmentInfo) => {
        searcher.enqueue(segmentInfo);
    });

    // 이벤트 연결: 매칭 결과 수신 → 싱크 보정
    searcher.on('match', ({ result, segment }) => {
        const cmp = getEpisodeInfo();
        const rtn = search_lib.processSearchResult(result, segment, cmp);
        onMatchResult(rtn);
    });

    // 에러 로깅
    downloader.on('error', (err) => {
        console.error('📥 다운로더 에러:', err.message);
    });

    // 초기 지연 후 시작
    setTimeout(() => {
        if (ytdlpEnabled) {
            searcher.start();    // 데몬 먼저 시작 (DB 로드 시간 필요)
            setTimeout(() => {
                downloader.start(); // 데몬 준비 후 다운로더 시작
                try {
                    const { broadcastYtdlpState } = require('./web-server.js');
                    if (broadcastYtdlpState) broadcastYtdlpState();
                } catch (_) { }
            }, (schCfg.sync && schCfg.sync.init_delay_ms) || 5000);
        } else {
            console.log('📥 [Tracker] yt-dlp가 OFF 상태로 저장되어 있어 searcher/downloader 자동 시작하지 않습니다.');
            try {
                const { broadcastYtdlpState } = require('./web-server.js');
                if (broadcastYtdlpState) broadcastYtdlpState();
            } catch (_) { }
        }
    }, 1000);

    // 에피소드 전환 안내 메시지를 체크하는 타이머 활성화
    setInterval(noticeChangeEpisode, cfg.notice.check_interval_ms);

    // config-search.js 실시간 핫리로드 이벤트 처리
    eventBus.on('search_config_reloaded', () => {
        console.log('🔄 [Tracker] search_config_reloaded 이벤트 수신: 파이프라인 실시간 즉시 갱신');
        if (!ytdlpEnabled) return; // OFF 상태이면 아무것도 건드리지 않음
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
    getEpisodeInfo,
    isYtdlpRunning,
    setYtdlpRunning,
    onMatchResult,
    copyQuery,
    lastQuery
};
