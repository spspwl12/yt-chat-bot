// ─── cycle.js ─────────────────────────────────────────────────────────────
// 바퀴수 및 완주 횟수 계산 모듈 (스트리밍 누적 오차 / 봇 재시작 공백 완벽 해결)
// 사용법: !바퀴, !바퀴수, !회차수, !몇바퀴, !반복, !사이클
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const cfg = require("../../data/config-youtube.js");
const msg = require("../../data/config-messages.js");
const { videoInfo, getEditOffset } = require("../video-matcher/search.js");
const { toUnicodeNumber, insertSpaces } = require("../func.js");

const retryPattern = ["$1", "$1 ", " $1", "", ""];
const STATE_FILE = path.join(__dirname, "../../data", "cycle_state.json");

/**
 * 스트리밍 시작 기준 시각 (config-youtube.js -> episode.stream_start_time)
 */
function getStreamStartTime() {
    const raw = cfg.episode && cfg.episode.stream_start_time;
    if (raw) {
        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime())) return parsed.getTime();
    }
    return null;
}

/**
 * 1사이클(1~124화)에 포함되는 활성 에피소드 목록 반환
 */
function getCycleEpisodes() {
    const epStart = cfg.episode && cfg.episode.start !== undefined ? cfg.episode.start : 1;
    const epEnd = cfg.episode && cfg.episode.end !== undefined ? cfg.episode.end : 124;
    return videoInfo.filter((e) => {
        if (e.disable) return false;
        const aliasNum = parseInt(e.alias, 10);
        return !isNaN(aliasNum) && aliasNum >= epStart && aliasNum <= epEnd;
    });
}

/**
 * 1화 시작점부터 특정 index 시작 직전까지의 누적 시간(초) 반환
 */
function getElapsedWithinCycle(targetIndex, cycleEpisodes) {
    let sec = 0;
    for (const ep of cycleEpisodes) {
        const epIdx = videoInfo.indexOf(ep);
        if (epIdx !== -1 && epIdx < targetIndex) {
            sec += ep._streamDurationSec || 0;
        } else if (epIdx === targetIndex) {
            break;
        }
    }
    return sec;
}

/**
 * 바퀴수 영구 저장 상태 관리 (cycle_state.json)
 */
function loadCycleState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
            if (typeof parsed.completedRepeats === "number") {
                return parsed;
            }
        }
    } catch (_) {}

    return null;
}

