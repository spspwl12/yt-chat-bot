/**
 * worker.js — 워커 스레드에서 pHash 배치 계산
 */
const { parentPort, workerData } = require('worker_threads');
const { computeHash } = require('./phash');

(async () => {
    const { framePaths } = workerData;
    const results = [];

    for (const framePath of framePaths) {
        try {
            const hash = await computeHash(framePath);
            results.push({ path: framePath, hash });
        } catch (err) {
            results.push({ path: framePath, hash: null, error: err.message });
        }
    }

    parentPort.postMessage(results);
})();
