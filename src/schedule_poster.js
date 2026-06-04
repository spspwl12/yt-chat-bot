const { generateScheduleText, buildCycleData, getCurrentEpisodeAlias } = require('./schedule_generator.js');
const { postCommunityText } = require('./innertube.js');
const { getEpisodeInfo } = require('./commands.js');
const fs = require('fs');
const path = require('path');
const cfg = require('./data/config-youtube.js');

const EPISODE_END = cfg.episode.end;
const STATE_FILE = path.join(__dirname, 'data', 'schedule_state.json');

// ─── 스케줄러 설정 (config-youtube.js → schedule_poster 섹션에서 로드) ───
const _sp = cfg.schedule_poster || {};
const SCHEDULE_CONFIG = {
    initialDelayMs: (_sp.initial_delay_sec ?? 60) * 1000,
    cycleTransitionDelayMs: (_sp.cycle_transition_delay_min ?? 5) * 60 * 1000,
};

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        }
    } catch (e) { }
    return { postedCycles: [] };
}

function saveState(state) {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function isCycleAlreadyPosted(cycleDateMs) {
    const state = loadState();
    // 추정 시작 시간 오차 허용 범위 (2시간)
    const TOLERANCE = 2 * 60 * 60 * 1000;
    return state.postedCycles.some(time => Math.abs(time - cycleDateMs) < TOLERANCE);
}

function markCyclePosted(cycleDateMs) {
    const state = loadState();
    state.postedCycles.push(cycleDateMs);
    if (state.postedCycles.length > 10) state.postedCycles.shift();
    saveState(state);
}

/**
 * 텍스트 편성표를 생성하고 커뮤니티에 게시
 */
async function generateAndPost(cycleOffset, label) {
    console.log(`📊 [편성표 스케줄러] ${label} 생성 중... (offset: ${cycleOffset})`);

    const rtn = getEpisodeInfo();
    if (!rtn) {
        console.warn('⚠️ [편성표 스케줄러] 에피소드 정보 없음');
        return false;
    }

    const data = buildCycleData(rtn, cycleOffset);
    if (!data || data.length === 0) return false;

    const cycleStartTime = data[0].date.getTime();

    if (isCycleAlreadyPosted(cycleStartTime)) {
        console.log(`📊 [편성표 스케줄러] ${label}은(는) 이미 게시된 사이클입니다. (생략)`);
        return true;
    }

    const text = generateScheduleText(cycleOffset);
    if (!text) {
        console.warn('⚠️ [편성표 스케줄러] 텍스트 생성 실패');
        return false;
    }

    const postText = `📺 편성표\n\n${text}\n\n⚙️ 이 편성표는 봇에 의해 자동 생성됩니다.`;

    console.log(`📊 [편성표 스케줄러] 채널 커뮤니티에 게시 중...`);
    const success = await postCommunityText(postText);

    if (success) {
        console.log(`✅ [편성표 스케줄러] ${label} 게시 완료`);
        markCyclePosted(cycleStartTime);
    } else {
        console.warn(`⚠️ [편성표 스케줄러] ${label} 게시 실패`);
    }

    return success;
}

/**
 * 293화 → 1화 전환 감지
 * 사이클이 바뀌면 다다음 편성표를 생성하여 게시
 */
let schedulerRunning = false;
let cycleCheckTimer = null;
let prevAlias = null;
let transitionPending = false;

function checkCycleTransition() {
    const currentAlias = getCurrentEpisodeAlias();
    if (currentAlias === null) return;

    // 293 → 1 전환 감지 (이전 화가 마지막 근처이고, 현재 화가 처음 근처)
    if (prevAlias !== null && prevAlias >= EPISODE_END - 2 && currentAlias <= 3 && !transitionPending) {
        transitionPending = true;
        console.log(`📊 [편성표 스케줄러] 사이클 전환 감지! (${prevAlias}화 → ${currentAlias}화)`);
        console.log(`📊 [편성표 스케줄러] ${SCHEDULE_CONFIG.cycleTransitionDelayMs / 1000}초 후 다음 사이클 편성표 게시...`);

        setTimeout(async () => {
            // 현재 방금 시작한 사이클 기준 다음 사이클(offset: 1) = 다다음 사이클
            await generateAndPost(1, "다음 사이클");
            transitionPending = false;
        }, SCHEDULE_CONFIG.cycleTransitionDelayMs);
    }

    prevAlias = currentAlias;
}

/**
 * 편성표 자동 게시 스케줄러 시작
 */
function startSchedulePoster() {
    if (schedulerRunning) {
        console.warn('⚠️ [편성표 스케줄러] 이미 실행 중');
        return;
    }
    schedulerRunning = true;

    console.log('═══════════════════════════════════════');
    console.log('  📊 편성표 커뮤니티 자동 게시 스케줄러 시작');
    console.log('═══════════════════════════════════════');

    // 초기 딜레이 후 첫 편성표 게시
    setTimeout(async () => {
        console.log('📊 [편성표 스케줄러] 초기 편성표(이번, 다음) 게시 확인...');
        await generateAndPost(0, "이번 사이클");
        await generateAndPost(1, "다음 사이클");

        // 293화 전환 감지 타이머 시작
        cycleCheckTimer = setInterval(checkCycleTransition, SCHEDULE_CONFIG.cycleTransitionDelayMs);
        console.log(`📊 [편성표 스케줄러] 사이클 전환 감지 시작 (${SCHEDULE_CONFIG.cycleTransitionDelayMs / 1000}초 간격)`);

    }, SCHEDULE_CONFIG.initialDelayMs);

    console.log(`📊 [편성표 스케줄러] ${SCHEDULE_CONFIG.initialDelayMs / 1000}초 후 시작...`);
}

/**
 * 스케줄러 정지
 */
function stopSchedulePoster() {
    schedulerRunning = false;
    if (cycleCheckTimer) {
        clearInterval(cycleCheckTimer);
        cycleCheckTimer = null;
    }
    console.log('📊 [편성표 스케줄러] 정지');
}

/**
 * 수동으로 편성표 즉시 게시 (디버그/관리용)
 */
async function manualPost(cycleOffset = 0) {
    return await generateAndPost(cycleOffset, cycleOffset === 0 ? "이번 사이클" : "수동 사이클");
}

module.exports = {
    startSchedulePoster,
    stopSchedulePoster,
    manualPost,
    SCHEDULE_CONFIG,
};
