/**
 * live-searcher.js — searcher.exe 데몬 프로세스 매니저
 *
 * searcher.exe를 --daemon 모드로 상시 구동.
 * 새 세그먼트가 도착하면 stdin으로 클립 경로를 전달하고
 * stdout에서 JSON 결과를 읽어 'match' 이벤트 발생.
 * 데몬 비정상 종료 시 자동 재시작.
 * 처리 완료된 세그먼트 파일은 즉시 삭제.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');

class LiveSearcher extends EventEmitter {
    /**
     * @param {object} config - config-search.js 전체 객체
     * @param {object} syncCfg - config-youtube.js의 sync 객체
     */
    constructor(config, syncCfg) {
        super();
        this._config = config;
        this._syncCfg = syncCfg;
        this._running = false;
        this._daemon = null;
        this._ready = false;
        this._restartCount = 0;

        // 세그먼트 처리 큐
        this._queue = [];
        this._processing = false;

        // stdout JSON 버퍼
        this._jsonBuffer = '';

        // 현재 처리 중인 세그먼트
        this._currentSegment = null;
        this._resolveResult = null;
    }

    start() {
        if (this._running) return;
        this._running = true;
        console.log('🔍 LiveSearcher 시작');
        this._spawnDaemon();
    }

    stop() {
        this._running = false;
        this._killDaemon();
        this._queue.length = 0;
        console.log('🔍 LiveSearcher 중지');
    }

    /**
     * 세그먼트를 처리 큐에 추가
     * @param {object} segmentInfo - { path, st, ed, size, segmentId }
     */
    enqueue(segmentInfo) {
        // 큐가 너무 길면 오래된 것 버림 (최신 2개만 유지)
        while (this._queue.length >= 2) {
            const old = this._queue.shift();
            this._deleteSegment(old.path);
            console.log(`🔍 큐 오버플로 — 세그먼트 #${old.segmentId} 스킵`);
        }
        this._queue.push(segmentInfo);
        this._processNext();
    }

    async _processNext() {
        if (this._processing || this._queue.length === 0 || !this._ready) return;
        this._processing = true;

        const segment = this._queue.shift();
        this._currentSegment = segment;

        try {
            const result = await this._searchClip(segment.path);
            if (result) {
                this.emit('match', {
                    result: result,
                    segment: segment
                });
            }
        } catch (err) {
            console.error(`🔍 검색 오류 (세그먼트 #${segment.segmentId}):`, err.message);
        } finally {
            // 처리 완료된 세그먼트 파일 삭제
            this._deleteSegment(segment.path);
            this._currentSegment = null;
            this._processing = false;
            // 큐에 대기 중인 다음 세그먼트 처리
            this._processNext();
        }
    }

    /**
     * 데몬에게 클립 경로를 보내고 결과를 받음
     * @param {string} clipPath
     * @returns {Promise<object|null>}
     */
    _searchClip(clipPath) {
        return new Promise((resolve, reject) => {
            if (!this._daemon || !this._ready) {
                return reject(new Error('데몬이 준비되지 않았습니다.'));
            }

            this._jsonBuffer = '';
            this._resolveResult = resolve;

            // 타임아웃 설정 (60초)
            const timeout = setTimeout(() => {
                this._resolveResult = null;
                reject(new Error('검색 타임아웃'));
            }, 60000);

            // 기존 타임아웃 클리어를 위한 참조 저장
            this._searchTimeout = timeout;

            try {
                this._daemon.stdin.write(clipPath + '\n');
            } catch (err) {
                clearTimeout(timeout);
                this._resolveResult = null;
                reject(err);
            }
        });
    }

    _spawnDaemon() {
        if (!this._running) return;

        this._ready = false;
        this._jsonBuffer = '';

        // config.json 생성 (데몬용)
        const targetConfigPath = this._config.searcher.commandLine
            .find(arg => arg.endsWith('.json') && arg.includes('config'));

        if (targetConfigPath) {
            try {
                fs.writeFileSync(targetConfigPath, JSON.stringify(this._config), 'utf8');
            } catch (_) { }
        }

        // searcher.exe --daemon 실행 인자 구성
        const args = [
            '--daemon',
            ...this._config.searcher.commandLine // 이제 config-search.js의 commandLine에 클립 경로 플레이스홀더가 없으므로 전부 전달
        ];


        console.log(`🔍 데몬 시작: ${this._config.searcher.path} ${args.join(' ')}`);

        const daemon = spawn(this._config.searcher.path, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });

        this._daemon = daemon;

        // stdout 처리: JSON 결과 + __RESULT_END__ 구분자
        const rl = readline.createInterface({ input: daemon.stdout });
        rl.on('line', (line) => {
            if (line.trim() === '__RESULT_END__') {
                // JSON 결과 완성
                this._onResult(this._jsonBuffer.trim());
                this._jsonBuffer = '';
            } else {
                this._jsonBuffer += line + '\n';
            }
        });

        // stderr 처리: __DAEMON_READY__ 감지 + 에러 로그
        const stderrRl = readline.createInterface({ input: daemon.stderr });
        stderrRl.on('line', (line) => {
            if (line.trim() === '__DAEMON_READY__') {
                this._ready = true;
                this._restartCount = 0;
                console.log('🔍 데몬 준비 완료 (DB 로드 완료)');
                // 대기열에 있는 세그먼트 처리 시작
                this._processNext();
            } else if (line.trim() === '__DAEMON_EXIT__') {
                console.log('🔍 데몬 정상 종료');
            } else if (line.trim()) {
                console.error('🔍 데몬 stderr:', line);
            }
        });

        // 데몬 비정상 종료 처리
        daemon.on('exit', (code, signal) => {
            this._ready = false;
            rl.close();
            stderrRl.close();

            // 현재 진행 중인 검색 실패 처리
            if (this._resolveResult) {
                if (this._searchTimeout) clearTimeout(this._searchTimeout);
                this._resolveResult(null);
                this._resolveResult = null;
            }

            if (!this._running) return;

            this._restartCount++;
            const maxRestart = this._syncCfg.max_restart_count || 30;
            const delay = this._syncCfg.restart_delay_ms || 3000;

            console.error(`🔍 데몬 종료 (code=${code}, signal=${signal}), 재시작 ${this._restartCount}/${maxRestart}`);

            if (this._restartCount >= maxRestart) {
                console.error('🔍 데몬 최대 재시작 횟수 초과. 60초 후 카운터 리셋 후 재시도.');
                this._restartCount = 0;
                setTimeout(() => this._spawnDaemon(), 60000);
            } else {
                setTimeout(() => this._spawnDaemon(), delay);
            }
        });

        daemon.on('error', (err) => {
            console.error('🔍 데몬 spawn 오류:', err.message);
        });
    }

    _onResult(jsonStr) {
        if (!jsonStr) return;

        try {
            const parsed = JSON.parse(jsonStr);
            if (this._resolveResult) {
                if (this._searchTimeout) clearTimeout(this._searchTimeout);
                this._resolveResult(parsed);
                this._resolveResult = null;
            }
        } catch (err) {
            console.error('🔍 JSON 파싱 오류:', err.message);
            if (this._resolveResult) {
                if (this._searchTimeout) clearTimeout(this._searchTimeout);
                this._resolveResult(null);
                this._resolveResult = null;
            }
        }
    }

    _killDaemon() {
        if (this._daemon) {
            try {
                this._daemon.stdin.write('quit\n');
                // 정상 종료 대기 후 강제 종료
                setTimeout(() => {
                    try { this._daemon.kill('SIGTERM'); } catch (_) { }
                }, 2000);
            } catch (_) {
                try { this._daemon.kill('SIGTERM'); } catch (_2) { }
            }
            this._daemon = null;
        }
    }

    _deleteSegment(filePath) {
        fs.promises.unlink(filePath).catch(() => { });
    }
}

module.exports = LiveSearcher;
