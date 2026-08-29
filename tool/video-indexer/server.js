/**
 * server.js — 비디오 핑거프린트 생성기 웹 서버
 *
 * 사용법: node src/video-indexer/server.js
 * 브라우저에서 http://localhost:3000 접속
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { Worker } = require('worker_threads');
const ffmpeg = require('fluent-ffmpeg');
const { extractFrames, getVideoInfo, cleanupFrames, config } = require('./extractor');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- SSE (Server-Sent Events) 관리 ---
let sseClients = [];

function sendProgress(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(res => res.write(msg));
}

app.get('/api/progress', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    res.write('\n');
    sseClients.push(res);
    req.on('close', () => {
        sseClients = sseClients.filter(c => c !== res);
    });
});

// --- 커스텀 HTML 탐색기를 위한 디렉토리 목록 API ---
app.get('/api/list-dirs', (req, res) => {
    let targetPath = req.query.path;
    
    if (!targetPath || targetPath === 'root') {
        targetPath = process.cwd(); 
    }

    try {
        const resolvedPath = path.resolve(targetPath);
        const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
        
        const dirs = entries
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .filter(name => !name.startsWith('.') && !name.startsWith('$')); // 숨김 폴더 제외
            
        // 상위 폴더 계산
        const parentPath = path.dirname(resolvedPath);
        const hasParent = parentPath !== resolvedPath;

        res.json({
            currentPath: resolvedPath,
            parentPath: hasParent ? parentPath : null,
            dirs: dirs.sort()
        });
    } catch (err) {
        res.status(500).json({ error: '디렉토리를 읽을 수 없습니다.', details: err.message });
    }
});

// --- 비디오 파일 목록 API (크롭 미리보기용) ---
app.get('/api/list-videos', (req, res) => {
    const dirPath = req.query.path;
    if (!dirPath || !fs.existsSync(dirPath)) {
        return res.status(400).json({ error: '유효한 경로가 아닙니다.' });
    }
    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.ts'];
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const videos = entries
            .filter(d => !d.isDirectory() && videoExts.includes(path.extname(d.name).toLowerCase()))
            .map(d => d.name).sort();
        res.json({ videos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 비디오 파일 스트리밍 API (크롭 미리보기용) ---
app.get('/api/video-stream', (req, res) => {
    const filePath = req.query.path;
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
        '.mp4': 'video/mp4', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
        '.mov': 'video/quicktime', '.wmv': 'video/x-ms-wmv',
        '.webm': 'video/webm', '.ts': 'video/mp2t', '.flv': 'video/x-flv'
    };
    const contentType = mimeMap[ext] || 'video/mp4';
    const range = req.headers.range;
    
    if (range) {
        const [s, e] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(s, 10);
        const end = e ? parseInt(e, 10) : Math.min(start + 10 * 1024 * 1024, stat.size - 1);
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
        res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': stat.size, 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    }
});

// --- 현재 설정값 조회 ---
app.get('/api/config', (req, res) => {
    res.json({
        extraction: { ...config.extraction, crop: { ...config.extraction.crop } },
        phash: { ...config.phash },
        performance: { ...config.performance },
        paths: { ...config.paths },
        ffmpeg: { ...config.ffmpeg }
    });
});

// --- 영상 파일 탐색 ---
function findVideoFiles(dir, exts) {
    const files = [];
    function walk(d) {
        try {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                const fullPath = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
                    files.push(fullPath);
                }
            }
        } catch (err) {
            // 접근 불가능한 디렉토리 무시
        }
    }
    walk(dir);
    return files.sort();
}

// --- 워커 기반 해시 계산 ---
function computeHashesBatch(framePaths, batchSize, workerCount) {
    return new Promise((resolve, reject) => {
        const allResults = [];
        const batches = [];
        for (let i = 0; i < framePaths.length; i += batchSize) {
            batches.push(framePaths.slice(i, i + batchSize));
        }

        if (batches.length === 0) {
            resolve([]);
            return;
        }

        let activeWorkers = 0;
        let batchIdx = 0;

        function spawnNext() {
            if (isCancelled || batchIdx >= batches.length) {
                if (activeWorkers === 0) resolve(allResults);
                return;
            }
            const batch = batches[batchIdx++];
            activeWorkers++;
            const worker = new Worker(path.join(__dirname, 'worker.js'), {
                workerData: { framePaths: batch }
            });
            worker.on('message', (results) => {
                allResults.push(...results);
                activeWorkers--;
                spawnNext();
            });
            worker.on('error', (err) => {
                sendProgress({ type: 'log', message: `  ⚠ Worker 오류: ${err.message}` });
                activeWorkers--;
                spawnNext();
            });
        }

        const maxWorkers = workerCount || os.cpus().length;
        for (let i = 0; i < Math.min(maxWorkers, batches.length); i++) {
            spawnNext();
        }
    });
}

// --- 인덱싱 상태 ---
let isIndexing = false;
let isCancelled = false;

// --- 인덱싱 실행 API ---
function applyAndSaveConfig(opts) {
    if (opts.fps) config.extraction.fps = Number(opts.fps);
    if (opts.width) config.extraction.width = Number(opts.width);
    if (opts.height) config.extraction.height = Number(opts.height);
    if (opts.crop !== undefined) {
        config.extraction.crop = {
            enabled: !!opts.crop.enabled,
            x: Number(opts.crop.x) || 0,
            y: Number(opts.crop.y) || 0,
            w: Number(opts.crop.w) || 0,
            h: Number(opts.crop.h) || 0
        };
    }
    if (opts.videoExtensions) config.extraction.videoExtensions = opts.videoExtensions;
    if (opts.workerCount !== undefined) config.performance.workerCount = Number(opts.workerCount);
    if (opts.batchSize) config.performance.batchSize = Number(opts.batchSize);
    if (opts.fingerprintDb) config.paths.fingerprintDb = opts.fingerprintDb;
    if (opts.tempDir) config.paths.tempDir = opts.tempDir;
    if (opts.videoDir) config.paths.videoDir = opts.videoDir;
    if (opts.ffmpegPath !== undefined) {
        config.ffmpeg.ffmpegPath = opts.ffmpegPath;
        if (opts.ffmpegPath) ffmpeg.setFfmpegPath(opts.ffmpegPath);
    }
    if (opts.ffprobePath !== undefined) {
        config.ffmpeg.ffprobePath = opts.ffprobePath;
        if (opts.ffprobePath) ffmpeg.setFfprobePath(opts.ffprobePath);
    }

    try {
        const configToSave = JSON.parse(JSON.stringify(config));
        configToSave.paths.fingerprintDb = "../data/video-fingerprints.json";
        const configPath = path.join(__dirname, 'config', 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 4), 'utf-8');
    } catch (err) {
        console.error('설정 파일 저장 실패:', err);
    }
}

app.post('/api/save-config', (req, res) => {
    applyAndSaveConfig(req.body);
    res.json({ status: 'saved' });
});

app.post('/api/start-indexing', async (req, res) => {
    if (isIndexing) {
        return res.status(409).json({ error: '이미 인덱싱이 진행 중입니다.' });
    }
    
    isCancelled = false;

    const opts = req.body;
    const videoDir = opts.videoDir;

    if (!videoDir) {
        return res.status(400).json({ error: '영상 디렉토리 경로가 필요합니다.' });
    }

    const resolvedDir = path.resolve(videoDir);
    if (!fs.existsSync(resolvedDir)) {
        return res.status(400).json({ error: `디렉토리를 찾을 수 없습니다: ${resolvedDir}` });
    }

    applyAndSaveConfig(opts);

    isIndexing = true;
    res.json({ status: 'started' });

    // --- 비동기 인덱싱 작업 ---
    try {
        const videoFiles = findVideoFiles(resolvedDir, config.extraction.videoExtensions);
        sendProgress({ type: 'info', message: `🎬 발견된 영상: ${videoFiles.length}개` });

        if (videoFiles.length === 0) {
            sendProgress({ type: 'error', message: '❌ 영상 파일을 찾을 수 없습니다.' });
            return;
        }

        const dbPath = path.resolve(config.paths.fingerprintDb);
        const dbDir = path.dirname(dbPath);
        if (!dbDir || !fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

        // 기존 DB 파일이 있으면 로드하여 이어하기 (resume)
        let db;
        const existingFilenames = new Set();
        if (fs.existsSync(dbPath)) {
            try {
                db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
                db.videos.forEach(v => existingFilenames.add(v.filename));
                sendProgress({ type: 'info', message: `📂 기존 DB 발견: ${db.videos.length}개 영상 이미 처리됨 → 이어서 작업합니다.` });
            } catch (e) {
                db = null;
            }
        }

        if (!db) {
            db = {
                version: 1,
                config: {
                    fps: config.extraction.fps,
                    resizeWidth: config.phash.resizeWidth,
                    resizeHeight: config.phash.resizeHeight,
                    lowFreqSize: config.phash.lowFreqSize
                },
                createdAt: new Date().toISOString(),
                videos: []
            };
        }

        const tempDir = path.resolve(config.paths.tempDir);
        let skippedCount = 0;

        for (let i = 0; i < videoFiles.length; i++) {
            const videoPath = videoFiles[i];
            const videoName = path.basename(videoPath);
            const progress = `[${i + 1}/${videoFiles.length}]`;

            // 이미 처리된 영상은 건너뛰기
            if (existingFilenames.has(videoName)) {
                skippedCount++;
                sendProgress({
                    type: 'progress',
                    current: i + 1,
                    total: videoFiles.length,
                    videoName,
                    message: `${progress} ⏭ 건너뜀 (이미 처리됨): ${videoName}`
                });
                continue;
            }

            sendProgress({
                type: 'progress',
                current: i + 1,
                total: videoFiles.length,
                videoName,
                message: `${progress} 처리 중: ${videoName}`
            });

            try {
                if (isCancelled) break;
                
                // 영상 길이 및 해상도 조회
                const info = await getVideoInfo(videoPath);
                if (isCancelled) break;
                
                sendProgress({ type: 'log', message: `  ⏱ 길이: ${(info.duration / 60).toFixed(1)}분 (해상도: ${info.width}x${info.height})` });

                // 프레임 추출
                const startExtract = Date.now();
                const framePaths = await extractFrames(videoPath, tempDir, null, info.width, info.height);
                if (isCancelled) break;
                
                const extractTime = ((Date.now() - startExtract) / 1000).toFixed(1);
                sendProgress({ type: 'log', message: `  📸 추출된 프레임: ${framePaths.length}개 (${extractTime}s)` });

                // pHash 계산 (워커 병렬)
                const startHash = Date.now();
                const hashResults = await computeHashesBatch(
                    framePaths,
                    config.performance.batchSize,
                    config.performance.workerCount
                );
                const hashTime = ((Date.now() - startHash) / 1000).toFixed(1);

                // 유효한 해시만 필터링
                const hashes = hashResults
                    .filter(r => r.hash !== null)
                    .map(r => ({
                        timestamp: (parseInt(path.basename(r.path).match(/(\d+)/)[1]) - 1) / config.extraction.fps,
                        hash: r.hash
                    }))
                    .sort((a, b) => a.timestamp - b.timestamp);

                sendProgress({ type: 'log', message: `  🔑 해시 계산: ${hashes.length}개 (${hashTime}s)` });

                db.videos.push({
                    filename: path.basename(videoName, path.extname(videoName)),
                    frameCount: hashes.length,
                    hashes
                });

                // 프레임 정리
                cleanupFrames(path.join(tempDir, path.basename(videoPath, path.extname(videoPath))));

                // ★ 매 영상 처리 후 중간 저장
                fs.writeFileSync(dbPath, JSON.stringify(db), 'utf8');
                sendProgress({ type: 'log', message: `  ✅ 완료 (DB 중간 저장됨: ${db.videos.length}개)` });

            } catch (err) {
                sendProgress({ type: 'log', message: `  ❌ 오류: ${err.message}` });
            }
        }

        if (isCancelled) {
            // 중단되어도 지금까지 처리된 것은 이미 저장되어 있음
            fs.writeFileSync(dbPath, JSON.stringify(db), 'utf8');
            sendProgress({ type: 'error', message: `🛑 작업이 중단되었습니다. (${db.videos.length}개 영상 저장 완료 → 다시 시작하면 이어서 작업합니다)` });
        } else {
            const totalHashes = db.videos.reduce((sum, v) => sum + v.frameCount, 0);
            if (skippedCount > 0) {
                sendProgress({ type: 'complete', message: `🎉 완료! 신규 처리: ${db.videos.length - (existingFilenames.size)}개, 건너뜀: ${skippedCount}개, 총 해시: ${totalHashes.toLocaleString()}개`, dbPath });
            } else {
                sendProgress({ type: 'complete', message: `🎉 모든 작업이 완료되었습니다! 영상: ${db.videos.length}개, 총 해시: ${totalHashes.toLocaleString()}개`, dbPath });
            }
        }
    } catch (err) {
        sendProgress({ type: 'error', message: `💥 치명적 오류: ${err.message}` });
    } finally {
        isIndexing = false;
        isCancelled = false;
    }
});

app.post('/api/stop-indexing', (req, res) => {
    if (!isIndexing) {
        return res.status(400).json({ error: '진행 중인 인덱싱 작업이 없습니다.' });
    }
    isCancelled = true;
    res.json({ status: 'stopping' });
});

// --- 서버 시작 ---
app.listen(PORT, () => {
    console.log(`\n🌐 비디오 핑거프린트 생성기 서버 시작`);
    console.log(`   http://localhost:${PORT}\n`);
    
    // 브라우저 자동 실행
    const startUrl = `http://localhost:${PORT}`;
    const startCmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    exec(`${startCmd} ${startUrl}`, (err) => {
        if (err) console.error('브라우저 자동 실행 실패:', err);
    });
});
