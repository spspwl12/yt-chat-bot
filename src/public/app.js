let ws;
let pinger;
let searchLogCount = 0;
let cmdLogCount = 0;

// ══════════════════════════════════════════════
//  Timeline Slider 상태
// ══════════════════════════════════════════════
const TL = {
    history: [],        // lastqueryHistory 배열 (서버에서 수신)
    total: 0,           // 전체 이력 건수
    isLive: true,       // 현재 LIVE 상태 여부
    currentHistIdx: -1, // -1 = 현재(LIVE)
    debounceTimer: null
};

const tlSlider = document.getElementById('timeline-slider');
const tlEpIndex = document.getElementById('tl-ep-index');
const tlEpTime = document.getElementById('tl-ep-time');
const tlDiffCard = document.getElementById('tl-diff-card');
const tlDiffValue = document.getElementById('tl-diff-value');
const tlTotalCount = document.getElementById('tl-total-count');
const tlRawCard = document.getElementById('tl-raw-card');
const tlRawValue = document.getElementById('tl-raw-value');
const tlTickOldest = document.getElementById('tl-tick-oldest');
const tlTickMid = document.getElementById('tl-tick-mid');

function tlFmtDuration(sec) {
    if (sec === null || sec === undefined) return '--';
    const absSec = Math.abs(sec);
    const h = Math.floor(absSec / 3600);
    const m = Math.floor((absSec % 3600) / 60);
    const s = Math.floor(absSec % 60);
    const sign = sec < 0 ? '-' : '+';
    if (h > 0) return `${sign}${h}:​${String(m).padStart(2, '0')}:​${String(s).padStart(2, '0')}`;
    if (m > 0) return `${sign}${m}분 ${s}초`;
    return `${sign}${s}초`;
}

function tlFmtTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function tlFmtShort(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function secToHHMMSS(sec) {
    if (!sec || isNaN(sec)) return '--:--';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function tlUpdateSliderBackground() {
    const max = parseInt(tlSlider.max) || 100000;
    let val = parseInt(tlSlider.value);
    if (isNaN(val)) val = max;
    const pct = (val / max * 100).toFixed(2);
    tlSlider.style.setProperty('--slider-pct', pct + '%');
}

function tlUpdateTickLabels() {
    if (TL.history.length === 0) {
        tlTickOldest.textContent = '--';
        tlTickMid.textContent = '--';
        return;
    }
    const oldest = TL.history[0];
    const mid = TL.history[Math.floor(TL.history.length / 2)];
    if (oldest) tlTickOldest.textContent = tlFmtShort(oldest.recordedAt);
    if (mid) tlTickMid.textContent = tlFmtShort(mid.recordedAt);
}

function tlSetLiveMode() {
    TL.isLive = true;
    TL.currentHistIdx = -1;
    tlSlider.value = tlSlider.max;
    tlUpdateSliderBackground();
    tlDiffCard.style.display = '';
    tlDiffValue.textContent = '--';
    tlRawCard.style.display = '';
    tlRawValue.textContent = '--';
}

function tlClearHistory() {
    if (confirm('모든 타임라인 이력을 삭제하시겠습니까?')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'clearLastqueryHistory' }));
            tlResetToLive();
        }
    }
}

function tlResetToLive() {
    tlSetLiveMode();
    // 현재 상태로 UI 갱신
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'getState' }));
    }
}

function tlLoadHistory() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'getLastqueryHistory' }));
    }
}

function tlHandleHistoryData(data) {
    TL.history = data.history || [];
    TL.total = data.total || 0;
    tlTotalCount.textContent = `이력 ${TL.total.toLocaleString()}건`;

    // 슬라이더 max = 이력 총 건수 (인덱스 0~total-1)
    // value = total → 현재(LIVE)
    const maxVal = Math.max(TL.total, 1);
    tlSlider.min = 0;
    tlSlider.max = maxVal;

    if (TL.isLive) {
        tlSlider.value = maxVal;
    }
    tlUpdateSliderBackground();
    tlUpdateTickLabels();

    // 현재 query로 즉시 표시
    if (data.current && TL.isLive) {
        tlUpdateFromQuery(data.current, null);
    }
}

function tlUpdateFromQuery(query, diffSec, epInfo) {
    if (!query) return;
    // 회차 번호 표시
    if (epInfo && epInfo.index !== undefined) {
        tlEpIndex.textContent = `${epInfo.index + 1}화`;
    } else if (query.index !== undefined) {
        tlEpIndex.textContent = `${query.index + 1}화`;
    }

    // 시간 표시: 현재 보정된 video time 기준
    if (epInfo && epInfo.now !== undefined) {
        tlEpTime.textContent = secToHHMMSS(epInfo.now);
    } else if (query.now !== undefined) {
        let approxNow = query.now;
        if (query.requestTime) {
            approxNow += (Date.now() - query.requestTime) / 1000;
        }
        tlEpTime.textContent = secToHHMMSS(approxNow);
    }

    // 현재 lastquery.now 와 과거 lastquery.now 의 차이(초) 표시 - 항상 표시
    tlDiffCard.style.display = '';
    if (!TL.isLive && diffSec !== null && diffSec !== undefined) {
        tlDiffValue.textContent = tlFmtDuration(diffSec);
    } else {
        tlDiffValue.textContent = '--';
    }
}

function tlHandleStateAtHistory(payload) {
    if (!payload) return;
    tlUpdateFromQuery(payload.query, payload.diffSec, payload.episodeInfo);

    // 기록 시점 카드: 과거 lastquery의 원본(raw) 화수와 시간 표시
    if (payload.query) {
        tlRawCard.style.display = '';
        const rawEp = payload.query.index !== undefined ? `${payload.query.index + 1}화` : '--화';
        const rawTime = secToHHMMSS(payload.query.now);
        tlRawValue.textContent = `${rawEp} · ${rawTime}`;
    }

    // 대시보드 전체 상태 업데이트 (에피소드 정보 반영)
    if (payload.episodeInfo) {
        const totalEp = payload.totalEpisodes || '--';
        const aliasStr = payload.episodeAlias ? ` (${payload.episodeAlias})` : '';
        document.getElementById('stat-episode').innerText = `${payload.episodeInfo.index} / ${totalEp}${aliasStr}`;
        document.getElementById('stat-sec').innerText = `${secToTime(payload.episodeInfo.now)} / ${secToTime(payload.totalTime)}`;
    }
    if (payload.schedule) {
        renderSchedule(payload.schedule);
    }
}

// DOM 로드 후 슬라이더 이벤트 등록
document.addEventListener('DOMContentLoaded', () => {
    tlSlider.addEventListener('input', () => {
        tlUpdateSliderBackground();
        const max = parseInt(tlSlider.max) || 1;
        const val = parseInt(tlSlider.value);

        if (val >= max) {
            // LIVE 모드
            tlSetLiveMode();
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'getState' }));
            }
            return;
        }

        // 과거 모드
        TL.isLive = false;
        TL.currentHistIdx = val; // val이 곧 history 배열 인덱스

        // 해당 인덱스의 이력 데이터 즉시 UI 반영 (로컬) - 회차/시간만
        if (TL.history.length > 0 && val < TL.history.length) {
            const entry = TL.history[val];
            if (entry) {
                tlEpIndex.textContent = `${(entry.index !== undefined ? entry.index + 1 : '--')}화`;
                let approxNow = entry.now || 0;
                if (entry.requestTime) {
                    approxNow += (Date.now() - entry.requestTime) / 1000;
                }
                tlEpTime.textContent = secToHHMMSS(approxNow);
                // diff는 서버 응답 전까지 '...' 로 표시 (깜빡거림 방지)
                tlDiffCard.style.display = '';
                tlDiffValue.textContent = '...';
                // 기록 시점: 과거 lastquery의 원본 화수/시간 즉시 표시
                tlRawCard.style.display = '';
                const rawEp = entry.index !== undefined ? `${entry.index + 1}화` : '--화';
                const rawTime = secToHHMMSS(entry.now);
                tlRawValue.textContent = `${rawEp} · ${rawTime}`;
            }
        }

        // 서버에 상태 조회 (디바운스)
        clearTimeout(TL.debounceTimer);
        TL.debounceTimer = setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    action: 'getStateAtHistory',
                    payload: { historyIndex: val }
                }));
            }
        }, 50);
    });

    // 슬라이더 드래그 종료 시 최종 조회
    tlSlider.addEventListener('change', () => {
        clearTimeout(TL.debounceTimer);
        const max = parseInt(tlSlider.max) || 1;
        const val = parseInt(tlSlider.value);
        if (val < max && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'getStateAtHistory',
                payload: { historyIndex: val }
            }));
        }
    });
});

// ── Mobile Sidebar Toggle ──
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebar-overlay');
const hamburger = document.getElementById('hamburger-btn');

function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
}

function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
}

hamburger.addEventListener('click', openSidebar);
overlay.addEventListener('click', closeSidebar);

function sendSimulatedChat() {
    const input = document.getElementById('debug-chat-input');
    const text = input.value.trim();
    if (!text) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'simulate_chat', payload: text }));
        input.value = '';
        showToast(`가상 입력 전송: ${text}`);
    } else {
        showToast('WebSocket 연결이 끊겨있습니다.', true);
    }
}

// ── UI Interactions ──
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

        const targetId = target.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
        target.classList.add('active');

        // Close sidebar on mobile after nav click
        closeSidebar();

        // Fetch relevant data on tab switch
        if (ws && ws.readyState === WebSocket.OPEN) {
            if (targetId === 'tab-live') ws.send(JSON.stringify({ action: 'getState' }));
            if (targetId === 'tab-chat') ws.send(JSON.stringify({ action: 'getChat' }));
            if (targetId === 'tab-spam') ws.send(JSON.stringify({ action: 'getSpam' }));
            if (targetId === 'tab-search') ws.send(JSON.stringify({ action: 'getSearchLogs' }));
            if (targetId === 'tab-commands') ws.send(JSON.stringify({ action: 'getCommandLogs' }));
            if (targetId === 'tab-schedule') ws.send(JSON.stringify({ action: 'getSchedule' }));
            if (targetId === 'tab-stats') {
                loadStatsOverview();
                searchUserStats();
            }
            if (targetId === 'tab-videoinfo') ws.send(JSON.stringify({ action: 'getVideoInfo' }));
            if (targetId === 'tab-config') ws.send(JSON.stringify({ action: 'getConfig' }));
            if (targetId === 'tab-videomatching') ws.send(JSON.stringify({ action: 'getConfig' }));
            if (targetId === 'tab-config-messages') ws.send(JSON.stringify({ action: 'getConfigMessages' }));
            if (targetId === 'tab-config-profanity') ws.send(JSON.stringify({ action: 'getProfanityList' }));
            if (targetId === 'tab-config-music') ws.send(JSON.stringify({ action: 'getVideoMusic' }));
            if (targetId === 'tab-config-metadata') ws.send(JSON.stringify({ action: 'getVideoMetadata' }));
        }
    });
});

