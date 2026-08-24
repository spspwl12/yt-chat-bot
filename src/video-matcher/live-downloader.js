/**
 * live-downloader.js — yt-dlp 실시간 스트림 → ffmpeg 세그먼트 분할 다운로더
 *
 * yt-dlp를 단일 장기 프로세스로 실행하여 라이브 스트림을 stdout으로 출력.
 * stdout을 ffmpeg의 stdin으로 파이프하여 20초 세그먼트 파일로 자동 분할.
 * 새 세그먼트 파일이 생성될 때(= 이전 세그먼트 완성) 'segment' 이벤트 발생.
 * yt-dlp 또는 ffmpeg 비정상 종료 시 파이프라인 자동 재시작.
 */

const { EventEmitter } = require('events');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const configManager = require('../config-manager.js');
const { schCfg } = configManager;

/**
 * 프로세스 및 하위 프로세스 트리 강제 종료 및 스트림 정리
 */
function killProcessTree(proc) {
    if (!proc || !proc.pid) return;
    try {
        proc.removeAllListeners();
        if (proc.stdout) {
            proc.stdout.removeAllListeners();
            proc.stdout.destroy();
        }
        if (proc.stderr) {
            proc.stderr.removeAllListeners();
            proc.stderr.destroy();
        }
        if (proc.stdin) {
            proc.stdin.removeAllListeners();
            proc.stdin.destroy();
        }
    } catch (_) { }

    const pid = proc.pid;
    if (process.platform === 'win32') {
        try {
            exec(`taskkill /pid ${pid} /T /F`, () => { });
        } catch (_) { }
    } else {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch (_) {
            try { proc.kill('SIGKILL'); } catch (_) { }
        }
    }
}

class LiveDownloader extends EventEmitter {
    constructor() {
        super();
        this._running = false;

        // 프로세스 핸들
        this._ytdlp = null;
        this._ffmpeg = null;
        this._watcher = null;

        // 세그먼트 추적
        this._processedSegments = new Set();
        this._segmentTimes = {};        // segNum → 파일 최초 감지 시각
        this._segmentCounter = 0;       // 전역 세그먼트 ID (재시작 해도 유지)

        // 재시작 관리
        this._restartCount = 0;
        this._restarting = false;
        this._pipelineGen = 0;  // 파이프라인 세대 카운터 (중첩 재시작 방지)

        // Watchdog
        this._watchdogTimer = null;
    }

    isRunning() {
        return this._running;
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._restartCount = 0;
        console.log('📥 LiveDownloader 시작');
        this._cleanupOldSegments();
        this._startPipeline();
    }

    stop() {
        this._running = false;
        this._clearWatchdog();
        this._killProcesses();
        this._closeWatcher();
        this._cleanupOldSegments();
        console.log('📥 LiveDownloader 중지');
    }

    restart() {
        if (!this._running) return;
        console.log('📥 LiveDownloader 재시작 중...');
        this._clearWatchdog();
        this._killProcesses();
        this._closeWatcher();
        this._cleanupOldSegments();
        this._startPipeline();
    }

