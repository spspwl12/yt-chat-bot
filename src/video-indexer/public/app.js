/**
 * app.js — 프론트엔드 클라이언트 로직
 * 설정값을 모아 서버 API로 전송하고 SSE로 진행 상황을 수신
 */

// --- 기본 확장자 목록 ---
const ALL_EXTENSIONS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.ts'];

// --- 초기화 ---
// --- 기본 설정값 (타임스탬프 등) ---
function setDefaultPaths() {
    const dbInput = document.getElementById('input-fingerprintDb');
    if (!dbInput.value) {
        const now = new Date();
        const ts = now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        dbInput.value = `../data/video-fingerprints-${ts}.json`;
    }
}

// --- 자동 저장 헬퍼 ---
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

const autoSaveConfig = debounce(async () => {
    try {
        const opts = collectOptions();
        await fetch('/api/save-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts)
        });
    } catch (err) {
        console.error('자동 저장 실패:', err);
    }
}, 500);

document.addEventListener('DOMContentLoaded', async () => {
    setDefaultPaths();

    // 서버에서 현재 설정값 로드
    try {
        const res = await fetch('/api/config');
        const cfg = await res.json();
        applyConfig(cfg);
    } catch (err) {
        console.warn('설정 로드 실패, 기본값 사용:', err);
    }

    // 확장자 태그 렌더링
    renderExtTags();

    // 크롭 토글 이벤트
    document.getElementById('toggle-crop').addEventListener('change', (e) => {
        const fields = document.getElementById('crop-fields');
        if (e.target.checked) {
            fields.classList.add('visible');
        } else {
            fields.classList.remove('visible');
        }
    });

    // SSE 연결
    connectSSE();

    // 크롭 드래그 이벤트 바인딩
    initCropEvents();

    // 입력 필드 자동 저장 바인딩
    const inputs = document.querySelectorAll('input, select');
    inputs.forEach(el => {
        el.addEventListener('input', autoSaveConfig);
        el.addEventListener('change', autoSaveConfig);
    });
});

/**
 * 서버 설정값을 UI에 반영
 */