function showToast(message, isError = false) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (isError) toast.style.borderLeftColor = 'var(--error)';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
}

function fmtTime(ts) {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function secToTime(sec) {
    if (!sec || isNaN(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── WebSocket Logic ──
function connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.binaryType = 'arraybuffer';

    const originalSend = ws.send.bind(ws);
    ws.send = async function (data) {
        if (typeof data === 'string') {
            try {
                const cs = new CompressionStream('deflate');
                const writer = cs.writable.getWriter();
                writer.write(new TextEncoder().encode(data));
                writer.close();
                const response = new Response(cs.readable);
                const buffer = await response.arrayBuffer();
                originalSend(buffer);
                return;
            } catch (e) {
                console.error("Compression err", e);
            }
        }
        originalSend(data);
    };

    ws.onopen = () => {
        document.getElementById('status-dot').classList.add('connected');
        document.getElementById('status-dot-mobile').classList.add('connected');
        document.getElementById('status-text').innerText = 'Connected';
        ws.send(JSON.stringify({ action: 'getState' }));
        tlLoadHistory(); // 타임라인 이력 로드

        pinger = setInterval(() => {
            const activeTab = document.querySelector('.nav-btn.active').getAttribute('data-target');
            if (activeTab === 'tab-live') ws.send(JSON.stringify({ action: 'getState' }));
            if (activeTab === 'tab-schedule') ws.send(JSON.stringify({ action: 'getSchedule' }));
        }, 5000);
    };

    ws.onclose = () => {
        document.getElementById('status-dot').classList.remove('connected');
        document.getElementById('status-dot-mobile').classList.remove('connected');
        document.getElementById('status-text').innerText = 'Reconnecting...';
        clearInterval(pinger);
        setTimeout(connectWS, 3000);
    };

    ws.onmessage = async (event) => {
        try {
            let text;
            if (event.data instanceof ArrayBuffer) {
                const ds = new DecompressionStream('deflate');
                const writer = ds.writable.getWriter();
                writer.write(new Uint8Array(event.data));
                writer.close();
                const response = new Response(ds.readable);
                text = await response.text();
            } else {
                text = event.data;
            }
            const msg = JSON.parse(text);
            handleWSMessage(msg);
        } catch (e) { console.error("Message parse error", e); }
    };
}

function handleWSMessage(msg) {
    const { action, payload } = msg;

    switch (action) {
        case 'state':
            if (payload.episodeInfo) {
                const totalEp = payload.totalEpisodes || '--';
                const aliasStr = payload.episodeAlias ? ` (${payload.episodeAlias})` : '';
                document.getElementById('stat-episode').innerText = `${payload.episodeInfo.index} / ${totalEp}${aliasStr}`;
                document.getElementById('stat-sec').innerText = `${secToTime(payload.episodeInfo.now)} / ${secToTime(payload.totalTime)}`;
                // 타임라인 LIVE 모드일 때 슬라이더 업데이트
                if (TL.isLive && payload.episodeInfo) {
                    tlEpIndex.textContent = `${payload.episodeInfo.index + 1}화`;
                    tlEpTime.textContent = secToHHMMSS(payload.episodeInfo.now);
                }
            } else {
                document.getElementById('stat-episode').innerText = '-- / --';
                document.getElementById('stat-sec').innerText = '-- / --';
            }
            document.getElementById('stat-search-count').innerText = searchLogCount;
            document.getElementById('stat-cmd-count').innerText = cmdLogCount;
            if (payload.botMuted !== undefined) {
                updateMuteBtn(payload.botMuted);
            }
            if (payload.ytdlpRunning !== undefined) {
                updateYtdlpBtn(payload.ytdlpRunning);
            }
            if (payload.cooldownState) {
                renderCooldowns(payload.cooldownState);
            }
            break;
        case 'mute_state':
            updateMuteBtn(payload);
            break;
        case 'ytdlp_state':
            updateYtdlpBtn(payload);
            break;

        case 'chat_history':
            renderChats(payload);
            break;

        case 'chat_push':
            appendChats(payload);
            break;

        case 'spam_list':
            renderSpam(payload);
            break;

        case 'config_data':
            if (document.getElementById('val-youtube')) {
                document.getElementById('val-youtube').value = payload.youtube;
            }
            if (document.getElementById('val-search')) {
                document.getElementById('val-search').value = payload.search;
            }
            try {
                const searchConfigStr = payload.search.replace(/module\.exports\s*=\s*/, '').trim().replace(/;$/, '');
                const searchConfigObj = eval('(' + searchConfigStr + ')');

                const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
                const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

                const crop = searchConfigObj.extraction && searchConfigObj.extraction.crop;
                if (crop) {
                    setVal('vm-crop-x', crop.x);
                    setVal('vm-crop-y', crop.y);
                    setVal('vm-crop-w', crop.w);
                    setVal('vm-crop-h', crop.h);
                    setChk('vm-crop-enabled', crop.enabled);
                    updateCropEnabledBadge(!!crop.enabled);
                }

                if (searchConfigObj.extraction) {
                    setVal('vm-ext-fps', searchConfigObj.extraction.fps);
                    setVal('vm-ext-w', searchConfigObj.extraction.width);
                    setVal('vm-ext-h', searchConfigObj.extraction.height);
                }

                if (searchConfigObj.phash) {
                    setVal('vm-ph-rw', searchConfigObj.phash.resizeWidth);
                    setVal('vm-ph-rh', searchConfigObj.phash.resizeHeight);
                    setVal('vm-ph-dct', searchConfigObj.phash.dctSize);
                    setVal('vm-ph-low', searchConfigObj.phash.lowFreqSize);
                    setVal('vm-ph-bits', searchConfigObj.phash.hashBits);
                }

                if (searchConfigObj.matching) {
                    setVal('vm-match-th', searchConfigObj.matching.hammingThreshold);
                    setVal('vm-match-topn', searchConfigObj.matching.topN);
                    setChk('vm-match-early', searchConfigObj.matching.earlyExit);
                }

                if (searchConfigObj.searcher) {
                    setVal('vm-search-url', searchConfigObj.searcher.youtube_url);
                }

                if (searchConfigObj.ytdlp) {
                    const cmdVal = Array.isArray(searchConfigObj.ytdlp.commandLine)
                        ? JSON.stringify(searchConfigObj.ytdlp.commandLine)
                        : (searchConfigObj.ytdlp.commandLine || '');
                    setVal('vm-ytdlp-cmdline', cmdVal);
                }

                window._currentSearchConfig = searchConfigObj;
                // 이미지가 이미 로드된 상태라면 crop overlay 다시 그리기
                const imgLoaded = document.getElementById('vm-preview-img');
                if (imgLoaded && imgLoaded.naturalWidth > 0) drawCropFromInputs();
            } catch (e) { console.error('Parse search config error', e); }
            break;

        case 'liveFrame_result':
            if (payload.success) {
                const img = document.getElementById('vm-preview-img');
                const placeholder = document.getElementById('vm-preview-placeholder');
                img.src = payload.image;
                img.style.display = 'block';
                if (placeholder) placeholder.style.display = 'none';
                img.onload = () => drawCropFromInputs();
            } else {
                showToast('미리보기 캡처 실패: ' + (payload.error || '알 수 없는 오류'), true);
            }
            break;

        case 'saveConfig_result':
            const statusEl = document.getElementById('vm-save-status');
            if (payload.success) {
                showToast('설정 저장 완료! 재부팅 없이 즉시 적용되었습니다.');
                if (statusEl) {
                    statusEl.textContent = '✓ 저장 완료';
                    statusEl.style.display = '';
                    statusEl.className = 'vm-status-badge';
                    setTimeout(() => { statusEl.style.display = 'none'; statusEl.textContent = ''; }, 3000);
                }
            } else {
                showToast('설정 저장 실패: ' + payload.error, true);
                if (statusEl) {
                    statusEl.textContent = '✗ 저장 실패';
                    statusEl.style.display = '';
                    statusEl.className = 'vm-status-badge error';
                }
            }
            break;

        case 'ban_result':
            if (payload.success) showToast('유저 숨기기 + 스팸가드 등록 완료');
            else showToast('차단 실패', true);
            break;

        case 'spamAdd_result':
            showToast('스패머 수동 등록 완료');
            break;

        case 'warnAdjust_result':
            if (payload.success) showToast(`경고 횟수 변경: ${payload.newCount}`);
            else showToast('경고 조절 실패: ' + (payload.error || ''), true);
            break;

        case 'usageAdjust_result':
            if (payload.success) showToast(`사용량 변경: ${payload.newCount}회`);
            else showToast('사용량 조절 실패: ' + (payload.error || ''), true);
            break;

        case 'allowSearch_result':
            if (payload.success) showToast('대사 검색 차단이 해제되었습니다.');
            break;
        case 'banSearch_result':
            if (payload.success) showToast('해당 유저의 대사 검색을 차단했습니다.');
            break;

        case 'spamDelete_result':
            showToast('스패머 해제 완료');
            break;

        // ── 새 기능 ──
        case 'videoInfo_data':
            document.getElementById('val-videoinfo').value = payload.replace(/^\uFEFF/, '').trim();
            break;

        case 'saveVideoInfo_result':
            if (payload.success) showToast('video-info.json 저장 완료! 즉시 적용되었습니다.');
            else showToast('저장 실패: ' + payload.error, true);
            break;

        case 'configMessages_data':
            if (document.getElementById('val-messages')) {
                document.getElementById('val-messages').value = payload.replace(/^\uFEFF/, '').trim();
            }
            break;

        case 'reloadCommands_result':
            if (payload.success) {
                showToast('⚡ ' + (payload.message || '명령어 모듈 핫리로드 완료!'));
            } else {
                showToast('❌ 리로드 실패: ' + (payload.error || payload.message), true);
            }
            break;

        case 'saveConfigMessages_result':
            if (payload.success) {
                showToast('config-messages.js 저장 완료! 재부팅 없이 즉시 적용되었습니다.');
            } else {
                showToast('메시지 설정 저장 실패: ' + payload.error, true);
            }
            break;

        case 'profanityList_data':
            if (document.getElementById('val-profanity')) {
                document.getElementById('val-profanity').value = payload.replace(/^\uFEFF/, '').trim();
            }
            break;

        case 'saveProfanityList_result':
            if (payload.success) {
                showToast('profanity-list.js 저장 완료! 재부팅 없이 즉시 적용되었습니다.');
            } else {
                showToast('욕설 필터 저장 실패: ' + payload.error, true);
            }
            break;

        case 'videoMusic_data':
            if (document.getElementById('val-music')) {
                document.getElementById('val-music').value = payload.replace(/^\uFEFF/, '').trim();
            }
            break;

        case 'saveVideoMusic_result':
            if (payload.success) {
                showToast('video-music.json 저장 완료! 재부팅 없이 즉시 적용되었습니다.');
            } else {
                showToast('음악 데이터 저장 실패: ' + payload.error, true);
            }
            break;

        case 'videoMetadata_data':
            if (document.getElementById('val-metadata')) {
                document.getElementById('val-metadata').value = payload.replace(/^\uFEFF/, '').trim();
            }
            break;

        case 'saveVideoMetadata_result':
            if (payload.success) {
                showToast('video-metadata.json 저장 완료! 재부팅 없이 즉시 적용되었습니다.');
            } else {
                showToast('메타데이터 저장 실패: ' + payload.error, true);
            }
            break;

        case 'search_logs':
            renderSearchLogs(payload);
            break;

        case 'search_push':
            appendSearchLog(payload);
            break;

        case 'violation_logs':
            renderViolationLogs(payload);
            break;

        case 'violation_push':
            appendViolationLog(payload);
            break;

        case 'command_logs':
            renderCommandLogs(payload);
            break;

        case 'command_push':
            appendCommandLog(payload);
            break;

        case 'schedule_data':
            renderSchedule(payload);
            break;

        case 'userDetail':
            renderUserDetail(payload);
            break;

        // ── 타임라인 이력 ──
        case 'lastquery_history_data':
            tlHandleHistoryData(payload);
            break;

        case 'lastquery_history_push':
            // 이력이 늘어났음만 알림 (LIVE 모드일 때는 전체 이력 재로드)
            if (TL.isLive) {
                tlLoadHistory();
            } else {
                // 타이탈 카운트만 업데이트
                TL.total = payload.total || TL.total;
                tlTotalCount.textContent = `이력 ${TL.total.toLocaleString()}건`;
            }
            break;

        case 'stateAtHistory_data':
            tlHandleStateAtHistory(payload);
            break;

        // ── 유저 통계 뷰어 ──
        case 'userStatsOverview_data':
            renderStatsOverview(payload);
            break;

        case 'userStatsSearch_data':
            renderStatsSearchResults(payload);
            break;

        case 'userStatsDetail_data':
            renderStatsUserDetail(payload);
            break;
    }
}

// ── Cooldown Render ──
function renderCooldowns(state) {
    const section = document.getElementById('cooldown-monitor-section');
    const grid = document.getElementById('cooldown-grid');

    section.style.display = 'block';
    grid.innerHTML = '';

    const entries = state.mode === 'global'
        ? [['Global (전체)', state.global]]
        : Object.entries(state.groups);

    for (const [group, info] of entries) {
        const card = document.createElement('div');
        card.className = 'status-card glass';
        card.style.padding = '12px';

        const title = document.createElement('h3');
        title.innerText = group;

        const timeStr = document.createElement('p');
        timeStr.style.fontSize = '1.2rem';

        if (info.remainingMs > 0) {
            timeStr.innerText = secToTime(info.remainingMs / 1000);
            timeStr.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
            timeStr.style.webkitBackgroundClip = 'text';
            timeStr.style.webkitTextFillColor = 'transparent';
        } else {
            timeStr.innerText = 'Ready';
            timeStr.style.background = 'linear-gradient(90deg, #10b981, #059669)';
            timeStr.style.webkitBackgroundClip = 'text';
            timeStr.style.webkitTextFillColor = 'transparent';
        }

        card.appendChild(title);
        card.appendChild(timeStr);
        grid.appendChild(card);
    }
}

// ── Chat Render ──
function createChatElement(c) {
    const div = document.createElement('div');
    div.className = 'chat-item';

    const textDiv = document.createElement('div');
    const authorSpan = document.createElement('span');
    authorSpan.className = 'chat-author';
    authorSpan.textContent = c.displayName;
    const textSpan = document.createElement('span');
    textSpan.className = 'chat-text';
    textSpan.textContent = c.text;
    textDiv.appendChild(authorSpan);
    textDiv.appendChild(textSpan);

    const btnDiv = document.createElement('div');
    btnDiv.style.cssText = 'display:flex; gap:8px;';

    const banBtn = document.createElement('button');
    banBtn.className = 'btn btn-ban';
    banBtn.textContent = '유저 숨기기';
    if (!c.contextMenu) {
        banBtn.disabled = true;
        banBtn.title = 'No Context Menu';
    } else {
        banBtn.addEventListener('click', () => execBan(c.displayName, c.channelId, c.contextMenu));
    }

    const spamBtn = document.createElement('button');
    spamBtn.className = 'btn btn-ban';
    spamBtn.style.backgroundColor = 'var(--warning)';
    spamBtn.textContent = '스팸 추가';
    spamBtn.addEventListener('click', () => execSpamOnly(c.displayName, c.channelId));

    const searchBanBtn = document.createElement('button');
    searchBanBtn.className = 'btn btn-ban';
    searchBanBtn.style.backgroundColor = '#8b5cf6';
    searchBanBtn.textContent = '검색 차단';
    searchBanBtn.addEventListener('click', () => execBanSearch(c.displayName, c.channelId));

    btnDiv.appendChild(banBtn);
    btnDiv.appendChild(spamBtn);
    btnDiv.appendChild(searchBanBtn);

    div.appendChild(textDiv);
    div.appendChild(btnDiv);
    return div;
}

const MAX_CHAT_DOM_ELEMENTS = 100;

function renderChats(chats) {
    const container = document.getElementById('chat-container');
    container.innerHTML = '';
    chats.sort((a, b) => b.timestamp - a.timestamp);
    const slice = chats.slice(0, MAX_CHAT_DOM_ELEMENTS);
    slice.forEach(c => container.appendChild(createChatElement(c)));
}

function appendChats(chatsArr) {
    const container = document.getElementById('chat-container');
    chatsArr.forEach(c => {
        container.insertBefore(createChatElement(c), container.firstChild);
    });
    while (container.children.length > MAX_CHAT_DOM_ELEMENTS) {
        container.removeChild(container.lastChild);
    }
}

// ── Sub-tab switching ──
document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const parent = target.closest('.panel');
        parent.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
        parent.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
        target.classList.add('active');
        document.getElementById(target.dataset.sub).classList.add('active');
    });
});

