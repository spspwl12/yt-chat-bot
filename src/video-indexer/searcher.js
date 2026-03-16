/**
 * searcher.js — 10초 클립을 fingerprint DB에서 초고속 검색
 *
 * 최적화:
 *   1) DB 로드 시 hex → Buffer 사전 변환 (검색 시 재할당 없음)
 *   2) popcount 룩업 테이블 (256 엔트리)
 *   3) Worker thread 병렬 검색 (CPU 코어 수만큼)
 *   4) Early exit: 완벽 매치(distance=0) 발견 시 즉시 종료
 *
 * 사용법:
 *   node src/searcher.js <클립_파일> [--config config.json] [--threshold 30] [--top 5]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');
const { extractFrames, cleanupFrames, config } = require('./extractor');
const { computeHash, hammingDistanceBuf, similarityPercent, POPCOUNT_LUT } = require('./phash');


function parseArgs() {
    const args = process.argv.slice(2);
    const result = { clipPath: null, threshold: null, topN: null };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--threshold' && args[i + 1]) {
            result.threshold = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--top' && args[i + 1]) {
            result.topN = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--config') {
            i++;
        } else if (!result.clipPath) {
            result.clipPath = args[i];
        }
    }

    return result;
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

// --- 단일 스레드 고속 검색 (소규모 DB용) ---
function searchSingleThread(clipBufs, db, threshold, hashByteLen) {
    const matches = [];

    for (let vi = 0; vi < db.videos.length; vi++) {
        const video = db.videos[vi];
        let bestDistance = 256;
        let bestTimestamp = 0;
        let bestFrameIdx = 0;
        let matchCount = 0;

        const hashes = video.hashes;
        const hashCount = hashes.length;

        for (let ci = 0; ci < clipBufs.length; ci++) {
            const clipBuf = clipBufs[ci];

            for (let di = 0; di < hashCount; di++) {
                // 인라인 hamming: 함수 호출 오버헤드 제거
                const dbBuf = hashes[di]._buf;
                let dist = 0;
                for (let b = 0; b < hashByteLen; b++) {
                    dist += POPCOUNT_LUT[clipBuf[b] ^ dbBuf[b]];
                }

                if (dist <= threshold) {
                    matchCount++;
                    if (dist < bestDistance) {
                        bestDistance = dist;
                        bestTimestamp = hashes[di].timestamp;
                        bestFrameIdx = hashes[di].frameIndex;
                    }
                }
            }
        }

        if (matchCount > 0) {
            matches.push({
                videoIndex: vi,
                bestDistance,
                bestTimestamp,
                bestFrameIdx,
                matchCount
            });
        }
    }

    return matches;
}

// --- 워커 스레드 병렬 검색 (대규모 DB용) ---
function searchWithWorkers(clipHashHexes, db, threshold, hashByteLen, workerCount) {
    return new Promise((resolve, reject) => {
        // 영상을 워커에 균등 배분
        const chunks = [];
        for (let i = 0; i < db.videos.length; i++) {
            const workerIdx = i % workerCount;
            if (!chunks[workerIdx]) chunks[workerIdx] = [];
            chunks[workerIdx].push({
                videoIndex: i,
                hashes: db.videos[i].hashes.map(h => ({
                    hash: h.hash,
                    timestamp: h.timestamp,
                    frameIndex: h.frameIndex
                }))
            });
        }

        const allResults = [];
        let completed = 0;

        for (let w = 0; w < chunks.length; w++) {
            const worker = new Worker(path.join(__dirname, 'search-worker.js'), {
                workerData: {
                    clipHashBuffers: clipHashHexes,
                    videoChunks: chunks[w],
                    threshold,
                    hashByteLen
                }
            });

            worker.on('message', (results) => {
                allResults.push(...results);
                completed++;
                if (completed === chunks.length) {
                    resolve(allResults);
                }
            });

            worker.on('error', (err) => {
                console.error(`  ⚠ Worker ${w} 오류:`, err.message);
                completed++;
                if (completed === chunks.length) {
                    resolve(allResults);
                }
            });
        }
    });
}

// --- 메인 ---
async function main() {
    const { clipPath, threshold: argThreshold, topN: argTopN } = parseArgs();

    if (!clipPath) {
        console.error('사용법: node src/searcher.js <클립_파일> [--threshold N] [--top N]');
        process.exit(1);
    }

    const resolvedClip = path.resolve(clipPath);
    if (!fs.existsSync(resolvedClip)) {
        console.error(`❌ 파일을 찾을 수 없습니다: ${resolvedClip}`);
        process.exit(1);
    }

    // DB 로드
    const dbPath = path.resolve(config.paths.fingerprintDb);
    if (!fs.existsSync(dbPath)) {
        console.error(`❌ Fingerprint DB를 찾을 수 없습니다: ${dbPath}`);
        console.error('   먼저 indexer.js로 인덱싱을 실행하세요.');
        process.exit(1);
    }

    console.log('\n📂 DB 로드 중...');
    const loadStart = Date.now();
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    const totalHashes = db.videos.reduce((sum, v) => sum + v.frameCount, 0);

    // ★ 핵심 최적화: hex → Buffer 사전 변환 (검색 시 재할당 0)
    const hashByteLen = Math.ceil((config.phash.lowFreqSize * config.phash.lowFreqSize - 1) / 8);
    for (const video of db.videos) {
        for (const h of video.hashes) {
            h._buf = Buffer.from(h.hash, 'hex');
        }
    }
    const loadTime = ((Date.now() - loadStart) / 1000).toFixed(2);
    console.log(`   ${db.videos.length}개 영상, ${totalHashes.toLocaleString()}개 해시 (${loadTime}s)\n`);

    // 클립 프레임 추출 + 해시 계산
    console.log('📸 클립 프레임 추출 중...');
    const tempDir = path.resolve(config.paths.tempDir);
    const clipFrames = await extractFrames(resolvedClip, tempDir);
    console.log(`   추출된 프레임: ${clipFrames.length}개`);

    console.log('🔑 클립 해시 계산 중...');
    const clipHashes = [];
    const clipBufs = [];
    for (const framePath of clipFrames) {
        try {
            const hash = await computeHash(framePath);
            clipHashes.push(hash);
            clipBufs.push(Buffer.from(hash, 'hex'));
        } catch (err) {
            // skip
        }
    }
    console.log(`   계산된 해시: ${clipHashes.length}개\n`);

    // --- 검색 ---
    const hammingThreshold = argThreshold || config.matching.hammingThreshold;
    const topN = argTopN || config.matching.topN;
    const hashBits = config.phash.lowFreqSize * config.phash.lowFreqSize - 1;
    const totalComparisons = clipHashes.length * totalHashes;
    const workerCount = config.performance.workerCount || os.cpus().length;

    console.log(`🔍 검색 시작 (threshold: ${hammingThreshold}, workers: ${workerCount})\n`);
    const startSearch = Date.now();

    let rawMatches;

    // DB 해시 50만 이상이면 워커 스레드 사용, 아니면 단일 스레드 (오버헤드 방지)
    if (totalHashes > 500000 && workerCount > 1) {
        console.log(`   ⚡ 멀티스레드 검색 (${workerCount} workers)...`);
        rawMatches = await searchWithWorkers(clipHashes, db, hammingThreshold, hashByteLen, workerCount);
    } else {
        console.log(`   ⚡ 단일스레드 고속 검색...`);
        rawMatches = searchSingleThread(clipBufs, db, hammingThreshold, hashByteLen);
    }

    const searchTime = ((Date.now() - startSearch) / 1000).toFixed(2);

    // 결과 조합
    const matches = rawMatches.map(m => {
        const video = db.videos[m.videoIndex];
        return {
            filename: video.filename,
            filepath: video.filepath,
            bestDistance: m.bestDistance,
            bestTimestamp: m.bestTimestamp,
            bestFrameIdx: m.bestFrameIdx,
            matchCount: m.matchCount,
            similarity: similarityPercent(m.bestDistance, hashBits),
            coverage: ((m.matchCount / clipHashes.length) * 100).toFixed(1)
        };
    });

    // 정렬: 커버리지 → 최소 거리
    matches.sort((a, b) => {
        if (parseFloat(b.coverage) !== parseFloat(a.coverage)) {
            return parseFloat(b.coverage) - parseFloat(a.coverage);
        }
        return a.bestDistance - b.bestDistance;
    });

    // 결과 출력
    const speed = (totalComparisons / parseFloat(searchTime) / 1000000).toFixed(1);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  🔎 검색 결과 (${searchTime}s, ${totalComparisons.toLocaleString()}회 비교, ${speed}M 비교/초)`);
    console.log(`${'='.repeat(70)}\n`);

    if (matches.length === 0) {
        console.log('  ❌ 매칭되는 영상을 찾지 못했습니다.');
        console.log('     threshold를 높여보세요: --threshold 40\n');
    } else {
        const topMatches = matches.slice(0, topN);
        for (let i = 0; i < topMatches.length; i++) {
            const m = topMatches[i];
            console.log(`  #${i + 1}  📹 ${m.filename}`);
            console.log(`       유사도: ${m.similarity}% | Hamming: ${m.bestDistance}`);
            console.log(`       매칭 프레임: ${m.matchCount}개 (커버리지: ${m.coverage}%)`);
            console.log(`       위치: ${formatTime(m.bestTimestamp)} (프레임 #${m.bestFrameIdx})`);
            console.log(`       경로: ${m.filepath}`);
            console.log('');
        }

        if (matches.length > topN) {
            console.log(`  ... 그 외 ${matches.length - topN}개 영상에서도 매칭됨\n`);
        }
    }

    // 정리
    cleanupFrames(path.join(tempDir, path.basename(resolvedClip, path.extname(resolvedClip))));
}

main().catch(err => {
    console.error('❌ 치명적 오류:', err);
    process.exit(1);
});