function saveCycleState(state) {
    try {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (e) {
        console.warn("⚠️ [cycle] cycle_state.json 저장 실패:", e.message);
    }
}

/**
 * 최초 상태 파일이 없을 때 config-youtube.js의 stream_start_time을 기준으로
 * 초기 완주 바퀴수를 추정 설정
 */
function initializeCycleState(rtn, totalCycleSec, secFromStart) {
    const streamStartTime = getStreamStartTime();
    const nowTime = Date.now();

    let completedRepeats = 0;
    if (streamStartTime) {
        const totalElapsedSec = Math.max(0, (nowTime - streamStartTime) / 1000);
        completedRepeats = Math.max(0, Math.round((totalElapsedSec - secFromStart) / totalCycleSec));
    }

    const state = {
        completedRepeats: completedRepeats,
        lastObservedIndex: rtn.index,
        lastUpdated: nowTime,
    };

    saveCycleState(state);
    return state;
}

/**
 * 두 관측 index 사이(이전 index -> 현재 index)에 경과한 완주 사이클 수 계산
 */
function calcPassedCycles(prevIndex, curIndex, offSec, totalCycleSec, cycleEpisodes) {
    if (prevIndex === undefined || prevIndex === null || curIndex === undefined || curIndex === null) return 0;

    const prevPos = getElapsedWithinCycle(prevIndex, cycleEpisodes);
    const curPos = getElapsedWithinCycle(curIndex, cycleEpisodes);

    let cycleDist = curPos - prevPos;
    let baseCycleCross = 0;

    // 인덱스가 역전되었으면 (예: 121(122화) -> 4(5화) 등) 적어도 1바퀴는 완주함
    if (curIndex < prevIndex) {
        cycleDist += totalCycleSec;
        baseCycleCross = 1;
    }

    if (!offSec || offSec <= 0) {
        return baseCycleCross;
    }

    const extraCycles = Math.round((offSec - cycleDist) / totalCycleSec);
    return Math.max(baseCycleCross, baseCycleCross + extraCycles);
}

/**
 * 회차 전환 및 상태 동기화 처리
 */
function applyTransition(state, currentIndex, totalCycleSec, cycleEpisodes) {
    const prevIndex = state.lastObservedIndex;
    const nowTime = Date.now();
    const offSec = state.lastUpdated ? Math.max(0, (nowTime - state.lastUpdated) / 1000) : 0;

    const passedCycles = calcPassedCycles(prevIndex, currentIndex, offSec, totalCycleSec, cycleEpisodes);
    if (passedCycles > 0) {
        state.completedRepeats += passedCycles;
        const prevAlias = videoInfo[prevIndex] ? videoInfo[prevIndex].alias : prevIndex;
        const curAlias = videoInfo[currentIndex] ? videoInfo[currentIndex].alias : currentIndex;
        console.log(
            `🔄 [cycle] 사이클 전환 감지! ${prevAlias}화 ➔ ${curAlias}화 (완주 +${passedCycles}회 ➔ 총 ${state.completedRepeats}회 완료)`,
        );
    }

    state.lastObservedIndex = currentIndex;
    state.lastUpdated = nowTime;
    saveCycleState(state);
}

/**
 * 실시간 영상 위치 기반 바퀴수 및 완주 횟수 계산
 */
function calculateCycleProgress(rtn) {
    const cycleEpisodes = getCycleEpisodes();
    if (!cycleEpisodes.length) return null;

    // 1사이클 전체 스트리밍 재생 시간 합산
    const totalCycleSec = cycleEpisodes.reduce((acc, ep) => acc + (ep._streamDurationSec || 0), 0);
    if (totalCycleSec <= 0) return null;

    // 현재 방영 중인 에피소드 정보
    const currentEp = videoInfo[rtn.index];
    if (!currentEp) return null;

    const streamNow = Math.max(0, rtn.now - getEditOffset(currentEp._editParsed, rtn.now));

    // 1화 시작점부터 현재 재생 시점(streamNow)까지의 총 재생 시간 계산
    const secFromStart =
        getElapsedWithinCycle(rtn.index, cycleEpisodes) +
        Math.min(streamNow, currentEp._streamDurationSec || streamNow);

    // 상태 로드 또는 초기화
    let state = loadCycleState();
    if (!state) {
        state = initializeCycleState(rtn, totalCycleSec, secFromStart);
    } else {
        // 봇 재부팅 후 첫 호출이거나 인덱스가 달라졌을 때 전환 판정
        if (state.lastObservedIndex !== rtn.index) {
            applyTransition(state, rtn.index, totalCycleSec, cycleEpisodes);
        }
    }

    const completedRepeats = state.completedRepeats;
    const currentRepeat = completedRepeats + 1;

    // 현재 바퀴 진행률 (%)
    const progressPercent = Math.min(100, Math.max(0, (secFromStart / totalCycleSec) * 100)).toFixed(1);

    // 마지막 회차수 (config 기준)
    const lastEpisode = cfg.episode.end;

    // 이번 사이클 잔여 시간 (분)
    const remainingCycleSec = Math.max(0, totalCycleSec - secFromStart);
    const remainingCycleMin = Math.ceil(remainingCycleSec / 60);

    // 현재 에피소드 잔여 시간 (분)
    const epRemainingSec = Math.max(0, (currentEp._streamDurationSec || 0) - streamNow);
    const remainingEpMin = Math.ceil(epRemainingSec / 60);

    return {
        completedRepeats,
        currentRepeat,
        progressPercent,
        totalCycleSec,
        currentAlias: currentEp.alias,
        currentTitle: currentEp.shorten || currentEp.title,
        lastEpisode,       // 마지막 회차수 (예: 124)
        remainingCycleMin, // 이번 사이클 완료까지 남은 분
        remainingEpMin,    // 현재 에피소드 종료까지 남은 분
    };
}

let boundListener = null;

module.exports = {
    name: "cycle",
    group: "cycle",
    icon: "🔄",
    aliases: ["!몇트", "!몆트", "!현재몇트", "!지금몇트", "!ㅁㅌ", "!바퀴", "!몇바퀴", "!사이클", "!cycle"],
    description: "1화부터 124화까지의 현재 방영 바퀴수 및 완주 횟수 계산 출력 (실제 스트리밍 전환 영구 보존)",

    // 모듈 라이프사이클 이벤트 바인딩 (트래커의 episode_changed 이벤트 자동 감지)
    init({ eventBus }) {
        if (!eventBus) return;
        if (boundListener) {
            eventBus.off("episode_changed", boundListener);
            boundListener = null;
        }

        boundListener = ({ currentIndex }) => {
            const cycleEpisodes = getCycleEpisodes();
            const totalCycleSec = cycleEpisodes.reduce((acc, ep) => acc + (ep._streamDurationSec || 0), 0);

            let state = loadCycleState();
            if (state) {
                applyTransition(state, currentIndex, totalCycleSec, cycleEpisodes);
            }
        };

        eventBus.on("episode_changed", boundListener);
    },

    destroy() {
        boundListener = null;
    },

    web: {
        title: "바퀴수 조회",
        icon: "🔄",
        description: "실시간 스트리밍 바퀴수 및 누적 완주 횟수 계산 모듈",
        category: "Commands",
        badge: "Command",
    },

    async execute({ cmd, rtn, _input, ctx }) {
        ctx.setCooldown(cmd, 0, _input);

        if (!rtn) {
            return ctx.returnWarning("⚠️ 현재 방영 정보를 확인할 수 없습니다.", cmd, _input);
        }

        const data = calculateCycleProgress(rtn);
        if (!data) {
            return ctx.returnWarning("⚠️ 에피소드 재생 시간 정보를 계산할 수 없습니다.", cmd, _input);
        }

        const unicodeAlias = toUnicodeNumber(data.currentAlias);
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        const formatMessage = (attempt) => {
            const safeTitle = insertSpaces(data.currentTitle, retryPattern[attempt]);
            if (msg.cycle && typeof msg.cycle.current === "function") {
                return msg.cycle.current(
                    data.currentRepeat,
                    data.completedRepeats,
                    data.progressPercent,
                    unicodeAlias,
                    safeTitle,
                    cooldownMsg,
                    data.currentAlias,      // 현재회차 (숫자)
                    data.lastEpisode,       // 마지막회차수
                    data.remainingCycleMin, // 이번 사이클 잔여 분
                    data.remainingEpMin,    // 현재 에피소드 잔여 분
                );
            }
            return ``;
        };

        return {
            msg: formatMessage(0),
            proc: function (attempt) {
                return formatMessage(attempt);
            },
        };
    },

    calculateCycleProgress,
    calcPassedCycles,
    loadCycleState,
    saveCycleState,
    getStreamStartTime,
    getCycleEpisodes,
};