// ── Spam Render ──
function fmtRemaining(ms) {
    if (!ms || ms <= 0) return '<span style="color:var(--text-dim)">—</span>';
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}시간 ${m}분 ${s}초`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

let spamWarnData = [];
let spamBanData = [];
let spamReceivedAt = 0;
let spamTimer = null;

function renderSpamWarnTable() {
    const tbody = document.getElementById('spam-warn-tbody');
    tbody.innerHTML = '';
    const elapsed = Date.now() - spamReceivedAt;
    spamWarnData.forEach((u, i) => {
        const tr = document.createElement('tr');
        const currentRemaining = Math.max(0, (u.remainingMs || 0) - elapsed);

        const usageBadge = u.commandCount != null
            ? `<span class="badge badge-blue">${u.commandCount}회</span>`
            : '<span style="color:var(--text-dim)">—</span>';
        const warnBadge = u.count > 0
            ? `<span class="badge badge-red">${u.count}/${u.warnLimit || '?'}</span>`
            : `<span class="badge badge-green">0/${u.warnLimit || '?'}</span>`;
        const searchBadge = u.searchBanned
            ? '<span class="badge badge-red" style="margin-left:4px;">대사차단됨</span>'
            : '';

        tr.innerHTML = `
                    <td style="font-weight:600;">${escapeHtml(u.name)}${searchBadge}</td>
                    <td style="font-family:monospace; color:var(--text-dim); font-size:0.75rem;">${u.channelId}</td>
                    <td>
                        <div class="warn-adjust">
                            <button class="warn-adjust-btn warn-minus" onclick="adjustUsage('${u.channelId}', -1)" title="사용량 감소">−</button>
                            ${usageBadge}
                            <button class="warn-adjust-btn warn-plus" onclick="adjustUsage('${u.channelId}', 1)" title="사용량 증가">+</button>
                        </div>
                    </td>
                    <td>
                        <div class="warn-adjust">
                            <button class="warn-adjust-btn warn-minus" onclick="adjustWarn('${u.channelId}', -1)" title="경고 감소">−</button>
                            ${warnBadge}
                            <button class="warn-adjust-btn warn-plus" onclick="adjustWarn('${u.channelId}', 1)" title="경고 증가">+</button>
                        </div>
                    </td>
                    <td class="spam-remaining" data-idx="${i}"><span style="color:#f87171;">${fmtRemaining(currentRemaining)}</span></td>
                    <td style="color:#fcd34d;">${escapeHtml(u.reason)}</td>
                    <td data-action-idx="${i}"></td>
                `;
        tbody.appendChild(tr);

        // 이스케이프 없이 DOM API로 버튼 추가
        const actionCell = tr.querySelector(`[data-action-idx="${i}"]`);
        const group = document.createElement('div');
        group.className = 'action-cell-btn-group';

        const detailBtn = document.createElement('button');
        detailBtn.className = 'btn btn-sm';
        detailBtn.style.background = 'var(--info)';
        detailBtn.textContent = '상세';
        detailBtn.addEventListener('click', () => showUserDetail(u.channelId));
        group.appendChild(detailBtn);

        const hideBtn = document.createElement('button');
        hideBtn.className = 'btn btn-ban btn-sm';
        hideBtn.style.background = '#ef4444';
        hideBtn.textContent = '유저 숨기기';
        hideBtn.addEventListener('click', () => execBan(u.name, u.channelId));
        group.appendChild(hideBtn);

        const searchBtn = document.createElement('button');
        searchBtn.className = 'btn btn-sm';
        if (u.searchBanned) {
            searchBtn.style.background = 'var(--secondary)';
            searchBtn.textContent = '검색 허용';
            searchBtn.addEventListener('click', () => execAllowSearch(u.channelId));
        } else {
            searchBtn.style.background = '#8b5cf6';
            searchBtn.textContent = '검색 차단';
            searchBtn.addEventListener('click', () => execBanSearch(u.name, u.channelId));
        }
        group.appendChild(searchBtn);

        const spamBtn = document.createElement('button');
        spamBtn.className = 'btn btn-ban btn-sm';
        spamBtn.style.background = '#f59e0b';
        spamBtn.textContent = '스팸 추가';
        spamBtn.addEventListener('click', () => execSpamOnly(u.name, u.channelId));
        group.appendChild(spamBtn);

        actionCell.appendChild(group);
    });
}

function renderSpamBanTable() {
    const tbody = document.getElementById('spam-ban-tbody');
    tbody.innerHTML = '';
    spamBanData.forEach((u, i) => {
        const tr = document.createElement('tr');
        const searchBadge = u.searchBanned
            ? '<span class="badge badge-red" style="margin-left:4px;">대사차단됨</span>'
            : '';
        tr.innerHTML = `
                    <td style="font-weight:600;">${escapeHtml(u.name)}${searchBadge}</td>
                    <td style="font-family:monospace; color:var(--text-dim); font-size:0.75rem;">${u.channelId}</td>
                    <td style="color:#fcd34d;">${escapeHtml(u.reason)}</td>
                    <td style="color:var(--text-dim); font-size:0.8rem;">${u.bannedAt || '—'}</td>
                    <td data-ban-action-idx="${i}"></td>
                `;
        tbody.appendChild(tr);

        const actionCell = tr.querySelector(`[data-ban-action-idx="${i}"]`);
        const group = document.createElement('div');
        group.className = 'action-cell-btn-group';

        const hideBtn = document.createElement('button');
        hideBtn.className = 'btn btn-ban btn-sm';
        hideBtn.style.background = '#ef4444';
        hideBtn.textContent = '유저 숨기기';
        hideBtn.addEventListener('click', () => execBan(u.name, u.channelId));
        group.appendChild(hideBtn);

        const searchBtn = document.createElement('button');
        searchBtn.className = 'btn btn-sm';
        if (u.searchBanned) {
            searchBtn.style.background = 'var(--secondary)';
            searchBtn.textContent = '검색 허용';
            searchBtn.addEventListener('click', () => execAllowSearch(u.channelId));
        } else {
            searchBtn.style.background = '#8b5cf6';
            searchBtn.textContent = '검색 차단';
            searchBtn.addEventListener('click', () => execBanSearch(u.name, u.channelId));
        }
        group.appendChild(searchBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-ban btn-sm';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => execDeleteSpam(u.channelId));
        group.appendChild(removeBtn);

        actionCell.appendChild(group);
    });
}

function tickSpamTimers() {
    const elapsed = Date.now() - spamReceivedAt;
    document.querySelectorAll('.spam-remaining').forEach(td => {
        const idx = parseInt(td.dataset.idx);
        const u = spamWarnData[idx];
        if (!u) return;
        const currentRemaining = Math.max(0, (u.remainingMs || 0) - elapsed);
        td.innerHTML = `<span style="color:#f87171;">${fmtRemaining(currentRemaining)}</span>`;
    });
}

function renderSpam(spammers) {
    spamWarnData = spammers.filter(u => !u.block);
    spamWarnData.sort((a, b) => {
        if (a.searchBanned && !b.searchBanned) return 1;
        if (!a.searchBanned && b.searchBanned) return -1;

        const aWarns = a.count || 0;
        const bWarns = b.count || 0;
        if (aWarns !== bWarns) return bWarns - aWarns;

        const aUsage = a.commandCount || 0;
        const bUsage = b.commandCount || 0;
        return bUsage - aUsage;
    });
    spamBanData = spammers.filter(u => u.block);
    spamReceivedAt = Date.now();

    document.getElementById('spam-warn-count').innerText = spamWarnData.length;
    document.getElementById('spam-ban-count').innerText = spamBanData.length;

    renderSpamWarnTable();
    renderSpamBanTable();

    if (spamTimer) clearInterval(spamTimer);
    spamTimer = setInterval(tickSpamTimers, 1000);
}

// ── Search Log Render ──
function simBadge(sim) {
    if (sim >= 90) return 'badge-green';
    if (sim >= 70) return 'badge-yellow';
    return 'badge-red';
}

function formatSecWithTime(sec) {
    if (sec === null || sec === undefined || isNaN(sec)) return '--';
    const isNegative = sec < 0;
    const abs = Math.abs(sec);
    const totalSec = Math.floor(abs);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const sign = isNegative ? '-' : '';

    let timeStr;
    if (h > 0) {
        timeStr = `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else {
        timeStr = `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${sec.toFixed(1)}s (${timeStr})`;
}