function applyConfig(cfg) {
    // 경로 (값이 있을 때만 덮어쓰기)
    if (cfg.paths) {
        if (cfg.paths.fingerprintDb) {
            // 만약 서버에서 준 기본값이 타임스탬프 없는 기본값이면 타임스탬프를 강제 추가
            if (cfg.paths.fingerprintDb === '../data/video-fingerprints.json') {
                setDefaultPaths();
            } else {
                setVal('input-fingerprintDb', cfg.paths.fingerprintDb);
            }
        } else {
            setDefaultPaths();
        }
        if (cfg.paths.tempDir) setVal('input-tempDir', cfg.paths.tempDir);
        if (cfg.paths.videoDir) setVal('input-videoDir', cfg.paths.videoDir);
    }

    if (cfg.ffmpeg) {
        if (cfg.ffmpeg.ffmpegPath) setVal('input-ffmpegPath', cfg.ffmpeg.ffmpegPath);
        if (cfg.ffmpeg.ffprobePath) setVal('input-ffprobePath', cfg.ffmpeg.ffprobePath);
    }

    // 추출
    if (cfg.extraction) {
        setVal('input-fps', cfg.extraction.fps);
        setVal('input-width', cfg.extraction.width);
        setVal('input-height', cfg.extraction.height);

        if (cfg.extraction.crop) {
            document.getElementById('toggle-crop').checked = cfg.extraction.crop.enabled;
            setVal('input-cropX', cfg.extraction.crop.x);
            setVal('input-cropY', cfg.extraction.crop.y);
            setVal('input-cropW', cfg.extraction.crop.w);
            setVal('input-cropH', cfg.extraction.crop.h);

            const fields = document.getElementById('crop-fields');
            if (cfg.extraction.crop.enabled) {
                fields.classList.add('visible');
            } else {
                fields.classList.remove('visible');
            }
        }
    }

    // 성능
    if (cfg.performance) {
        setVal('input-workerCount', cfg.performance.workerCount);
        setVal('input-batchSize', cfg.performance.batchSize);
    }

    // pHash 정보 (읽기 전용)
    if (cfg.phash) {
        setText('info-resizeWidth', cfg.phash.resizeWidth);
        setText('info-resizeHeight', cfg.phash.resizeHeight);
        setText('info-dctSize', cfg.phash.dctSize);
        setText('info-lowFreqSize', cfg.phash.lowFreqSize);
        const hashBits = cfg.phash.lowFreqSize * cfg.phash.lowFreqSize - 1;
        setText('info-hashBits', hashBits);
    }
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

/**
 * 확장자 태그 렌더링
 */
function renderExtTags() {
    const container = document.getElementById('ext-tags');
    container.innerHTML = '';

    ALL_EXTENSIONS.forEach(ext => {
        const tag = document.createElement('div');
        tag.className = 'ext-tag active';
        tag.dataset.ext = ext;
        tag.innerHTML = `<span class="check">✓</span> ${ext}`;
        tag.addEventListener('click', () => {
            tag.classList.toggle('active');
            autoSaveConfig();
        });
        container.appendChild(tag);
    });
}

let currentBrowserTarget = null;
let currentBrowserPath = '';

/**
 * 탐색기 열기 (모달 띄우기)
 */
function browseFolder(targetId) {
    currentBrowserTarget = targetId;
    const input = document.getElementById(targetId);
    let startPath = input.value.trim() || 'root';

    document.getElementById('browser-modal').classList.add('active');
    loadDirectory(startPath);
}

/**
 * 탐색기 모달 닫기
 */
function closeBrowser() {
    document.getElementById('browser-modal').classList.remove('active');
    currentBrowserTarget = null;
}

/**
 * 현재 경로 선택 완료
 */
function selectCurrentFolder() {
    if (currentBrowserTarget && currentBrowserPath) {
        setVal(currentBrowserTarget, currentBrowserPath);
        autoSaveConfig();
    }
    closeBrowser();
}

/**
 * API 호출하여 디렉토리 목록 로드
 */
async function loadDirectory(targetPath) {
    const listEl = document.getElementById('browser-list');
    listEl.innerHTML = '<li class="browser-item">로딩 중...</li>';

    try {
        const res = await fetch(`/api/list-dirs?path=${encodeURIComponent(targetPath)}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        currentBrowserPath = data.currentPath;
        document.getElementById('browser-current-path').textContent = currentBrowserPath;

        listEl.innerHTML = '';

        // 상위 폴더로 가기
        if (data.parentPath) {
            const li = document.createElement('li');
            li.className = 'browser-item';
            li.innerHTML = '<span>📁</span> <strong>.. (상위 폴더)</strong>';
            li.onclick = () => loadDirectory(data.parentPath);
            listEl.appendChild(li);
        }

        // 하위 폴더 목록
        if (data.dirs.length === 0) {
            const li = document.createElement('li');
            li.className = 'browser-item';
            li.style.color = 'var(--text-muted)';
            li.textContent = '하위 폴더가 없습니다.';
            listEl.appendChild(li);
        } else {
            data.dirs.forEach(dir => {
                const li = document.createElement('li');
                li.className = 'browser-item';
                li.innerHTML = `<span>📁</span> ${dir}`;
                // 폴더 경로 결합 (간단히 슬래시 추가)
                const nextPath = currentBrowserPath.endsWith('\\') || currentBrowserPath.endsWith('/')
                    ? currentBrowserPath + dir
                    : currentBrowserPath + '\\' + dir;
                li.onclick = () => loadDirectory(nextPath);
                listEl.appendChild(li);
            });
        }
    } catch (err) {
        listEl.innerHTML = `<li class="browser-item" style="color:var(--error)">오류: ${err.message}</li>`;
    }
}

/**
 * 활성화된 확장자 목록 가져오기
 */
function getActiveExtensions() {
    const tags = document.querySelectorAll('.ext-tag.active');
    return Array.from(tags).map(t => t.dataset.ext);
}

/**
 * UI에서 설정값 수집
 */
function collectOptions() {
    return {
        videoDir: document.getElementById('input-videoDir').value.trim(),
        fingerprintDb: document.getElementById('input-fingerprintDb').value.trim() || undefined,
        tempDir: document.getElementById('input-tempDir').value.trim() || undefined,
        fps: Number(document.getElementById('input-fps').value) || 2,
        width: Number(document.getElementById('input-width').value) || 64,
        height: Number(document.getElementById('input-height').value) || 64,
        ffmpegPath: document.getElementById('input-ffmpegPath') ? document.getElementById('input-ffmpegPath').value.trim() : '',
        ffprobePath: document.getElementById('input-ffprobePath') ? document.getElementById('input-ffprobePath').value.trim() : '',
        crop: {
            enabled: document.getElementById('toggle-crop').checked,
            x: Number(document.getElementById('input-cropX').value) || 0,
            y: Number(document.getElementById('input-cropY').value) || 0,
            w: Number(document.getElementById('input-cropW').value) || 0,
            h: Number(document.getElementById('input-cropH').value) || 0
        },
        videoExtensions: getActiveExtensions(),
        workerCount: Number(document.getElementById('input-workerCount').value),
        batchSize: Number(document.getElementById('input-batchSize').value) || 100
    };
}

/**
 * 인덱싱 시작
 */
async function startIndexing() {
    const opts = collectOptions();

    if (!opts.videoDir) {
        alert('영상 디렉토리 경로를 입력해주세요.');
        document.getElementById('input-videoDir').focus();
        return;
    }

    if (opts.videoExtensions.length === 0) {
        alert('최소 하나의 확장자를 선택해주세요.');
        return;
    }

    // UI 상태 변경
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    btnStart.style.display = 'none';
    btnStop.style.display = 'block';

    // 진행 상황 영역 표시 및 초기화
    const progressSection = document.getElementById('progress-section');
    progressSection.classList.add('visible');
    document.getElementById('log-output').innerHTML = '';
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-percent').textContent = '0%';
    document.getElementById('progress-status').textContent = '시작 중...';
    document.getElementById('result-banner').className = 'result-banner';
    document.getElementById('result-banner').style.display = 'none';

    try {
        const res = await fetch('/api/start-indexing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opts)
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '서버 오류');
        }
    } catch (err) {
        alert(`오류: ${err.message}`);
        resetButtons();
    }
}

async function stopIndexing() {
    const btnStop = document.getElementById('btn-stop');
    btnStop.disabled = true;
    btnStop.textContent = '중지 중...';
    try {
        await fetch('/api/stop-indexing', { method: 'POST' });
    } catch (err) {
        console.error('중지 요청 실패:', err);
    }
}

function resetButtons() {
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    btnStart.style.display = 'block';
    btnStart.disabled = false;
    btnStart.textContent = '🚀 인덱싱 시작';
    btnStop.style.display = 'none';
    btnStop.disabled = false;
    btnStop.textContent = '🛑 중지';
}

/**
 * SSE 연결 (진행 상황 실시간 수신)
 */
function connectSSE() {
    const evtSource = new EventSource('/api/progress');

    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleProgressEvent(data);
    };

    evtSource.onerror = () => {
        // 재연결 시도 (EventSource 자동 처리)
    };
}

/**
 * 진행 상황 이벤트 처리
 */
function handleProgressEvent(data) {
    const logOutput = document.getElementById('log-output');
    const progressBar = document.getElementById('progress-bar');
    const progressPercent = document.getElementById('progress-percent');
    const progressStatus = document.getElementById('progress-status');
    const resultBanner = document.getElementById('result-banner');
    const btn = document.getElementById('btn-start');

    switch (data.type) {
        case 'progress':
            const pct = Math.round((data.current / data.total) * 100);
            progressBar.style.width = `${pct}%`;
            progressPercent.textContent = `${pct}%`;
            progressStatus.textContent = data.message;
            appendLog(data.message, 'log-info');
            break;

        case 'log':
            appendLog(data.message);
            break;

        case 'info':
            appendLog(data.message, 'log-info');
            break;

        case 'complete':
            progressBar.style.width = '100%';
            progressPercent.textContent = '100%';
            progressStatus.textContent = '완료!';
            appendLog(data.message, 'log-success');

            resultBanner.className = 'result-banner success';
            resultBanner.style.display = 'flex';
            resultBanner.textContent = `${data.message} → ${data.dbPath}`;

            resetButtons();
            break;

        case 'error':
            appendLog(data.message, 'log-error');

            resultBanner.className = 'result-banner error';
            resultBanner.style.display = 'flex';
            resultBanner.textContent = data.message;

            resetButtons();
            break;
    }
}

/**
 * 로그 줄 추가
 */
function appendLog(message, className) {
    const logOutput = document.getElementById('log-output');
    const line = document.createElement('div');
    line.className = `log-line ${className || ''}`;
    line.textContent = message;
    logOutput.appendChild(line);

    // 자동 스크롤
    logOutput.scrollTop = logOutput.scrollHeight;
}

/* ==================================================
   시각적 크롭 도구 기능
   ================================================== */
let isDragging = false;
let startX = 0, startY = 0;
let cropData = { x: 0, y: 0, w: 0, h: 0 };
let currentVideoPath = '';

async function openCropModal() {
    const videoDir = document.getElementById('input-videoDir').value.trim();
    if (!videoDir) {
        alert('먼저 영상 디렉토리를 입력하거나 선택해주세요.');
        return;
    }

    document.getElementById('crop-modal').classList.add('active');

    const select = document.getElementById('crop-video-select');
    select.innerHTML = '<option>비디오 목록을 불러오는 중...</option>';

    try {
        const res = await fetch(`/api/list-videos?path=${encodeURIComponent(videoDir)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        select.innerHTML = '';
        if (data.videos.length === 0) {
            select.innerHTML = '<option value="">(해당 폴더에 지원되는 비디오 없음)</option>';
        } else {
            data.videos.forEach(v => {
                const opt = document.createElement('option');
                opt.value = videoDir + (videoDir.endsWith('\\') || videoDir.endsWith('/') ? '' : '\\') + v;
                opt.textContent = v;
                select.appendChild(opt);
            });
        }
    } catch (err) {
        select.innerHTML = `<option value="">오류: ${err.message}</option>`;
    }
}

function closeCropModal() {
    document.getElementById('crop-modal').classList.remove('active');
    const video = document.getElementById('crop-video');
    video.pause();
    video.src = '';
}

function loadCropVideo() {
    const select = document.getElementById('crop-video-select');
    const filePath = select.value;
    if (!filePath) return;

    const video = document.getElementById('crop-video');
    video.src = `/api/video-stream?path=${encodeURIComponent(filePath)}`;
    video.load();
    video.play().catch(e => console.warn('자동 재생 차단됨', e));
    document.getElementById('crop-overlay').style.display = 'none';
}

function initCropEvents() {
    const wrapper = document.getElementById('video-wrapper');
    const overlay = document.getElementById('crop-overlay');
    const video = document.getElementById('crop-video');
    const magnifier = document.getElementById('crop-magnifier');
    const magCtx = magnifier.getContext('2d', { willReadFrequently: true });

    const brightnessInput = document.getElementById('crop-brightness');
    if (brightnessInput) {
        brightnessInput.addEventListener('input', (e) => {
            video.style.filter = `brightness(${e.target.value}%)`;
        });
    }

    function updateMagnifier(x, y, rect) {
        magnifier.style.display = 'block';

        // 돋보기 위치 (커서 우측 하단, 화면 넘어가면 좌측 상단으로)
        let magX = x + 20;
        let magY = y + 20;
        if (magX + 120 > rect.width) magX = x - 140;
        if (magY + 120 > rect.height) magY = y - 140;

        magnifier.style.left = magX + 'px';
        magnifier.style.top = magY + 'px';

        // 캔버스 초기화
        magCtx.fillStyle = '#000';
        magCtx.fillRect(0, 0, 120, 120);

        // 원본 해상도 대비 스케일 계산
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;

        const srcX = x * scaleX;
        const srcY = y * scaleY;

        // 영상 픽셀 렌더링
        try {
            magCtx.filter = video.style.filter || 'none';
            magCtx.drawImage(
                video,
                srcX - 30, srcY - 30, 60, 60,
                0, 0, 120, 120
            );
            magCtx.filter = 'none';
        } catch (err) {
            // CORS/Tainted canvas 에러 무시
        }

        // 십자선 그리기
        magCtx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
        magCtx.lineWidth = 1;
        magCtx.beginPath();
        magCtx.moveTo(60, 0); magCtx.lineTo(60, 120);
        magCtx.moveTo(0, 60); magCtx.lineTo(120, 60);
        magCtx.stroke();
    }

    video.addEventListener('mousedown', (e) => {
        if (!video.videoWidth) return;
        isDragging = true;
        e.preventDefault();

        const rect = video.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;

        overlay.style.display = 'block';
        overlay.style.left = startX + 'px';
        overlay.style.top = startY + 'px';
        overlay.style.width = '0px';
        overlay.style.height = '0px';
    });

    window.addEventListener('mousemove', (e) => {
        if (!video.videoWidth) return;
        const rect = video.getBoundingClientRect();

        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;

        const isHover = rawX >= 0 && rawX <= rect.width && rawY >= 0 && rawY <= rect.height;

        if (isDragging || isHover) {
            const mx = Math.max(0, Math.min(rawX, rect.width));
            const my = Math.max(0, Math.min(rawY, rect.height));
            updateMagnifier(mx, my, rect);
        } else {
            magnifier.style.display = 'none';
        }

        if (!isDragging) return;

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

        overlay.style.left = left + 'px';
        overlay.style.top = top + 'px';
        overlay.style.width = width + 'px';
        overlay.style.height = height + 'px';

        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;

        cropData = {
            x: Math.round(left * scaleX),
            y: Math.round(top * scaleY),
            w: Math.round(width * scaleX),
            h: Math.round(height * scaleY)
        };

        document.getElementById('preview-cropX').value = cropData.x;
        document.getElementById('preview-cropY').value = cropData.y;
        document.getElementById('preview-cropW').value = cropData.w;
        document.getElementById('preview-cropH').value = cropData.h;
    });

    window.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;

        const rect = video.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        if (rawX < 0 || rawX > rect.width || rawY < 0 || rawY > rect.height) {
            magnifier.style.display = 'none';
        }
    });
}

function applyCrop() {
    document.getElementById('toggle-crop').checked = true;
    document.getElementById('crop-fields').classList.add('visible');

    document.getElementById('input-cropX').value = cropData.x || 0;
    document.getElementById('input-cropY').value = cropData.y || 0;
    document.getElementById('input-cropW').value = cropData.w || 0;
    document.getElementById('input-cropH').value = cropData.h || 0;

    closeCropModal();
}
