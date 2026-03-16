/**
 * indexer.js — 영상 디렉토리를 인덱싱하여 fingerprint DB 생성
 *
 * 사용법:
 *   node src/indexer.js <영상_디렉토리> [--config config.json]
 *
 * 예시:
 *   node src/indexer.js ./videos/
 *   node src/indexer.js ./videos/ --config custom-config.json
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');
const { extractFrames, getVideoDuration, cleanupFrames, config } = require('./extractor');


// --- 영상 파일 탐색 ---
function findVideoFiles(dir) {
    const exts = config.extraction.videoExtensions;
    const files = [];

    function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const fullPath = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
                files.push(fullPath);
            }
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

        let completed = 0;
        let activeWorkers = 0;
        let batchIdx = 0;

        function spawnNext() {
            if (batchIdx >= batches.length) {
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
                completed += results.length;
                activeWorkers--;
                spawnNext();
            });

            worker.on('error', (err) => {
                console.error('  ⚠ Worker 오류:', err.message);
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

// --- 메인 ---
async function main() {
    const args = process.argv.slice(2).filter(a => a !== '--config' && !a.endsWith('.json'));
    const videoDir = args[0];

    if (!videoDir) {
        console.error('사용법: node src/indexer.js <영상_디렉토리> [--config config.json]');
        process.exit(1);
    }

    const resolvedDir = path.resolve(videoDir);
    if (!fs.existsSync(resolvedDir)) {
        console.error(`❌ 디렉토리를 찾을 수 없습니다: ${resolvedDir}`);
        process.exit(1);
    }

    const videoFiles = findVideoFiles(resolvedDir);
    console.log(`\n🎬 발견된 영상: ${videoFiles.length}개\n`);

    if (videoFiles.length === 0) {
        console.error('❌ 영상 파일을 찾을 수 없습니다.');
        process.exit(1);
    }

    // fingerprint DB 구조
    const db = {
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

    const tempDir = path.resolve(config.paths.tempDir);
    const concurrency = config.performance.maxConcurrentVideos;

    for (let i = 0; i < videoFiles.length; i++) {
        const videoPath = videoFiles[i];
        const videoName = path.basename(videoPath);
        const progress = `[${i + 1}/${videoFiles.length}]`;

        console.log(`${progress} 처리 중: ${videoName}`);

        try {
            // 영상 길이 조회
            const duration = await getVideoDuration(videoPath);
            console.log(`  ⏱ 길이: ${(duration / 60).toFixed(1)}분`);

            // 프레임 추출
            const startExtract = Date.now();
            const framePaths = await extractFrames(videoPath, tempDir);
            const extractTime = ((Date.now() - startExtract) / 1000).toFixed(1);
            console.log(`  📸 추출된 프레임: ${framePaths.length}개 (${extractTime}s)`);

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
                .sort((a, b) => a.frameIndex - b.frameIndex);

            console.log(`  🔑 해시 계산: ${hashes.length}개 (${hashTime}s)`);

            db.videos.push({
                filename: videoName,
                frameCount: hashes.length,
                hashes
            });

            // 프레임 정리
            cleanupFrames(path.join(tempDir, path.basename(videoPath, path.extname(videoPath))));
            console.log(`  ✅ 완료\n`);

        } catch (err) {
            console.error(`  ❌ 오류: ${err.message}\n`);
        }
    }

    // DB 저장
    const dbPath = path.resolve(config.paths.fingerprintDb);
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    fs.writeFileSync(dbPath, JSON.stringify(db, null, 4), 'utf-8');

    const totalHashes = db.videos.reduce((sum, v) => sum + v.frameCount, 0);
    console.log(`\n✅ 인덱싱 완료!`);
    console.log(`   영상: ${db.videos.length}개`);
    console.log(`   총 해시: ${totalHashes.toLocaleString()}개`);
    console.log(`   DB 저장: ${dbPath}\n`);
}

main().catch(err => {
    console.error('❌ 치명적 오류:', err);
    process.exit(1);
});