function createSearchLogRow(d) {
    const tr = document.createElement('tr');
    const sim = d.similarity != null ? d.similarity.toFixed(1) : '--';
    const realTs = d.realTimestamp != null ? new Date(d.realTimestamp).toLocaleTimeString('ko-KR') : '--';
    tr.innerHTML = `
                <td>${fmtTime(d.time || d.realTimestamp)}</td>
                <td><span class="badge badge-purple">${d.rank != null ? d.rank : '--'}</span></td>
                <td style="font-weight:600; color:#fcd34d;">${d.filename || '--'}</td>
                <td><span class="badge ${simBadge(d.similarity)}">${sim}%</span></td>
                <td>${d.hammingDistance != null ? d.hammingDistance : '--'}</td>
                <td>${d.matchCount != null ? d.matchCount : '--'}</td>
                <td>${d.coverage != null ? d.coverage.toFixed(1) + '%' : '--'}</td>
                <td>${formatSecWithTime(d.dbTimestamp)}</td>
                <td>${formatSecWithTime(d.clipTimestamp)}</td>
                <td style="color:#60a5fa; font-weight:500;">${formatSecWithTime(d.now)}</td>
                <td style="color:var(--info);">${realTs}</td>
            `;
    return tr;
}

function renderSearchLogs(logs) {
    const tbody = document.getElementById('search-log-tbody');
    tbody.innerHTML = '';
    searchLogCount = logs.length;
    logs.forEach(d => tbody.insertBefore(createSearchLogRow(d), tbody.firstChild));
}

function appendSearchLog(data) {
    const tbody = document.getElementById('search-log-tbody');
    tbody.insertBefore(createSearchLogRow(data), tbody.firstChild);
    searchLogCount++;
    // 200개 초과 시 오래된 행 제거
    while (tbody.children.length > 200) tbody.removeChild(tbody.lastChild);
}

function createViolationLogRow(d) {
    const tr = document.createElement('tr');

    let reasonText = d.reason || '--';
    if (d.reason === 'MIN_VIOLATION') reasonText = '최소 길이 미달 (너무 짧음)';
    else if (d.reason === 'MAX_VIOLATION') reasonText = '최대 길이 초과 (너무 김)';

    tr.innerHTML = `
            <td>${fmtTime(d.time)}</td>
            <td style="font-weight:600; color:#f87171;">${d.filename || '--'}</td>
            <td>${formatSecWithTime(d.dbTimestamp)}</td>
            <td>${formatSecWithTime(d.cmpNow)}</td>
            <td style="color:var(--danger);">${formatSecWithTime(d.diffNow)}</td>
            <td style="color:var(--text-dim); font-size: 0.85em;">${reasonText}</td>
            <td>${d.matchCount != null ? d.matchCount : '--'}</td>
        `;
    return tr;
}

