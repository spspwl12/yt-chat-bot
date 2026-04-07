/**
 * live-downloader.js — yt-dlp 실시간 스트림 → ffmpeg 세그먼트 분할 다운로더
 *
 * yt-dlp를 단일 장기 프로세스로 실행하여 라이브 스트림을 stdout으로 출력.
 * stdout을 ffmpeg의 stdin으로 파이프하여 20초 세그먼트 파일로 자동 분할.
 * 새 세그먼트 파일이 생성될 때(= 이전 세그먼트 완성) 'segment' 이벤트 발생.
 * yt-dlp 또는 ffmpeg 비정상 종료 시 파이프라인 자동 재시작.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class LiveDownloader extends EventEmitter {
    /**
     * @param {object} config - config-search.js 전체 객체
     * @param {object} syncCfg - config-youtube.js의 sync 객체
     */
    constructor(config, syncCfg) {
        super();
        this._config = config;
        this._syncCfg = syncCfg;
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
        this._killProcesses();
        this._closeWatcher();
        this._cleanupOldSegments();
        console.log('📥 LiveDownloader 중지');
    }

    /**
     * yt-dlp(stdout) → pipe → ffmpeg(segment) 파이프라인 구성
     */
    _startPipeline() {
        if (!this._running) return;

        const segmentDir = this._getSegmentDir();
        const duration = this._syncCfg.segment_duration || 20;
        const segmentPattern = path.join(segmentDir, 'live_segment_%06d.mp4');

        // seg 폴더 생성 (없으면)
        try { fs.mkdirSync(segmentDir, { recursive: true }); } catch (_) {}

        // 이전 세그먼트 파일 제거 (재시작 시 번호 충돌 방지)
        this._cleanupOldSegments();
        this._processedSegments.clear();
        this._segmentTimes = {};
        this._restarting = false;

        console.log('📥 파이프라인 시작: yt-dlp → ffmpeg (segment)');

        // ── yt-dlp: 라이브 스트림을 stdout으로 연속 출력 ──
        this._ytdlp = spawn(this._config.ytdlp.path, [
            '-f', 'best[height<=1080]',
            '-o', '-',
            '--no-part',
            this._config.searcher.youtube_url
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        // ── ffmpeg: stdin에서 읽어 20초 단위 세그먼트 파일 생성 ──
        this._ffmpeg = spawn(this._config.ffmpeg.ffmpegPath, [
            '-y',
            '-i', 'pipe:0',
            '-c', 'copy',
            '-f', 'segment',
            '-segment_time', String(duration),
            '-reset_timestamps', '1',
            segmentPattern
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        // ── 파이프 연결: yt-dlp stdout → ffmpeg stdin ──
        this._ytdlp.stdout.pipe(this._ffmpeg.stdin);

        // 파이프 에러 무시 (한쪽이 먼저 종료될 때 EPIPE 방지)
        this._ffmpeg.stdin.on('error', () => {});
        this._ytdlp.stdout.on('error', () => {});

        // ── stderr 모니터링 ──
        this._ytdlp.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg.startsWith('ERROR:')) {
                console.error('📥 yt-dlp:', msg);
            }
        });

        this._ffmpeg.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            // ffmpeg는 stderr에 많은 로그를 출력하므로 에러만 로깅
            if (msg.toLowerCase().includes('error')) {
                console.error('📥 ffmpeg:', msg.substring(0, 200));
            }
        });

        // ── 세그먼트 파일 감시 시작 ──
        this._setupWatcher(segmentDir);

        // ── 프로세스 종료 핸들링 ──
        let ytdlpExited = false;
        let ffmpegExited = false;

        this._ytdlp.on('exit', (code, signal) => {
            ytdlpExited = true;
            console.log(`📥 yt-dlp 종료 (code=${code}, signal=${signal})`);
            // yt-dlp 종료 → ffmpeg stdin 닫힘 → ffmpeg도 곧 종료됨
            if (this._running && !this._restarting) {
                // ffmpeg가 아직 안 죽었으면 잠시 대기 후 재시작
                setTimeout(() => {
                    if (!ffmpegExited && this._ffmpeg) {
                        try { this._ffmpeg.kill('SIGTERM'); } catch (_) {}
                    }
                    this._scheduleRestart();
                }, 2000);
            }
        });

        this._ffmpeg.on('exit', (code, signal) => {
            ffmpegExited = true;
            console.log(`📥 ffmpeg 종료 (code=${code}, signal=${signal})`);
            if (this._running && !this._restarting && !ytdlpExited) {
                // ffmpeg만 죽은 경우 → yt-dlp도 종료 후 재시작
                if (this._ytdlp) {
                    try { this._ytdlp.kill('SIGTERM'); } catch (_) {}
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
                let fileSize = 0;
                try {
                    fileSize = fs.statSync(prevPath).size;
                } catch (_) {
                    console.error(`📥 세그먼트 파일 없음: ${prevFile}`);
                    return;
                }

                if (fileSize < 1024) {
                    console.log(`📥 세그먼트 ${prevFile} 크기 부족 (${fileSize}B), 스킵`);
                    fs.promises.unlink(prevPath).catch(() => {});
                    return;
                }

                const segmentInfo = {
                    path: prevPath,
                    st: this._segmentTimes[prevNum] || Date.now(),
                    ed: Date.now(),
                    size: fileSize,
                    segmentId: this._segmentCounter++
                };

                this.emit('segment', segmentInfo);

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

        this._killProcesses();
        this._closeWatcher();

        this._restartCount++;
        const maxRestart = this._syncCfg.max_restart_count || 30;
        const delay = this._syncCfg.restart_delay_ms || 3000;

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

    _killProcesses() {
        if (this._ytdlp && this._ffmpeg) {
            try { this._ytdlp.stdout.unpipe(this._ffmpeg.stdin); } catch (_) {}
        }
        if (this._ytdlp) {
            try { this._ytdlp.kill('SIGTERM'); } catch (_) {}
            this._ytdlp = null;
        }
        if (this._ffmpeg) {
            try { this._ffmpeg.kill('SIGTERM'); } catch (_) {}
            this._ffmpeg = null;
        }
    }

    _closeWatcher() {
        if (this._watcher) {
            try { this._watcher.close(); } catch (_) {}
            this._watcher = null;
        }
    }

    _getSegmentDir() {
        return path.resolve(this._config.searcher.segmentDir);
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
                    try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
                }
            }
        } catch (_) {}
    }
}

module.exports = LiveDownloader;
