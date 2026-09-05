const { generateScheduleText, buildCycleData, getCurrentEpisodeAlias } = require('./generator.js');
const { postCommunityText } = require('../innertube.js');
const { getEpisodeInfo } = require('../tracker.js');
const fs = require('fs');
const path = require('path');
const configManager = require('../config-manager.js');
const { cfg } = configManager;

const STATE_FILE = path.join(__dirname, '../../data', 'schedule_state.json');

// ─── 스케줄러 설정 동적 헬퍼 (config-youtube.js → schedule_poster 섹션에서 로드) ───
function getEpisodeEnd() {
    return (cfg.episode && cfg.episode.end !== undefined) ? cfg.episode.end : 293;
}

function getScheduleConfig() {
    const _sp = (cfg && cfg.schedule_poster) || {};
    return {
        enabled: _sp.enable_poster === true,
        initialDelayMs: (_sp.initial_delay_sec ?? 60) * 1000,
        cycleTransitionDelayMs: (_sp.cycle_transition_delay_min ?? 5) * 60 * 1000,
    };
}

const SCHEDULE_CONFIG = new Proxy({}, {
    get(_, prop) {
        return getScheduleConfig()[prop];
    }
});

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
        return { success: false, reason: 'no_episode_info' };
    }

    const data = buildCycleData(rtn, cycleOffset);
    if (!data || data.length === 0) return { success: false, reason: 'empty_cycle_data' };

    const cycleStartTime = data[0].date.getTime();

    if (isCycleAlreadyPosted(cycleStartTime)) {
        console.log(`📊 [편성표 스케줄러] ${label}은(는) 이미 게시된 사이클입니다. (생략)`);
        return { success: true, skipped: true, reason: 'already_posted' };
    }

    const text = generateScheduleText(cycleOffset);
    if (!text) {
        console.warn('⚠️ [편성표 스케줄러] 텍스트 생성 실패');
        return { success: false, reason: 'text_generation_failed' };
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

    return { success };
}

/**
 * 293화 → 1화 전환 감지
 */
let schedulerRunning = false;
let cycleCheckTimer = null;
let cycleTransitionTimer = null;  // setTimeout 핸들 추적 (누수 방지)
let prevAlias = null;
let transitionPending = false;