function renderViolationLogs(logs) {
    const tbody = document.getElementById('violation-log-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    logs.forEach(d => tbody.insertBefore(createViolationLogRow(d), tbody.firstChild));
}

function appendViolationLog(data) {
    const tbody = document.getElementById('violation-log-tbody');
    if (!tbody) return;
    tbody.insertBefore(createViolationLogRow(data), tbody.firstChild);
    while (tbody.children.length > 100) tbody.removeChild(tbody.lastChild);
}

// ── Command Log Render ──
function groupBadge(g) {
    const map = {
        'greeting': 'badge-green', 'help': 'badge-blue', 'episode': 'badge-purple',
        'timetable': 'badge-yellow', 'next': 'badge-blue', 'last': 'badge-blue',
        'date': 'badge-yellow', 'suggest': 'badge-green'
    };
    return map[g] || 'badge-purple';
}

function createCmdLogRow(d) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
                <td style="white-space:nowrap; vertical-align:top; width:90px;">${fmtTime(d.time)}</td>
                <td style="font-weight:600; color:#fcd34d; white-space:nowrap; vertical-align:top; width:140px;">${escapeHtml(d.user)}</td>
                <td style="color:#a78bfa; font-weight:600; white-space:nowrap; vertical-align:top; width:90px;">${escapeHtml(d.cmd)}</td>
                <td style="white-space:nowrap; vertical-align:top; width:80px;"><span class="badge ${groupBadge(d.group)}">${d.group}</span></td>
                <td style="vertical-align:top; word-break:break-word; max-width:130px; width:130px;">${escapeHtml(d.args) || '<span style="color:var(--text-dim)">—</span>'}</td>
                <td style="vertical-align:top; word-break:break-word; max-width:360px; font-size:0.84rem; color:var(--text-main); line-height:1.45;">${escapeHtml(d.response) || '<span style="color:var(--text-dim)">—</span>'}</td>
            `;
    return tr;
}

function renderCommandLogs(logs) {
    const tbody = document.getElementById('cmd-log-tbody');
    tbody.innerHTML = '';
    cmdLogCount = logs.length;
    logs.forEach(d => tbody.insertBefore(createCmdLogRow(d), tbody.firstChild));
}

function appendCommandLog(data) {
    const tbody = document.getElementById('cmd-log-tbody');
    tbody.insertBefore(createCmdLogRow(data), tbody.firstChild);
    cmdLogCount++;
    while (tbody.children.length > 300) tbody.removeChild(tbody.lastChild);
}

// ── Schedule Render ──
function renderSchedule(schedule) {
    const tbody = document.getElementById('schedule-tbody');
    tbody.innerHTML = '';
    schedule.forEach(s => {
        const tr = document.createElement('tr');
        const dt = new Date(s.date);
        const isToday = dt.toDateString() === new Date().toDateString();
        const dstr = isToday ? 'Today' : dt.toLocaleDateString();
        const tstr = dt.toLocaleTimeString('ko-KR');

        if (s.isCurrent) {
            tr.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
            tr.style.borderLeft = '4px solid #ef4444';
        }

        tr.innerHTML = `
                    <td style="color:var(--text-dim);">${dstr}</td>
                    <td style="font-weight:600; color:var(--info);">${tstr}</td>
                    <td style="color:#fcd34d; font-weight:${s.isCurrent ? '700' : '500'};">${escapeHtml(s.alias)} 화 - ${escapeHtml(s.title)}</td>
                `;
        tbody.appendChild(tr);
    });
}

function execBan(name, channelId, contextMenu) {
    if (!confirm(`[${name}] 유저를 숨기시겠습니까? (유튜브 유저숨기기 + 스팸가드 동시 적용)`)) return;
    ws.send(JSON.stringify({
        action: 'ban',
        payload: { channelId, displayName: name, contextMenuParams: contextMenu || null }
    }));
}

function execSpamOnly(name, channelId) {
    if (!confirm(`[${name}] 스팸 리스트에만 추가하시겠습니까? (유튜브 차단 X)`)) return;
    ws.send(JSON.stringify({
        action: 'spamAdd',
        payload: { channelId, displayName: name, reason: '채팅 탭에서 빠른 추가' }
    }));
}

function execBanSearch(name, channelId) {
    if (!confirm(`[${name}] 유저의 대사 검색을 차단하시겠습니까?`)) return;
    ws.send(JSON.stringify({
        action: 'banSearch',
        payload: { channelId, displayName: name }
    }));
}

function execAllowSearch(channelId) {
    if (!confirm(`이 유저의 대사 검색 차단을 해제하시겠습니까?`)) return;
    ws.send(JSON.stringify({
        action: 'allowSearch',
        payload: { channelId }
    }));
}

let isMutedUI = false;
function updateMuteBtn(muted) {
    isMutedUI = muted;
    const btn = document.getElementById('btn-toggle-mute');
    if (!btn) return;
    if (muted) {
        btn.innerText = '🔇 Mute: ON';
        btn.style.backgroundColor = 'var(--error)';
    } else {
        btn.innerText = '🔊 Mute: OFF';
        btn.style.backgroundColor = 'var(--secondary)';
    }
}

document.getElementById('btn-toggle-mute').addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'setMute', payload: !isMutedUI }));
    }
});

let isYtdlpRunningUI = true;
function updateYtdlpBtn(running) {
    isYtdlpRunningUI = running;
    const btn = document.getElementById('btn-toggle-ytdlp');
    if (!btn) return;
    if (running) {
        btn.innerText = '📥 yt-dlp: ON';
        btn.style.backgroundColor = 'var(--secondary)';
    } else {
        btn.innerText = '⏸️ yt-dlp: OFF';
        btn.style.backgroundColor = 'var(--error)';
    }
}

const btnToggleYtdlp = document.getElementById('btn-toggle-ytdlp');
if (btnToggleYtdlp) {
    btnToggleYtdlp.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'setYtdlp', payload: !isYtdlpRunningUI }));
        }
    });
}

function execDeleteSpam(channelId) {
    if (!confirm('이 유저를 밴 목록에서 제거합니까?')) return;
    ws.send(JSON.stringify({ action: 'spamDelete', payload: { channelId } }));
}

let currentIncrement = 1;

document.addEventListener('contextmenu', function (e) {
    const btn = e.target.closest('.warn-adjust-btn');
    if (btn) {
        e.preventDefault();
        const menu = document.getElementById('increment-context-menu');
        menu.style.display = 'flex';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';

        menu.querySelectorAll('.menu-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.val) === currentIncrement);
        });
    } else {
        const menu = document.getElementById('increment-context-menu');
        if (menu) menu.style.display = 'none';
    }
});

document.addEventListener('click', function (e) {
    const menu = document.getElementById('increment-context-menu');
    if (!menu) return;
    if (e.target.closest('.menu-btn')) {
        currentIncrement = parseInt(e.target.closest('.menu-btn').dataset.val);
        showToast(`증감 단위가 ${currentIncrement}로 설정되었습니다.`);
        menu.style.display = 'none';
    } else if (!e.target.closest('#increment-context-menu')) {
        menu.style.display = 'none';
    }
});

function adjustWarn(channelId, sign) {
    const delta = sign * currentIncrement;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'adjustWarn', payload: { channelId, delta } }));
    }
}

function adjustUsage(channelId, sign) {
    const delta = sign * currentIncrement;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'adjustUsage', payload: { channelId, delta } }));
    }
}

document.getElementById('btn-add-hide')?.addEventListener('click', () => {
    const channelId = document.getElementById('spam-channel').value.trim();
    const displayName = document.getElementById('spam-name').value.trim() || 'Unknown';

    if (!channelId) return showToast('Channel ID는 필수입니다.', true);

    execBan(displayName, channelId);

    document.getElementById('spam-channel').value = '';
    document.getElementById('spam-name').value = '';
    document.getElementById('spam-reason').value = '';
});

document.getElementById('btn-add-spam').addEventListener('click', () => {
    const channelId = document.getElementById('spam-channel').value.trim();
    const displayName = document.getElementById('spam-name').value.trim() || 'Unknown';
    const reason = document.getElementById('spam-reason').value.trim() || 'Manual Add';

    if (!channelId) return showToast('Channel ID는 필수입니다.', true);

    ws.send(JSON.stringify({
        action: 'spamAdd',
        payload: { channelId, displayName, reason }
    }));

    document.getElementById('spam-channel').value = '';
    document.getElementById('spam-name').value = '';
    document.getElementById('spam-reason').value = '';
});

document.getElementById('btn-add-search-ban').addEventListener('click', () => {
    const channelId = document.getElementById('spam-channel').value.trim();
    const displayName = document.getElementById('spam-name').value.trim() || 'Unknown';

    if (!channelId) return showToast('Channel ID는 필수입니다.', true);

    execBanSearch(displayName, channelId);

    document.getElementById('spam-channel').value = '';
    document.getElementById('spam-name').value = '';
    document.getElementById('spam-reason').value = '';
});

window.saveConfig = function (target) {
    const content = document.getElementById(`val-${target}`).value;
    ws.send(JSON.stringify({ action: 'saveConfig', payload: { target, content } }));
};

window.saveVideoInfo = function () {
    const raw = document.getElementById('val-videoinfo').value;
    // BOM, \r, \uFEFF 제거 후 trim
    const content = raw.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
    // 먼저 클라이언트에서 JSON 유효성 검사
    try {
        JSON.parse(content);
    } catch (e) {
        return showToast('JSON 파싱 에러: ' + e.message, true);
    }
    ws.send(JSON.stringify({ action: 'saveVideoInfo', payload: { content } }));
};

window.reloadVideoSub = function () {
    if (confirm('서버의 video-sub.json 파일을 다시 읽어옵니다.\n진행하시겠습니까?')) {
        ws.send(JSON.stringify({ action: 'reloadVideoSub' }));
        showToast('video-sub 리로드 요청 중...');
    }
};

window.formatVideoInfo = function () {
    const el = document.getElementById('val-videoinfo');
    try {
        const raw = el.value.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
        const obj = JSON.parse(raw);
        el.value = JSON.stringify(obj, null, 2);
        showToast('JSON 포맷 완료');
    } catch (e) {
        showToast('JSON 파싱 에러: ' + e.message, true);
    }
};

window.saveConfigMessages = function () {
    const el = document.getElementById('val-messages');
    const content = el ? el.value : '';
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'saveConfigMessages', payload: { content } }));
    } else {
        showToast('WebSocket 연결이 끊겨있습니다.', true);
    }
};

window.reloadConfigMessagesFromServer = function () {
    if (confirm('서버의 config-messages.js 파일을 다시 읽어옵니다.\n편집 중인 내용이 덮어씌워질 수 있습니다. 진행하시겠습니까?')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'getConfigMessages' }));
            showToast('config-messages.js 불러오는 중...');
        }
    }
};

window.saveProfanityList = function () {
    const el = document.getElementById('val-profanity');
    const content = el ? el.value : '';
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'saveProfanityList', payload: { content } }));
    } else {
        showToast('WebSocket 연결이 끊겨있습니다.', true);
    }
};

window.reloadProfanityListFromServer = function () {
    if (confirm('서버의 profanity-list.js 파일을 다시 읽어옵니다.\n편집 중인 내용이 덮어씌워질 수 있습니다. 진행하시겠습니까?')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'getProfanityList' }));
            showToast('profanity-list.js 불러오는 중...');
        }
    }
};

window.reloadConfigFromServer = function (target) {
    if (confirm(`서버의 config-${target}.js 파일을 다시 읽어옵니다.\n편집 중인 내용이 덮어씌워질 수 있습니다. 진행하시겠습니까?`)) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'getConfig' }));
            showToast(`config-${target}.js 불러오는 중...`);
        }
    }
};

window.saveMusicData = function () {
    const el = document.getElementById('val-music');
    const content = el ? el.value : '';
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'saveVideoMusic', payload: { content } }));
    } else {
        showToast('WebSocket 연결이 끊겨있습니다.', true);
    }
};

window.reloadMusicDataFromServer = function () {
    if (confirm('서버의 video-music.json 파일을 다시 읽어옵니다.\n편집 중인 내용이 덮어씌워질 수 있습니다. 진행하시겠습니까?')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'getVideoMusic' }));
            showToast('video-music.json 불러오는 중...');
        }
    }
};

window.saveMetadata = function () {
    const el = document.getElementById('val-metadata');
    const content = el ? el.value : '';
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'saveVideoMetadata', payload: { content } }));
    } else {
        showToast('WebSocket 연결이 끊겨있습니다.', true);
    }
};

window.reloadMetadataFromServer = function () {
    if (confirm('서버의 video-metadata.json 파일을 다시 읽어옵니다.\n편집 중인 내용이 덮어씌워질 수 있습니다. 진행하시겠습니까?')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'getVideoMetadata' }));
            showToast('video-metadata.json 불러오는 중...');
        }
    }
};

window.reloadCommands = function () {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'reloadCommands' }));
        showToast('명령어 모듈 핫리로드 요청 중...');
    }
};

window.rebootBot = function () {
    if (confirm('정말로 봇을 재부팅하시겠습니까? (설정 반영 등에 필요합니다)\n\n※ 서버/콘솔 외부 환경에서 자동 재시작(PM2, 스크립트 반복문 등) 기능이 켜져 있어야 다시 켜집니다.')) {
        ws.send(JSON.stringify({ action: 'reboot_bot' }));
        showToast('재부팅 명령을 전송했습니다. 연결이 곧 끊어집니다.', true);
    }
};

// ── Code Editor Enhancements (Tab indent & Ctrl+S) ──
document.querySelectorAll('textarea.code-editor').forEach(ta => {
    ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 4;
        } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (this.id === 'val-messages') saveConfigMessages();
            else if (this.id === 'val-profanity') saveProfanityList();
            else if (this.id === 'val-music') saveMusicData();
            else if (this.id === 'val-metadata') saveMetadata();
            else if (this.id === 'val-videoinfo') saveVideoInfo();
            else if (this.id === 'val-youtube') saveConfig('youtube');
            else if (this.id === 'val-search') saveSearchRawConfig();
        }
    });
});

// ── User Detail Modal ──
function showUserDetail(channelId) {
    document.getElementById('user-detail-content').innerHTML = '<p style="color:var(--text-dim)">불러오는 중...</p>';
    document.getElementById('user-detail-overlay').classList.add('active');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'getUserDetail', payload: { channelId } }));
    }
}

function closeUserDetail() {
    document.getElementById('user-detail-overlay').classList.remove('active');
}

function fmtFullDate(ts) {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}:${ss}`;
}

