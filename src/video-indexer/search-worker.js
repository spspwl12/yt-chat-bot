/**
 * search-worker.js — 검색 워커 스레드
 * DB 해시를 청크 단위로 받아 클립 해시와 비교
 */
const { parentPort, workerData } = require('worker_threads');

// popcount 룩업 테이블
const POPCOUNT_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    POPCOUNT_LUT[i] = POPCOUNT_LUT[i >> 1] + (i & 1);
}

const { clipHashBuffers, videoChunks, threshold, hashByteLen } = workerData;

// 클립 해시를 Uint8Array로 변환
const clipBufs = clipHashBuffers.map(h => new Uint8Array(Buffer.from(h, 'hex')));

const results = [];

for (const chunk of videoChunks) {
    let bestDistance = 256;
    let bestTimestamp = 0;
    let bestFrameIdx = 0;
    let matchCount = 0;

    const hashes = chunk.hashes;
    const hashCount = hashes.length;

    for (let ci = 0; ci < clipBufs.length; ci++) {
        const clipBuf = clipBufs[ci];

        for (let di = 0; di < hashCount; di++) {
            const dbBuf = new Uint8Array(Buffer.from(hashes[di].hash, 'hex'));

            // 인라인 hamming distance (함수 호출 오버헤드 제거)
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
        results.push({
            videoIndex: chunk.videoIndex,
            bestDistance,
            bestTimestamp,
            bestFrameIdx,
            matchCount
        });
    }
}

parentPort.postMessage(results);
