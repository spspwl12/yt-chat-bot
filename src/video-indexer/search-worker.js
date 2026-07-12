/**
 * search-worker.js — 검색 워커 스레드
 * DB 해시를 청크 단위로 받아 클립 해시와 비교
 *
 * 수정 내역:
 *   - DB 해시 hex→Uint8Array 사전 변환 (매 비교마다 Buffer 생성 제거)
 *   - matchCount 중복 카운팅 버그 수정:
 *     각 클립 프레임이 이 영상에서 threshold 이하인 매칭이 1개라도 있으면 +1
 *     (같은 DB 프레임에 여러 클립 프레임이 매칭돼도 중복 카운트 안 함)
 *   - bestDistance 초기값을 hashBits+1 로 일반화 (256 하드코딩 제거)
 */
const { parentPort, workerData } = require('worker_threads');

// popcount 룩업 테이블
const POPCOUNT_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    POPCOUNT_LUT[i] = POPCOUNT_LUT[i >> 1] + (i & 1);
}

const { clipHashBuffers, videoChunks, threshold, hashByteLen, hashBits } = workerData;

// bestDistance 초기값: hashBits가 전달되면 hashBits+1, 아니면 fallback 255+1
const INITIAL_BEST = (hashBits != null ? hashBits : 255) + 1;

// 클립 해시를 Uint8Array로 사전 변환
const clipBufs = clipHashBuffers.map(h => new Uint8Array(Buffer.from(h, 'hex')));

const results = [];

for (const chunk of videoChunks) {
    let bestDistance = INITIAL_BEST;
    let bestTimestamp = 0;
    let bestFrameIdx = 0;
    // [수정] matchCount: 클립 프레임 단위로 "최소 1개 DB 프레임과 매칭됐는가" 를 카운트
    let matchCount = 0;

    const hashes = chunk.hashes;
    const hashCount = hashes.length;

    // DB 해시도 루프 전에 사전 변환 (매 비교마다 Buffer 생성 제거)
    const dbBufs = new Array(hashCount);
    for (let di = 0; di < hashCount; di++) {
        dbBufs[di] = new Uint8Array(Buffer.from(hashes[di].hash, 'hex'));
    }

    for (let ci = 0; ci < clipBufs.length; ci++) {
        const clipBuf = clipBufs[ci];
        let clipMatched = false; // 이 클립 프레임이 이 영상에서 매칭됐는가

        for (let di = 0; di < hashCount; di++) {
            const dbBuf = dbBufs[di];

            // 인라인 hamming distance (함수 호출 오버헤드 제거)
            let dist = 0;
            for (let b = 0; b < hashByteLen; b++) {
                dist += POPCOUNT_LUT[clipBuf[b] ^ dbBuf[b]];
            }

            if (dist <= threshold) {
                clipMatched = true;
                if (dist < bestDistance) {
                    bestDistance = dist;
                    bestTimestamp = hashes[di].timestamp;
                    bestFrameIdx = hashes[di].frameIndex;
                }
            }
        }

        if (clipMatched) matchCount++;
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