function renderUserDetail(data) {
    const content = document.getElementById('user-detail-content');
    if (!data) {
        content.innerHTML = '<p class="detail-empty">트래커에 기록이 없는 유저입니다.</p>';
        return;
    }

    const now = Date.now();
    const penaltyRemaining = data.penaltyExpiresAt > now ? data.penaltyExpiresAt - now : 0;

    let html = `
                <div class="detail-info-row">
                    <div class="detail-info-item">
                        <div class="label">닉네임</div>
                        <div class="value" style="color:#fcd34d;">${escapeHtml(data.displayName || '알 수 없음')}</div>
                    </div>
                    <div class="detail-info-item">
                        <div class="label">경고 횟수</div>
                        <div class="value" style="color:${data.warns > 0 ? '#f87171' : '#4ade80'};">${data.warns}</div>
                    </div>
                    <div class="detail-info-item">
                        <div class="label">사용 횟수</div>
                        <div class="value" style="color:#60a5fa;">${data.commandHistory ? data.commandHistory.length : 0}회</div>
                    </div>
                    <div class="detail-info-item">
                        <div class="label">패널티 남은 시간</div>
                        <div class="value" style="color:#f87171;">${fmtRemaining(penaltyRemaining)}</div>
                    </div>
                </div>
                <div style="font-family:monospace; font-size:0.72rem; color:var(--text-dim); margin-bottom:20px; word-break:break-all;">Channel: ${escapeHtml(data.channelId)}</div>
            `;

    // 명령어 사용 이력
    html += '<div class="detail-section"><h4>📋 명령어 사용 이력 (Usage History)</h4>';
    if (data.commandHistory && data.commandHistory.length > 0) {
        const sorted = [...data.commandHistory].sort((a, b) => b - a);
        html += '<ul class="detail-list">';
        sorted.forEach(t => {
            const ago = Math.round((now - t) / 60000);
            html += `<li>
                        <span class="detail-time">${fmtFullDate(t)}</span>
                        <span style="color:var(--text-dim);">${ago}분 전</span>
                    </li>`;
        });
        html += '</ul>';
    } else {
        html += '<p class="detail-empty">사용 이력이 없습니다.</p>';
    }
    html += '</div>';

    // 검색 이력 (searchHistory)
    html += '<div class="detail-section"><h4>🔍 검색 이력 (Search History)</h4>';
    if (data.searchHistory && data.searchHistory.length > 0) {
        const sorted = [...data.searchHistory].sort((a, b) => b.time - a.time);
        html += '<ul class="detail-list">';
        sorted.forEach(item => {
            const ago = Math.round((now - item.time) / 60000);
            html += `<li>
                        <span class="detail-query">${escapeHtml(item.query)}</span>
                        <span>
                            <span class="detail-time">${fmtFullDate(item.time)}</span>
                            <span style="color:var(--text-dim); margin-left:8px;">${ago}분 전</span>
                        </span>
                    </li>`;
        });
        html += '</ul>';
    } else {
        html += '<p class="detail-empty">검색 이력이 없습니다.</p>';
    }
    html += '</div>';

    document.getElementById('user-detail-title').textContent =
        `📊 ${data.displayName || '유저'} 상세 정보`;
    content.innerHTML = html;
}

function refreshLiveFrame() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'getLiveFrame' }));
    }
}

function saveVideoMatchingConfig() {
    if (!window._currentSearchConfig) return;
    let text = document.getElementById('val-search').value;

    function updateKey(key, value, isString = false) {
        // (?<![A-Za-z0-9_]) 로 앞 word boundary, (?![A-Za-z0-9_]) 로 뒤 word boundary
        // 값은 문자열("...") 또는 숫자/불리언 단일값만 교체 (배열 [ 로 시작하면 절대 건드리지 않음)
        const regex = new RegExp(
            '(?<![A-Za-z0-9_])(' + key + '\\s*:\\s*)("[^"]*"|true|false|-?[0-9]+(?:\\.[0-9]+)?)',
            'g'
        );
        text = text.replace(regex, (match, p1) => {
            return p1 + (isString ? '"' + value + '"' : value);
        });
    }

    updateKey('youtube_url', document.getElementById('vm-search-url').value.trim(), true);
    updateKey('x', parseInt(document.getElementById('vm-crop-x').value) || 0);
    updateKey('y', parseInt(document.getElementById('vm-crop-y').value) || 0);
    updateKey('w', parseInt(document.getElementById('vm-crop-w').value) || 0);
    updateKey('h', parseInt(document.getElementById('vm-crop-h').value) || 0);
    updateKey('enabled', document.getElementById('vm-crop-enabled').checked);

    updateKey('fps', parseInt(document.getElementById('vm-ext-fps').value) || 2);
    updateKey('width', parseInt(document.getElementById('vm-ext-w').value) || 64);
    updateKey('height', parseInt(document.getElementById('vm-ext-h').value) || 64);

    updateKey('resizeWidth', parseInt(document.getElementById('vm-ph-rw').value) || 64);
    updateKey('resizeHeight', parseInt(document.getElementById('vm-ph-rh').value) || 64);
    updateKey('dctSize', parseInt(document.getElementById('vm-ph-dct').value) || 64);
    updateKey('lowFreqSize', parseInt(document.getElementById('vm-ph-low').value) || 16);

    const lowFreqSize = parseInt(document.getElementById('vm-ph-low').value) || 16;
    const hashBits = parseInt(document.getElementById('vm-ph-bits').value) || (lowFreqSize * lowFreqSize - 1);
    updateKey('hashBits', hashBits);

    updateKey('hammingThreshold', parseInt(document.getElementById('vm-match-th').value) || 30);
    updateKey('topN', parseInt(document.getElementById('vm-match-topn').value) || 5);
    updateKey('earlyExit', document.getElementById('vm-match-early').checked);

    // 메모리 내 객체도 업데이트
    const cfg = window._currentSearchConfig;
    cfg.extraction.crop.x = parseInt(document.getElementById('vm-crop-x').value) || 0;
    cfg.extraction.crop.y = parseInt(document.getElementById('vm-crop-y').value) || 0;
    cfg.extraction.crop.w = parseInt(document.getElementById('vm-crop-w').value) || 0;
    cfg.extraction.crop.h = parseInt(document.getElementById('vm-crop-h').value) || 0;
    cfg.extraction.crop.enabled = document.getElementById('vm-crop-enabled').checked;
    cfg.extraction.fps = parseInt(document.getElementById('vm-ext-fps').value) || 2;
    cfg.extraction.width = parseInt(document.getElementById('vm-ext-w').value) || 64;
    cfg.extraction.height = parseInt(document.getElementById('vm-ext-h').value) || 64;
    if (!cfg.phash) cfg.phash = {};
    cfg.phash.resizeWidth = parseInt(document.getElementById('vm-ph-rw').value) || 64;
    cfg.phash.resizeHeight = parseInt(document.getElementById('vm-ph-rh').value) || 64;
    cfg.phash.dctSize = parseInt(document.getElementById('vm-ph-dct').value) || 64;
    cfg.phash.lowFreqSize = lowFreqSize;
    cfg.phash.hashBits = hashBits;
    if (!cfg.matching) cfg.matching = {};
    cfg.matching.hammingThreshold = parseInt(document.getElementById('vm-match-th').value) || 30;
    cfg.matching.topN = parseInt(document.getElementById('vm-match-topn').value) || 5;
    cfg.matching.earlyExit = document.getElementById('vm-match-early').checked;
    if (!cfg.searcher) cfg.searcher = {};
    cfg.searcher.youtube_url = document.getElementById('vm-search-url').value.trim();

    const ytdlpCmdEl = document.getElementById('vm-ytdlp-cmdline');
    if (ytdlpCmdEl) {
        const cmdValRaw = ytdlpCmdEl.value.trim();
        let parsedArr = [];
        if (cmdValRaw.startsWith('[') && cmdValRaw.endsWith(']')) {
            try { parsedArr = JSON.parse(cmdValRaw); } catch (_) { }
        } else if (cmdValRaw) {
            parsedArr = cmdValRaw.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(s => s.replace(/^"|"$/g, '')) || [];
        }

        const cmdLineJson = JSON.stringify(parsedArr);
        if (/ytdlp\s*:\s*\{[\s\S]*?commandLine\s*:\s*\[[^\]]*\]/.test(text)) {
            text = text.replace(/(ytdlp\s*:\s*\{[\s\S]*?commandLine\s*:\s*)\[[^\]]*\]/, `$1${cmdLineJson}`);
        } else if (/ytdlp\s*:\s*\{/.test(text)) {
            text = text.replace(/(ytdlp\s*:\s*\{)/, `$1\n        commandLine: ${cmdLineJson},`);
        }

        if (!cfg.ytdlp) cfg.ytdlp = {};
        cfg.ytdlp.commandLine = parsedArr;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        document.getElementById('val-search').value = text;
        ws.send(JSON.stringify({ action: 'saveConfig', payload: { target: 'search', content: text } }));
    }
}

window.reloadConfigSearchFromServer = function () {
    if (confirm('서버의 config-search.js 파일을 다시 읽어옵니다.\n편집 중인 내용이 덮어씌워질 수 있습니다. 진행하시겠습니까?')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'getConfig' }));
            showToast('config-search.js 불러오는 중...');
        }
    }
};