    /**
     * yt-dlp(stdout) → pipe → ffmpeg(segment) 파이프라인 구성
     */
    _startPipeline() {
        if (!this._running) return;

        // 파이프라인 세대 증가: 이전 세대의 지연된 exit 핸들러가 재시작을 트리거하지 못하도록 함
        const gen = ++this._pipelineGen;

        const segmentDir = this._getSegmentDir();
        const duration = (schCfg.sync && schCfg.sync.segment_duration_max) || 20;
        const segmentPattern = path.join(segmentDir, 'live_segment_%06d.mp4');

        // seg 폴더 생성 (없으면)
        try { fs.mkdirSync(segmentDir, { recursive: true }); } catch (_) { }

        // 이전 세그먼트 파일 제거 (재시작 시 번호 충돌 방지)
        this._cleanupOldSegments();
        this._processedSegments.clear();
        this._segmentTimes = {};
        this._restarting = false;

        // Watchdog 시작 (최초 세그먼트 대기)
        this._resetWatchdog();

        console.log('📥 파이프라인 시작: yt-dlp → ffmpeg (segment)');

        // ── yt-dlp: 라이브 스트림을 stdout으로 연속 출력 ──
        const rawCustomArgs = (schCfg.ytdlp && (schCfg.ytdlp.commandLine || schCfg.ytdlp.args || schCfg.ytdlp.options)) || [];
        let customArgs = [];
        if (Array.isArray(rawCustomArgs)) {
            customArgs = rawCustomArgs.map(String).filter(Boolean);
        } else if (typeof rawCustomArgs === 'string' && rawCustomArgs.trim()) {
            customArgs = rawCustomArgs.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(s => s.replace(/^"|"$/g, '')) || [];
        }

        const ytdlpArgs = [
            ...customArgs,
            schCfg.searcher.youtube_url
        ];

        this._ytdlp = spawn(schCfg.ytdlp.path, ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

        // ── ffmpeg: stdin에서 읽어 20초 단위 세그먼트 파일 생성 & 2초마다 썸네일 업데이트 ──
        const tempPreview = path.resolve(__dirname, '../../data/temp_preview.jpg');
        this._ffmpeg = spawn(schCfg.ffmpeg.ffmpegPath, [
            '-y',
            '-i', 'pipe:0',
            // 첫 번째 출력: 세그먼트 파일 (스트림 복사)
            '-map', '0',
            '-c', 'copy',
            '-f', 'segment',
            '-segment_time', String(duration),
            '-reset_timestamps', '1',
            segmentPattern,
            // 두 번째 출력: 실시간 썸네일 지속 갱신 (요청 시 즉시 제공되도록 마련)
            '-map', '0:v',
            '-vf', 'fps=1/2',
            '-update', '1',
            tempPreview
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        // ── 파이프 연결: yt-dlp stdout → ffmpeg stdin ──
        this._ytdlp.stdout.pipe(this._ffmpeg.stdin);

        // 파이프 에러 무시 (한쪽이 먼저 종료될 때 EPIPE 방지)
        this._ffmpeg.stdin.on('error', () => { });
        this._ytdlp.stdout.on('error', () => { });

        // ── yt-dlp stderr 모니터링 (config.ytdlp.logLevel 기준 필터링) ──
        const logLevel = (schCfg.ytdlp && schCfg.ytdlp.logLevel) || 'error';
        this._ytdlp.stderr.on('data', (data) => {
            if (gen !== this._pipelineGen) return;
            const msg = data.toString().trim();
            if (!msg) return;
            if (logLevel === 'all') {
                console.log('📥 yt-dlp:', msg);
            } else if (logLevel === 'warning') {
                if (msg.startsWith('ERROR:') || msg.startsWith('WARNING:')) console.log('📥 yt-dlp:', msg);
            } else if (logLevel === 'error') {
                if (msg.startsWith('ERROR:')) console.error('📥 yt-dlp:', msg);
            }

            // 세그먼트 실패로 인한 스트림 영구 중단 감지 시 빠른 재시작 트리거
            if (msg.includes('failed too many times, skipping') ||
                msg.includes('HTTP error 403')) {
                if (gen !== this._pipelineGen || this._restarting || !this._running) return;
                console.warn('📥 HLS 세그먼트 오류 감지 → 파이프라인 자동 복구 트리거');
                setTimeout(() => {
                    if (gen !== this._pipelineGen) return;
                    this._flushLastSegment(segmentDir);
                    this._killProcesses();
                    this._scheduleRestart();
                }, 1000);
            }
        });

        this._ffmpeg.stderr.on('data', (data) => {
            if (gen !== this._pipelineGen) return;
            const msg = data.toString().trim();
            if (msg.toLowerCase().includes('error')) {
                console.error('📥 ffmpeg:', msg.substring(0, 200));
            }
        });

        // ── 세그먼트 파일 감시 시작 ──
        this._setupWatcher(segmentDir);

        // ── 프로세스 종료 핸들링 (세대 체크로 중첩 재시작 방지) ──
        let ytdlpExited = false;
        let ffmpegExited = false;

        this._ytdlp.on('exit', (code, signal) => {
            if (gen !== this._pipelineGen) return;
            ytdlpExited = true;
            console.log(`📥 yt-dlp 종료 (code=${code}, signal=${signal})`);
            if (this._running && !this._restarting) {
                // ffmpeg가 마지막 세그먼트를 플러시할 시간을 줌 (yt-dlp stdout EOF 후 ffmpeg이 데이터 쓰기 완료하는 데 필요)
                setTimeout(() => {
                    if (gen !== this._pipelineGen) return;
                    // 마지막으로 기록된 미처리 세그먼트 강제 emit
                    this._flushLastSegment(segmentDir);
                    if (!ffmpegExited && this._ffmpeg) {
                        try { killProcessTree(this._ffmpeg); } catch (_) { }
                    }
                    this._scheduleRestart();
                }, 3000);
            }
        });

        this._ffmpeg.on('exit', (code, signal) => {
            ffmpegExited = true;
            console.log(`📥 ffmpeg 종료 (code=${code}, signal=${signal})`);
            // 세대가 바뀌었으면 이미 재시작됐으므로 무시
            if (gen !== this._pipelineGen) return;
            if (this._running && !this._restarting && !ytdlpExited) {
                if (this._ytdlp) {
                    try { this._ytdlp.kill('SIGTERM'); } catch (_) { }
                }
                this._scheduleRestart();
            }
        });

        this._ytdlp.on('error', (err) => {
            console.error('📥 yt-dlp spawn 오류:', err.message);
            this.emit('error', err);
        });

        this._ffmpeg.on('error', (err) => {
            console.error('📥 ffmpeg spawn 오류:', err.message);
            this.emit('error', err);
        });
    }

    /**
     * 세그먼트 디렉토리 감시.
     * 새 세그먼트 N이 생성되면 → 이전 세그먼트 N-1이 완성된 것이므로 emit.
     */
    _setupWatcher(segmentDir) {
        this._closeWatcher();

        this._watcher = fs.watch(segmentDir, (eventType, filename) => {
            if (!filename ||
                !filename.startsWith('live_segment_') ||
                !filename.endsWith('.mp4'))
                return;

            const match = filename.match(/live_segment_(\d+)\.mp4/);
            if (!match) return;

            const segNum = parseInt(match[1], 10);

            // 이미 감지한 세그먼트면 무시 (fs.watch 중복 이벤트 방지)
            if (this._segmentTimes[segNum] !== undefined) return;

            // 최초 감지 시각 기록
            this._segmentTimes[segNum] = Date.now();

            // 세그먼트 N이 감지되면 → N-1은 완성됨 → 처리 대상
            const prevNum = segNum - 1;
            if (prevNum >= 0 && !this._processedSegments.has(prevNum)) {
                this._processedSegments.add(prevNum);

                const prevFile = `live_segment_${String(prevNum).padStart(6, '0')}.mp4`;
                const prevPath = path.join(segmentDir, prevFile);

                // 파일 존재 및 크기 확인
                let fileStat;
                try {
                    fileStat = fs.statSync(prevPath);
                } catch (_) {
                    console.error(`📥 세그먼트 파일 없음: ${prevFile}`);
                    return;
                }

                if (fileStat.size < 1024) {
                    console.log(`📥 세그먼트 ${prevFile} 크기 부족 (${fileStat.size}B), 스킵`);
                    fs.promises.unlink(prevPath).catch(() => { });
                    return;
                }

                const segmentInfo = {
                    path: prevPath,
                    st: fileStat.birthtimeMs,   // 파일이 디스크에 실제 생성된 시점
                    ed: Date.now(),
                    size: fileStat.size,
                    segmentId: this._segmentCounter++
                };

                this.emit('segment', segmentInfo);

                // 다운로드 성공 → 재시작 카운터 초기화
                this._restartCount = 0;

                // Watchdog 타이머 리셋 (세그먼트 도착 확인)
                this._resetWatchdog();

                // 타이밍 기록 정리
                delete this._segmentTimes[prevNum];
            }
        });

        this._watcher.on('error', (err) => {
            console.error('📥 watcher 오류:', err.message);
        });
    }

    /**
     * 파이프라인 재시작 스케줄링
     */
    _scheduleRestart() {
        if (this._restarting || !this._running) return;
        this._restarting = true;

        this._clearWatchdog();
        this._killProcesses();
        this._closeWatcher();

        this._restartCount++;
        const maxRestart = (schCfg.sync && schCfg.sync.max_restart_count) || 30;
        const delay = (schCfg.sync && schCfg.sync.restart_delay_ms) || 3000;

        if (this._restartCount >= maxRestart) {
            console.error('📥 최대 재시작 횟수 초과. 60초 후 카운터 리셋 후 재시도.');
            this._restartCount = 0;
            setTimeout(() => {
                if (this._running) this._startPipeline();
            }, 60000);
        } else {
            console.log(`📥 ${delay}ms 후 파이프라인 재시작 (${this._restartCount}/${maxRestart})`);
            setTimeout(() => {
                if (this._running) this._startPipeline();
            }, delay);
        }
    }

    /**
     * Watchdog 타이머 시작/리셋.
     * downloader_timeout_ms 동안 세그먼트가 오지 않으면 파이프라인 강제 재시작.
     */
    _resetWatchdog() {
        const wdCfg = schCfg.watchdog;
        if (!wdCfg || !wdCfg.enable) return;

        this._clearWatchdog();
        const timeout = wdCfg.downloader_timeout_ms || 120000;
        this._watchdogTimer = setTimeout(() => {
            console.error(`📥 [Watchdog] ${timeout}ms 동안 세그먼트 무응답 → 파이프라인 강제 재시작`);
            this._scheduleRestart();
        }, timeout);
    }

    _clearWatchdog() {
        if (this._watchdogTimer) {
            clearTimeout(this._watchdogTimer);
            this._watchdogTimer = null;
        }
    }

    _killProcesses() {
        if (this._ytdlp && this._ffmpeg) {
            try { this._ytdlp.stdout.unpipe(this._ffmpeg.stdin); } catch (_) { }
        }
        if (this._ytdlp) {
            killProcessTree(this._ytdlp);
            this._ytdlp = null;
        }
        if (this._ffmpeg) {
            killProcessTree(this._ffmpeg);
            this._ffmpeg = null;
        }
    }

    _closeWatcher() {
        if (this._watcher) {
            try { this._watcher.close(); } catch (_) { }
            this._watcher = null;
        }
    }

    _getSegmentDir() {
        return path.resolve(schCfg.searcher.segmentDir);
    }

    /**
     * 기존 세그먼트 파일 전부 삭제
     */
    _cleanupOldSegments() {
        const dir = this._getSegmentDir();
        try {
            const files = fs.readdirSync(dir);
            for (const f of files) {
                if (f.startsWith('live_segment_') && f.endsWith('.mp4')) {
                    try { fs.unlinkSync(path.join(dir, f)); } catch (_) { }
                }
            }
        } catch (_) { }
    }

    /**
     * yt-dlp 종료 시 마지막으로 기록된 미처리 세그먼트를 강제 emit.
     * watcher는 N+1 파일이 생길 때 N을 emit하는데,
     * yt-dlp가 종료되면 마지막 세그먼트는 영원히 emit되지 않음.
     */
    _flushLastSegment(segmentDir) {
        try {
            const files = fs.readdirSync(segmentDir)
                .filter(f => f.startsWith('live_segment_') && f.endsWith('.mp4'))
                .sort();

            if (files.length === 0) return;

            // 미처리 세그먼트 중 가장 높은 번호 emit
            for (let i = files.length - 1; i >= 0; i--) {
                const file = files[i];
                const match = file.match(/live_segment_(\d+)\.mp4/);
                if (!match) continue;
                const segNum = parseInt(match[1], 10);
                if (this._processedSegments.has(segNum)) continue;

                const filePath = path.join(segmentDir, file);
                let stat;
                try { stat = fs.statSync(filePath); } catch (_) { continue; }
                if (stat.size < 1024) continue;

                this._processedSegments.add(segNum);
                const segmentInfo = {
                    path: filePath,
                    st: stat.birthtimeMs,
                    ed: Date.now(),
                    size: stat.size,
                    segmentId: this._segmentCounter++
                };
                console.log(`📥 마지막 세그먼트 emit: ${file} (${stat.size}B)`);
                this.emit('segment', segmentInfo);
                this._restartCount = 0;
                break;
            }
        } catch (e) {
            console.error('📥 _flushLastSegment 오류:', e.message);
        }
    }
}

module.exports = LiveDownloader;

/**
 * 라이브 세그먼트에서 최신 완성 프레임을 JPEG base64로 추출
 * (LiveDownloader가 실시간으로 temp_preview.jpg를 갱신해 두므로 바로 읽기만 함)
 * @returns {Promise<{ success: boolean, image?: string, source?: string, error?: string }>}
 */
async function extractLatestSegmentFrame() {
    const tempOut = path.resolve(__dirname, '../../data/temp_preview.jpg');

    if (fs.existsSync(tempOut)) {
        try {
            const base64 = fs.readFileSync(tempOut).toString('base64');
            return { success: true, image: 'data:image/jpeg;base64,' + base64, source: 'live_thumbnail' };
        } catch (err) {
            return { success: false, error: '프레임 읽기 실패: ' + err.message };
        }
    }

    return { success: false, error: '준비된 썸네일이 없습니다. (방송 다운로드 대기 중)' };
}

// ─── yt-dlp ON/OFF 활성화 상태 영속화 ─────────────────────────────────────────
const YTDLP_STATE_FILE = path.join(__dirname, '../../data', 'ytdlp-state.json');

function getYtdlpEnabled() {
    try {
        return JSON.parse(fs.readFileSync(YTDLP_STATE_FILE, 'utf8')).enabled !== false;
    } catch {
        return true;
    }
}

function saveYtdlpState(enabled) {
    try {
        fs.writeFileSync(YTDLP_STATE_FILE, JSON.stringify({ enabled }), 'utf8');
    } catch { }
}

module.exports.extractLatestSegmentFrame = extractLatestSegmentFrame;
module.exports.getYtdlpEnabled = getYtdlpEnabled;
module.exports.saveYtdlpState = saveYtdlpState;