function checkCycleTransition() {
    const currentAlias = getCurrentEpisodeAlias();
    if (currentAlias === null) return;

    if (prevAlias !== null && prevAlias >= getEpisodeEnd() - 2 && currentAlias <= 3 && !transitionPending) {
        transitionPending = true;
        console.log(`📊 [편성표 스케줄러] 사이클 전환 감지! (${prevAlias}화 → ${currentAlias}화)`);
        console.log(`📊 [편성표 스케줄러] ${SCHEDULE_CONFIG.cycleTransitionDelayMs / 1000}초 후 다음 사이클 편성표 게시...`);

        cycleTransitionTimer = setTimeout(async () => {
            cycleTransitionTimer = null;
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

    setTimeout(async () => {
        console.log('📊 [편성표 스케줄러] 초기 편성표(이번, 다음) 게시 확인...');
        await generateAndPost(0, "이번 사이클");
        await generateAndPost(1, "다음 사이클");

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
    // 편성표 전환 setTimeout 예약도 취소 (누수 방지)
    if (cycleTransitionTimer) {
        clearTimeout(cycleTransitionTimer);
        cycleTransitionTimer = null;
        transitionPending = false;
    }
    console.log('📊 [편성표 스케줄러] 정지');
}

/**
 * 수동으로 편성표 즉시 게시
 */
async function manualPost(cycleOffset = 0) {
    return await generateAndPost(cycleOffset, cycleOffset === 0 ? "이번 사이클" : "수동 사이클");
}

module.exports = {
    name: 'poster',
    type: 'service',
    description: '편성표 커뮤니티 자동 게시 스케줄러 (독립 서비스 모듈)',

    // 라이프사이클 핸들러 (독립 서비스 모듈)
    init() {
        const _cfg = require('../../data/config-youtube.js');
        if (_cfg && _cfg.schedule_poster && _cfg.schedule_poster.enable_poster) {
            startSchedulePoster();
        }
    },
    start() {
        startSchedulePoster();
    },
    stop() {
        stopSchedulePoster();
    },
    destroy() {
        stopSchedulePoster();
    },

    // 독립적 웹 뷰 및 웹소켓 액션 정의
    web: {
        id: 'poster',
        name: 'poster',
        title: 'Schedule Poster (편성표 스케줄러)',
        icon: '📊',
        description: '유튜브 채널 커뮤니티에 1~293화 편성표를 자동으로 생성하여 게시하는 스케줄러 모듈',
        category: 'Background Services',
        badge: 'Service',

        styles: `
            .poster-history-item { padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; }
        `,

        panel: `
            <div class="status-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin-bottom: 20px;">
                <div class="status-card glass">
                    <h3>⚡ 스케줄러 동작 상태</h3>
                    <p id="sp-status-val" style="color: #34d399; font-weight: 700;">확인 중...</p>
                </div>
                <div class="status-card glass">
                    <h3>🎬 현재 에피소드 No.</h3>
                    <p id="sp-current-alias-val" style="color: #60a5fa; font-weight: 700;">--</p>
                </div>
                <div class="status-card glass">
                    <h3>⏱️ 전환 감지 간격</h3>
                    <p id="sp-interval-val" style="color: #fbbf24; font-weight: 700;">--</p>
                </div>
                <div class="status-card glass">
                    <h3>📋 최근 게시 사이클 기록</h3>
                    <p id="sp-posted-count-val" style="color: #a78bfa; font-weight: 700;">0건</p>
                </div>
            </div>

            <div class="section-card glass" style="padding: 20px; margin-bottom: 20px;">
                <h3 style="margin: 0 0 12px 0; font-size: 1rem;">📢 커뮤니티 편성표 즉시 게시 / 테스트</h3>
                <p style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: 16px;">
                    선택한 사이클의 텍스트 편성표를 생성하여 유튜브 채널 커뮤니티에 즉시 게시합니다.
                </p>
                <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                    <select id="sp-manual-offset-select" class="form-input" style="width: auto; min-width: 190px; padding: 8px 12px; cursor: pointer;">
                        <option value="0">이번 사이클 (현재 회차 기준)</option>
                        <option value="1" selected>다음 사이클 (+1 Cycle)</option>
                        <option value="2">다다음 사이클 (+2 Cycle)</option>
                    </select>
                    <button class="btn" onclick="posterModule.manualPost()" style="background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 2px 8px rgba(16,185,129,0.3);">🚀 커뮤니티 즉시 게시</button>
                </div>
                <div id="sp-action-result" style="margin-top: 14px; font-size: 0.85rem; color: var(--text-dim);"></div>
            </div>

            <div class="section-card glass" style="padding: 20px;">
                <h3 style="margin: 0 0 12px 0; font-size: 1rem;">📜 최근 게시된 사이클 타임스탬프 이력</h3>
                <div id="sp-posted-history-list" style="font-size: 0.85rem; color: var(--text-dim); line-height: 1.6;">기록 없음</div>
            </div>
        `,

        scripts: `
            window.posterModule = (function() {
                let _ws = null;

                function setWs(ws) { _ws = ws; }
                function getWs() { return _ws || window.ws; }
                function send(obj) {
                    const socket = getWs();
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify(obj));
                    } else {
                        console.warn('[posterModule] WebSocket is not open, retrying...');
                        setTimeout(() => {
                            const retrySocket = getWs();
                            if (retrySocket && retrySocket.readyState === WebSocket.OPEN) {
                                retrySocket.send(JSON.stringify(obj));
                            }
                        }, 500);
                    }
                }
                function setTxt(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

                function refresh() { send({ action: 'getPosterStatus' }); }

                function manualPost() {
                    const sel = document.getElementById('sp-manual-offset-select');
                    const offset = sel ? parseInt(sel.value, 10) : 0;
                    const resEl = document.getElementById('sp-action-result');
                    if (resEl) resEl.innerHTML = '<span style="color:#60a5fa;">⏳ 편성표 생성 및 커뮤니티 전송 중...</span>';
                    send({ action: 'manualPostSchedule', payload: { offset } });
                }

                function renderStatus(data) {
                    if (!data) return;
                    const statusEl = document.getElementById('sp-status-val');
                    if (statusEl) {
                        const isRunning = data.running === true;
                        statusEl.textContent = isRunning ? '🟢 실행 중 (Active)' : '⚪ 정지됨 (Inactive)';
                        statusEl.style.color = isRunning ? '#34d399' : '#94a3b8';
                    }
                    setTxt('sp-current-alias-val', data.currentAlias ? data.currentAlias + '화' : '--');
                    setTxt('sp-interval-val', data.config && data.config.cycleTransitionDelayMs ? Math.round(data.config.cycleTransitionDelayMs / 60000) + '분' : '--');
                    const posted = (data.state && data.state.postedCycles) || [];
                    setTxt('sp-posted-count-val', posted.length + '건');
                    const listEl = document.getElementById('sp-posted-history-list');
                    if (listEl) {
                        if (posted.length === 0) {
                            listEl.innerHTML = '<span style="color:var(--text-dim);">최근 게시된 사이클 기록이 없습니다.</span>';
                        } else {
                            listEl.innerHTML = posted.slice().reverse().map((ts, idx) => {
                                const d = new Date(ts);
                                return '<div class="poster-history-item"><span>#' + (posted.length - idx) + ' 사이클: ' + d.toLocaleDateString('ko-KR') + ' ' + d.toLocaleTimeString('ko-KR') + '</span><span style="color:#34d399; font-weight:600;">게시됨</span></div>';
                            }).join('');
                        }
                    }
                }

                function onManualPostResult(data) {
                    const resEl = document.getElementById('sp-action-result');
                    if (data && data.success) {
                        if (resEl) resEl.innerHTML = '<span style="color:#34d399;">✅ 게시 완료 (' + new Date().toLocaleTimeString() + ')</span>';
                    } else {
                        if (resEl) resEl.innerHTML = '<span style="color:#f87171;">⚠️ 실패: ' + (data && data.reason ? data.reason : '오류') + '</span>';
                    }
                    refresh();
                }

                return { setWs, refresh, manualPost, renderStatus, onManualPostResult };
            })();
        `,

        actions: {
            getPosterStatus: async () => {
                return {
                    running: schedulerRunning,
                    config: getScheduleConfig(),
                    state: loadState(),
                    transitionPending,
                    prevAlias,
                    currentAlias: getCurrentEpisodeAlias()
                };
            },
            manualPostSchedule: async (payload) => {
                const offset = (payload && typeof payload.offset === 'number') ? payload.offset : 0;
                return await manualPost(offset);
            },
            togglePosterRunning: async (payload) => {
                const shouldRun = payload && payload.running === true;
                if (shouldRun && !schedulerRunning) {
                    startSchedulePoster();
                } else if (!shouldRun && schedulerRunning) {
                    stopSchedulePoster();
                }
                return { running: schedulerRunning };
            }
        }
    },

    startSchedulePoster,
    stopSchedulePoster,
    manualPost,
    SCHEDULE_CONFIG,
    isSchedulerRunning: () => schedulerRunning
};