window.saveSearchRawConfig = function () {
    const el = document.getElementById('val-search');
    const content = el ? el.value : '';
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'saveConfig', payload: { target: 'search', content: content } }));
    } else {
        showToast('WebSocket 연결이 끊겨있습니다.', true);
    }
};

function saveConfig(target) {
    let content = '';
    if (target === 'youtube') {
        const el = document.getElementById('val-youtube');
        content = el ? el.value : '';
    } else if (target === 'search') {
        const el = document.getElementById('val-search');
        content = el ? el.value : '';
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'saveConfig', payload: { target, content } }));
    }
}

// ── Crop 활성화 배지 업데이트 ──
function updateCropEnabledBadge(enabled) {
    const badge = document.getElementById('vm-crop-status-badge');
    if (!badge) return;
    if (enabled) {
        badge.textContent = 'ON';
        badge.className = 'badge badge-green';
    } else {
        badge.textContent = 'OFF';
        badge.className = 'badge badge-red';
    }
}

document.getElementById('vm-crop-enabled').addEventListener('change', (e) => {
    updateCropEnabledBadge(e.target.checked);
});

// ── 시각적 크롭 도구 관련 변수 및 이벤트 ──
let isDragging = false;
let startX, startY;
const imgEl = document.getElementById('vm-preview-img');
const overlayEl = document.getElementById('vm-crop-overlay');
const magnifierEl = document.getElementById('vm-crop-magnifier');
const magCtx = magnifierEl.getContext('2d', { willReadFrequently: true });

function updateCropInputs(x, y, w, h) {
    document.getElementById('vm-crop-x').value = x;
    document.getElementById('vm-crop-y').value = y;
    document.getElementById('vm-crop-w').value = w;
    document.getElementById('vm-crop-h').value = h;
}

function drawCropFromInputs() {
    if (!imgEl || imgEl.naturalWidth === 0) return; // No image loaded
    const rect = imgEl.getBoundingClientRect();
    if (rect.width === 0) return;

    const scaleX = rect.width / imgEl.naturalWidth;
    const scaleY = rect.height / imgEl.naturalHeight;

    const cx = parseInt(document.getElementById('vm-crop-x').value) || 0;
    const cy = parseInt(document.getElementById('vm-crop-y').value) || 0;
    const cw = parseInt(document.getElementById('vm-crop-w').value) || 0;
    const ch = parseInt(document.getElementById('vm-crop-h').value) || 0;

    if (cw > 0 && ch > 0) {
        overlayEl.style.display = 'block';
        overlayEl.style.left = (cx * scaleX) + 'px';
        overlayEl.style.top = (cy * scaleY) + 'px';
        overlayEl.style.width = (cw * scaleX) + 'px';
        overlayEl.style.height = (ch * scaleY) + 'px';
    } else {
        overlayEl.style.display = 'none';
    }
}

document.getElementById('vm-crop-x').addEventListener('input', drawCropFromInputs);
document.getElementById('vm-crop-y').addEventListener('input', drawCropFromInputs);
document.getElementById('vm-crop-w').addEventListener('input', drawCropFromInputs);
document.getElementById('vm-crop-h').addEventListener('input', drawCropFromInputs);

const brightnessInput = document.getElementById('vm-brightness');
if (brightnessInput) {
    brightnessInput.addEventListener('input', (e) => {
        imgEl.style.filter = `brightness(${e.target.value}%)`;
    });
}

// 드래그는 항상 가능 (crop enabled 여부 무관)
imgEl.addEventListener('mousedown', (e) => {
    if (imgEl.naturalWidth === 0) return; // 이미지 미로드 시 무시
    isDragging = true;
    e.preventDefault();
    const rect = imgEl.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    overlayEl.style.left = startX + 'px';
    overlayEl.style.top = startY + 'px';
    overlayEl.style.width = '0px';
    overlayEl.style.height = '0px';
    overlayEl.style.display = 'block';
});

// 윈도우 객체에서 mousemove 처리: 마우스가 밖으로 나가도 끊기지 않음
window.addEventListener('mousemove', (e) => {
    if (imgEl.naturalWidth === 0) return;
    const rect = imgEl.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    // 이미지 영역 내에 있는지 여부
    const isHover = rawX >= 0 && rawX <= rect.width && rawY >= 0 && rawY <= rect.height;

    // 돋보기 로직 (드래그 중이거나 hover 중일 때 항상 렌더링)
    if (isDragging || isHover) {
        const mx = Math.max(0, Math.min(rawX, rect.width));
        const my = Math.max(0, Math.min(rawY, rect.height));

        let magLeft = mx + 15;
        let magTop = my + 15;
        if (magLeft + 120 > rect.width) magLeft = mx - 135;
        if (magTop + 120 > rect.height) magTop = my - 135;

        magnifierEl.style.display = 'block';
        magnifierEl.style.left = magLeft + 'px';
        magnifierEl.style.top = magTop + 'px';

        magCtx.clearRect(0, 0, 120, 120);
        const scaleX = imgEl.naturalWidth / rect.width;
        const scaleY = imgEl.naturalHeight / rect.height;
        const srcX = mx * scaleX;
        const srcY = my * scaleY;

        // 적용된 밝기를 돋보기에도 반영 시도 (지원 시)
        magCtx.filter = imgEl.style.filter || 'none';
        magCtx.drawImage(imgEl,
            srcX - 30, srcY - 30, 60, 60,
            0, 0, 120, 120
        );
        magCtx.filter = 'none';

        magCtx.beginPath();
        magCtx.moveTo(0, 60); magCtx.lineTo(120, 60);
        magCtx.moveTo(60, 0); magCtx.lineTo(60, 120);
        magCtx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
        magCtx.stroke();
    } else {
        magnifierEl.style.display = 'none';
    }

    if (!isDragging) return;

    // 크롭 영역 계산 (이미지 밖으로 나가면 가장자리까지 자동 선택되도록)
    let curX = rawX;
    let curY = rawY;
    if (curX < 0) curX = 0;
    if (curX > rect.width) curX = rect.width;
    if (curY < 0) curY = 0;
    if (curY > rect.height) curY = rect.height;

    const left = Math.min(startX, curX);
    const top = Math.min(startY, curY);
    const width = Math.abs(curX - startX);
    const height = Math.abs(curY - startY);

    overlayEl.style.left = left + 'px';
    overlayEl.style.top = top + 'px';
    overlayEl.style.width = width + 'px';
    overlayEl.style.height = height + 'px';
});

window.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;

    // 드래그 종료 시, 마우스가 이미지 밖에 있으면 돋보기 숨김
    const rect = imgEl.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    if (rawX < 0 || rawX > rect.width || rawY < 0 || rawY > rect.height) {
        magnifierEl.style.display = 'none';
    }

    const scaleX = imgEl.naturalWidth / rect.width;
    const scaleY = imgEl.naturalHeight / rect.height;

    const left = parseFloat(overlayEl.style.left) || 0;
    const top = parseFloat(overlayEl.style.top) || 0;
    const width = parseFloat(overlayEl.style.width) || 0;
    const height = parseFloat(overlayEl.style.height) || 0;

    updateCropInputs(
        Math.round(left * scaleX),
        Math.round(top * scaleY),
        Math.round(width * scaleX),
        Math.round(height * scaleY)
    );
});

// Sync right panel height with left preview panel
const vmPreviewArea = document.querySelector('.vm-preview-area');
const vmConfigArea = document.querySelector('.vm-config-area');
if (vmPreviewArea && vmConfigArea) {
    const style = document.createElement('style');
    style.innerHTML = `
                .vm-config-area::-webkit-scrollbar { width: 6px; }
                .vm-config-area::-webkit-scrollbar-track { background: transparent; }
                .vm-config-area::-webkit-scrollbar-thumb { background: rgba(0, 240, 255, 0.3); border-radius: 3px; }
                .vm-config-area::-webkit-scrollbar-thumb:hover { background: rgba(0, 240, 255, 0.6); }
            `;
    document.head.appendChild(style);

    const ro = new ResizeObserver(entries => {
        for (let entry of entries) {
            if (window.innerWidth > 768) {
                vmConfigArea.style.maxHeight = entry.target.offsetHeight + 'px';
                vmConfigArea.style.overflowY = 'auto';
                vmConfigArea.style.overflowX = 'hidden';
                vmConfigArea.style.paddingRight = '8px';
            } else {
                vmConfigArea.style.maxHeight = 'none';
                vmConfigArea.style.overflowY = 'visible';
                vmConfigArea.style.paddingRight = '0';
            }
        }
    });
    ro.observe(vmPreviewArea);
}

// ══════════════════════════════════════════════
//  User Statistics Viewer Logic
// ══════════════════════════════════════════════
let statsSearchDebounceTimer = null;
let currentSelectedChannelId = null;

function loadStatsOverview() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'getUserStatsOverview' }));
    }
}

let statsCurrentPage = 1;
let statsPageLimit = 100;
let statsTotalCount = 0;

function changeStatsPage(delta) {
    const maxPage = Math.max(1, Math.ceil(statsTotalCount / statsPageLimit));
    const targetPage = Math.max(1, Math.min(maxPage, statsCurrentPage + delta));
    if (targetPage !== statsCurrentPage) {
        searchUserStats(targetPage);
    }
}

function onChangeStatsPageLimit() {
    const sel = document.getElementById('stats-page-limit');
    if (sel) {
        statsPageLimit = parseInt(sel.value, 10) || 100;
        searchUserStats(1);
    }
}

function onStatsSearchInput() {
    clearTimeout(statsSearchDebounceTimer);
    statsSearchDebounceTimer = setTimeout(() => {
        searchUserStats(1);
    }, 250);
}

function searchUserStats(page = 1) {
    statsCurrentPage = page;
    const input = document.getElementById('stats-search-input');
    const sortSelect = document.getElementById('stats-sort-by');
    const query = input ? input.value.trim() : '';
    const sortBy = sortSelect ? sortSelect.value : 'total_messages';

    const statusEl = document.getElementById('stats-search-status');
    if (statusEl) statusEl.textContent = '검색 중...';

    const offset = (statsCurrentPage - 1) * statsPageLimit;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'searchUserStats',
            payload: { query, sortBy, sortOrder: 'DESC', limit: statsPageLimit, offset }
        }));
    }
}

function renderStatsOverview(data) {
    if (!data) return;
    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setTxt('stats-ov-users', `${(data.totalUsers || 0).toLocaleString()}명`);
    setTxt('stats-ov-msgs', `${(data.totalMessages || 0).toLocaleString()}개`);
    setTxt('stats-ov-watch', data.totalWatchStr || '0분');
    setTxt('stats-ov-today-users', `${(data.todayUsers || 0).toLocaleString()}명`);
    setTxt('stats-ov-today-msgs', `${(data.todayMessages || 0).toLocaleString()}개`);
}

function renderStatsSearchResults(data) {
    const statusEl = document.getElementById('stats-search-status');
    const countEl = document.getElementById('stats-user-count');
    const tbody = document.getElementById('stats-users-tbody');

    if (!tbody) return;
    if (statusEl) statusEl.textContent = '';
    statsTotalCount = data.total || 0;
    if (countEl) countEl.textContent = statsTotalCount.toLocaleString();

    // Update pagination indicators
    const maxPage = Math.max(1, Math.ceil(statsTotalCount / statsPageLimit));
    const pageInfoEl = document.getElementById('stats-page-info');
    if (pageInfoEl) pageInfoEl.textContent = `${statsCurrentPage} / ${maxPage} (총 ${statsTotalCount.toLocaleString()}명)`;
    const prevBtn = document.getElementById('btn-stats-prev');
    const nextBtn = document.getElementById('btn-stats-next');
    if (prevBtn) prevBtn.disabled = statsCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = statsCurrentPage >= maxPage;

    const users = data.users || [];
    if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 40px;">${data.query ? '검색 결과가 없습니다.' : '기록된 유저가 없습니다.'}</td></tr>`;
        return;
    }

    const sortBy = data.sortBy || 'total_messages';

    tbody.innerHTML = users.map((u, idx) => {
        let displayRank = (statsCurrentPage - 1) * statsPageLimit + idx + 1;
        if (sortBy === 'total_messages') displayRank = u.totalMessagesRank;
        else if (sortBy === 'total_watch_seconds') displayRank = u.totalWatchRank;
        else if (sortBy === 'today_messages') displayRank = u.todayMessagesRank;
        else if (sortBy === 'today_watch_seconds') displayRank = u.todayWatchRank;

        let rankBadgeClass = 'stats-rank-badge';
        if (displayRank === 1) rankBadgeClass += ' stats-rank-1';
        else if (displayRank === 2) rankBadgeClass += ' stats-rank-2';
        else if (displayRank === 3) rankBadgeClass += ' stats-rank-3';

        const rankIcon = displayRank === 1 ? '🥇' : (displayRank === 2 ? '🥈' : (displayRank === 3 ? '🥉' : displayRank));
        const isSelected = u.channelId === currentSelectedChannelId ? 'selected' : '';
        const lastDate = u.lastChatDate ? u.lastChatDate : (u.lastChatTime ? tlFmtShort(u.lastChatTime) : '--');

        return `
            <tr class="stats-user-row ${isSelected}" onclick="showStatsDetail('${escapeHtml(u.channelId)}')">
                <td style="text-align: center;">
                    <span class="${rankBadgeClass}">${rankIcon}</span>
                </td>
                <td>
                    <div style="font-weight: 600; color: #fcd34d; font-size: 0.9rem;">${escapeHtml(u.displayName)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-dim); font-family: monospace;">${escapeHtml(u.channelId)}</div>
                </td>
                <td style="text-align: right; font-weight: 600; color: #f472b6;">
                    ${(u.totalMessages || 0).toLocaleString()}개
                    <div style="font-size: 0.7rem; color: var(--text-dim); font-weight: 400;">${(u.totalMessagesRank || 1).toLocaleString()}위</div>
                </td>
                <td style="text-align: right; font-weight: 600; color: #34d399;">
                    ${u.totalWatchStr || '0분'}
                    <div style="font-size: 0.7rem; color: var(--text-dim); font-weight: 400;">${(u.totalWatchRank || 1).toLocaleString()}위</div>
                </td>
                <td style="text-align: right; font-weight: 500; color: #a78bfa;">
                    ${(u.todayMessages || 0).toLocaleString()}개
                    <div style="font-size: 0.7rem; color: var(--text-dim); font-weight: 400;">${(u.todayMessagesRank || 1).toLocaleString()}위</div>
                </td>
                <td style="text-align: right; font-weight: 500; color: #fbbf24;">
                    ${u.todayWatchStr || '0분'}
                    <div style="font-size: 0.7rem; color: var(--text-dim); font-weight: 400;">${(u.todayWatchRank || 1).toLocaleString()}위</div>
                </td>
                <td style="text-align: center; color: #60a5fa; font-weight: 600;">
                    ${(u.activeDays || 0).toLocaleString()}일
                </td>
                <td style="text-align: center; font-size: 0.75rem; color: var(--text-dim);">
                    ${lastDate}
                </td>
                <td style="text-align: center;">
                    <button class="btn btn-sm" onclick="event.stopPropagation(); showStatsDetail('${escapeHtml(u.channelId)}')" style="padding: 3px 8px; font-size: 0.72rem; background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.3); color: #c084fc;">조회</button>
                </td>
            </tr>
        `;
    }).join('');
}

function showStatsDetail(channelId) {
    if (!channelId) return;
    currentSelectedChannelId = channelId;

    document.querySelectorAll('.stats-user-row').forEach(tr => tr.classList.remove('selected'));
    const rows = document.querySelectorAll('.stats-user-row');
    rows.forEach(tr => {
        if (tr.innerHTML.includes(channelId)) tr.classList.add('selected');
    });

    const card = document.getElementById('stats-detail-card');
    const layout = document.querySelector('.stats-layout-wrap');
    if (card) card.style.display = 'block';
    if (layout) layout.classList.add('has-detail');

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'getUserStatsDetail',
            payload: { channelId }
        }));
    }
}

function closeStatsDetail() {
    currentSelectedChannelId = null;
    document.querySelectorAll('.stats-user-row').forEach(tr => tr.classList.remove('selected'));
    const card = document.getElementById('stats-detail-card');
    const layout = document.querySelector('.stats-layout-wrap');
    if (card) card.style.display = 'none';
    if (layout) layout.classList.remove('has-detail');
}

function renderStatsUserDetail(data) {
    if (!data) return;

    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setTxt('stats-detail-name', data.displayName || '시청자');
    setTxt('stats-detail-channel', data.channelId || '--');

    setTxt('stats-detail-total-msgs', `${(data.totalMessages || 0).toLocaleString()}개`);
    setTxt('stats-detail-total-msgs-rank', `전체 ${(data.totalMessagesRank || 1).toLocaleString()}위`);

    setTxt('stats-detail-total-watch', data.totalWatchStr || '0분');
    setTxt('stats-detail-total-watch-rank', `전체 ${(data.totalWatchRank || 1).toLocaleString()}위`);

    setTxt('stats-detail-today-msgs', `${(data.todayMessages || 0).toLocaleString()}개`);
    setTxt('stats-detail-today-msgs-rank', `오늘 ${(data.todayMessagesRank || 1).toLocaleString()}위`);

    setTxt('stats-detail-today-watch', data.todayWatchStr || '0분');
    setTxt('stats-detail-today-watch-rank', `오늘 ${(data.todayWatchRank || 1).toLocaleString()}위`);

    setTxt('stats-detail-active-days', `${(data.daysCount || 0).toLocaleString()}일`);

    if (data.lastChatTime) {
        const d = new Date(data.lastChatTime);
        setTxt('stats-detail-last-active', `${d.toLocaleTimeString('ko-KR')}`);
        setTxt('stats-detail-last-date', data.lastChatDate || `${d.toLocaleDateString('ko-KR')}`);
    } else {
        setTxt('stats-detail-last-active', '--');
        setTxt('stats-detail-last-date', '--');
    }

    const historyTbody = document.getElementById('stats-detail-daily-tbody');
    if (historyTbody) {
        const list = data.dailyHistory || [];
        if (list.length === 0) {
            historyTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-dim); padding: 15px;">활동 이력이 없습니다.</td></tr>`;
        } else {
            historyTbody.innerHTML = list.map(item => `
                <tr>
                    <td style="font-weight: 500; color: var(--text-main); font-family: monospace;">${item.date}</td>
                    <td style="text-align: right; color: #a78bfa; font-weight: 600;">${(item.messageCount || 0).toLocaleString()}개</td>
                    <td style="text-align: right; color: #34d399; font-weight: 600;">${item.watchStr || '0분'}</td>
                </tr>
            `).join('');
        }
    }
}

// Bootstrap
connectWS();