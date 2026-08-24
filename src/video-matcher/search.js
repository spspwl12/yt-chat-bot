const { fromHHMMSS } = require('../func.js');
const path = require('path');
const fs = require('fs');
const configManager = require('../config-manager.js');
const { cfg, schCfg } = configManager;
const eventBus = require('../event-bus.js');

const VIDEO_INFO_PATH = configManager.PATHS.videoInfo;


// --- 초기 메타데이터 전처리 및 시간 캐싱 ---
const indexMap = Object.create(null);
let totalVideoDurationSec = 0;
let videoInfo = [];

function getEditOffset(editParsed, localPos) {
    if (!editParsed) return 0;
    let offset = 0;
    for (const et of editParsed) {
        if (localPos >= et.e) {
            offset += (et.e - et.s);
        } else if (localPos > et.s) {
            offset += (localPos - et.s);
        }
    }
    return offset;
}

function preprocessVideoInfo(data) {
    // indexMap 초기화
    for (const key of Object.keys(indexMap)) delete indexMap[key];
    totalVideoDurationSec = 0;

    // videoInfo 배열 in-place 교체
    videoInfo.length = 0;
    for (const item of data) videoInfo.push(item);

    for (let i = 0; i < videoInfo.length; i++) {
        const e = videoInfo[i];
        if (!e.disable) {
            e._startSec = fromHHMMSS(e.start_time);
            e._endSec = fromHHMMSS(e.end_time);
            e._editSec = 0;
            e._editParsed = null;
            e._effectiveEndSec = e._endSec;
            if (e.edit_time) {
                try {
                    const editArr = typeof e.edit_time === 'string' ? JSON.parse(e.edit_time) : e.edit_time;
                    if (Array.isArray(editArr)) {
                        e._editParsed = editArr.map(et => ({
                            s: fromHHMMSS(et.s),
                            e: fromHHMMSS(et.e)
                        }));
                    }
                } catch {
                    e._editParsed = null;
                }
                for (const et of e._editParsed) {
                    e._editSec += (et.e - et.s);
                }
                // edit_time 끝이 영상 끝에 닿으면 콘텐츠는 edit 시작점에서 종료
                // 연속된 편집 구간이 이어지면 역추적하여 실제 콘텐츠 종료 시점 산출
                for (const et of e._editParsed) {
                    if (et.e >= e._endSec) {
                        e._effectiveEndSec = et.s;
                    }
                }
                if (e._effectiveEndSec < e._endSec) {
                    let changed = true;
                    while (changed) {
                        changed = false;
                        for (const et of e._editParsed) {
                            if (et.e >= e._effectiveEndSec && et.s < e._effectiveEndSec) {
                                e._effectiveEndSec = et.s;
                                changed = true;
                            }
                        }
                    }
                }
            }
            e._durationSec = e._endSec - e._editSec;
            // _streamDurationSec: _effectiveEndSec 범위 내에서 편집 구간을 제외한 실제 스트리밍 재생 시간
            e._streamDurationSec = e._effectiveEndSec - getEditOffset(e._editParsed, e._effectiveEndSec);
            totalVideoDurationSec += e._streamDurationSec;
        } else {
            e._startSec = 0;
            e._endSec = 0;
            e._editSec = 0;
            e._editParsed = null;
            e._durationSec = 0;
            e._effectiveEndSec = 0;
            e._streamDurationSec = 0;
        }
        indexMap[e.name] = i;
    }
}

function reloadVideoInfo() {
    try {
        const raw = fs.readFileSync(VIDEO_INFO_PATH, 'utf8').replace(/^\uFEFF/, '').trim();
        const data = JSON.parse(raw);
        preprocessVideoInfo(data);
        console.log(`[search] video-info.json 리로드 완료 (${data.length}개 항목)`);
        return true;
    } catch (e) {
        console.error('[search] video-info.json 리로드 실패:', e.message);
        return false;
    }
}

// 최초 로드
reloadVideoInfo();
// ---------------------------------------------



/**
 * 스트림 시간 기준으로 에피소드 인덱스와 스트림 remaining 반환
 * _streamDurationSec 사용 → 편집 구간에 시간 할당 안 함
 */
function findLandingIndex(index, targetSec) {
    if (index === -1)
        return videoInfo.length - 1;

    const n = videoInfo.length;

    if (totalVideoDurationSec > 0 && targetSec >= totalVideoDurationSec) {
        targetSec = targetSec % totalVideoDurationSec;
    }

    let sum = 0;
    while (true) {
        if (index >= n)
            index = 0;
        const e = videoInfo[index];
        if (!e.disable) {
            const duration = e._streamDurationSec;
            if (targetSec <= sum + duration) {
                return { index, remaining: targetSec - sum };
            }
            sum += duration;
        }
        index++;
    }
}

/**
 * 에피소드 간 실제 스트리밍 재생 시간 합산
 */
function calcDuration(currentIdx, targetIdx) {
    const n = videoInfo.length;
    if (currentIdx === -1 || targetIdx === -1 || targetIdx >= n)
        return 0;

    let sum = 0;
    while (true) {
        if (currentIdx >= n)
            currentIdx = 0;
        if (currentIdx === targetIdx)
            return sum;

        const e = videoInfo[currentIdx];
        if (!e.disable) {
            sum += e._streamDurationSec;
        }
        currentIdx++;
    }
}

function getRemainingTime(name, currentIdx) {
    const targetIdx = indexMap[name] !== undefined ? indexMap[name] : -1;
    return calcDuration(currentIdx, targetIdx);
}

/**
 * 파일 위치 → 그 위치까지 편집(컷)된 총 시간(초) 반환
 * 스트림 시간 → 파일 위치 변환(getEditOffset의 역함수)
    * 예: edit[0, 41] → streamPos 0 → filePos 41, streamPos 1 → filePos 42
*/

function streamToFilePos(editParsed, streamPos) {
    if (!editParsed) return streamPos;
    let filePos = streamPos;
    for (const et of editParsed) {
        if (filePos >= et.s) {
            filePos += (et.e - et.s);
        }
    }
    return filePos;
}

function getFutureDate(info, rtn, time) {
    const addTime = getRemainingTime(info.name, rtn.index);
    // time은 대상 에피소드의 로컬 파일 위치 → 스트림 위치로 보정
    const adjustedTime = time - getEditOffset(info._editParsed, time);
    // rtn.now는 파일 위치이므로 constTime 계산 시 스트림 시간으로 변환
    const ep = videoInfo[rtn.index];
    const streamNow = rtn.now - getEditOffset(ep._editParsed, rtn.now);
    const constTime = parseInt(Date.now() / 1000) - streamNow;
    const futureDate = new Date((constTime + addTime + adjustedTime) * 1000);
    return futureDate;
}

/**
 * 특정 날짜/시간(Date 객체)에 재생될 것으로 예상되는 에피소드 정보 및 스트림 재생 위치 반환
 */
function getEpAtDate(targetDate, rtn) {
    const ep = videoInfo[rtn.index];
    const streamNow = rtn.now - getEditOffset(ep._editParsed, rtn.now);

    let diffSec = targetDate.getTime() / 1000 - Date.now() / 1000;
    let remainStreamTime = ep._streamDurationSec - streamNow;

    let targetIdx = rtn.index;
    let targetStreamPos = streamNow + diffSec;

    if (diffSec >= remainStreamTime) {
        diffSec -= remainStreamTime;
        if (totalVideoDurationSec > 0) diffSec %= totalVideoDurationSec;

        targetIdx = (rtn.index + 1) % videoInfo.length;
        while (true) {
            let nextEp = videoInfo[targetIdx];
            if (!nextEp.disable) {
                if (diffSec < nextEp._streamDurationSec) {
                    targetStreamPos = diffSec;
                    break;
                }
                diffSec -= nextEp._streamDurationSec;
            }
            targetIdx = (targetIdx + 1) % videoInfo.length;
        }
    } else if (diffSec < 0) {
        let absDiff = -diffSec;
        if (absDiff <= streamNow) {
            targetStreamPos = streamNow - absDiff;
        } else {
            absDiff -= streamNow;
            if (totalVideoDurationSec > 0) absDiff %= totalVideoDurationSec;

            targetIdx = (rtn.index - 1 + videoInfo.length) % videoInfo.length;
            while (true) {
                let prevEp = videoInfo[targetIdx];
                if (!prevEp.disable) {
                    if (absDiff <= prevEp._streamDurationSec) {
                        targetStreamPos = prevEp._streamDurationSec - absDiff;
                        break;
                    }
                    absDiff -= prevEp._streamDurationSec;
                }
                targetIdx = (targetIdx - 1 + videoInfo.length) % videoInfo.length;
            }
        }
    }

    return {
        idx: targetIdx,
        info: videoInfo[targetIdx],
        streamPos: targetStreamPos
    };
}


/**
 * 내부적으로 스트림 시간 기반으로 동작.
 * phashTime은 스트림 시간 (lastQuery에서 재사용)
 * 반환값의 now도 스트림 시간 (lastQuery 저장용)
 */
function getLiveVideoTime(requestTime, phashTime, nowIdx) {
    const oIdx = typeof nowIdx === "string" ? (indexMap[nowIdx] !== undefined ? indexMap[nowIdx] : -1) : nowIdx;
    if (oIdx === -1)
        return null;

    const plus = parseInt((Date.now() - requestTime) / 1000);
    let calcTime = phashTime + plus;

    if (calcTime < -60)
        return null;
    else if (calcTime < -10)
        calcTime = 0;

    // 스트림 시간 기준 탐색
    const { index, remaining } = findLandingIndex(oIdx, calcTime);
    const spent = videoInfo[index];

    const now = oIdx == index ? calcTime : remaining;

    return {
        index: index,
        now: now,
        start: spent._startSec,
        end: spent._streamDurationSec,
        requestTime: Date.now()
    };
}


/**
 * 데몬 모드 searcher.exe 결과를 처리하여 현재 방영 정보 산출
 * live-searcher.js에서 받은 JSON 결과와 세그먼트 타이밍을 조합.
 *
 * @param {object} jsonResult - searcher.exe stdout JSON 파싱 결과
 * @param {object} segmentInfo - { path, st, ed, size, segmentId }
 * @param {object} cmp - 현재 방영 중인 회차와 시간 정보 객체 (getEpisodeInfo 반환값)
 * @returns {object|null} getLiveVideoTime 결과
 */
function processSearchResult(jsonResult, segmentInfo, cmp) {
    if (!jsonResult || jsonResult.error || !jsonResult.matches || !jsonResult.matches.length)
        return null;

    let mJson = jsonResult.matches[0];

    // ── 현재 회차 및 현재 시간 우선 채택 로직 ──
    if (cmp) {
        let adoptedMatch = null;

        // 1. 현재 회차와 일치하며, 시차가 segment_duration 범위 내인 결과가 있다면 매칭율 복잡한 계산 없이 우선 즉시 채택
        for (const match of jsonResult.matches) {
            const matchIdx = indexMap[match.filename];

            if (matchIdx !== cmp.index) {
                // 회차가 다른 경우 → EPISODE_MISMATCH violation
                eventBus.emit('segment_violation', {
                    filename: match.filename,
                    dbTimestamp: match.dbTimestamp,
                    cmpNow: cmp.now,
                    diffNow: null,
                    matchCount: match.matchCount,
                    reason: 'EPISODE_MISMATCH',
                    cmpIndex: cmp.index,
                    matchIndex: matchIdx
                });
                continue;
            }

            const diffNow = Math.abs(match.dbTimestamp - cmp.now);
            if (diffNow >= (schCfg.sync && schCfg.sync.segment_duration_min || 4) && diffNow <= (schCfg.sync && schCfg.sync.segment_duration_max || 20)) {
                adoptedMatch = match;
                break;
            } else {
                const reason = diffNow < (schCfg.sync && schCfg.sync.segment_duration_min || 4)
                    ? 'MIN_VIOLATION'
                    : 'MAX_VIOLATION';

                eventBus.emit('segment_violation', {
                    filename: match.filename,
                    dbTimestamp: match.dbTimestamp,
                    cmpNow: cmp.now,
                    diffNow: diffNow,
                    matchCount: match.matchCount,
                    reason: reason
                });
            }
        }

        if (adoptedMatch) {
            mJson = adoptedMatch;
        } else if (jsonResult.matches.length > 1) {
            // 2. 기존 폴백: 1위가 방영 회차가 아닐 때, 현재 회차가 순위 안에 있으면(1위 매칭점수의 50% 이상) 채택
            const topMatchCount = mJson.matchCount;
            const topIdx = indexMap[mJson.filename];

            if (topIdx !== cmp.index) {
                const currentMatch = jsonResult.matches.find(m =>
                    indexMap[m.filename] === cmp.index
                );

                if (currentMatch && currentMatch.matchCount >= topMatchCount * 0.5) {
                    mJson = currentMatch;
                }
            }
        }
    }


    // realTimestamp: 파일 쓰기 시작 시점 + 클립 내 매칭 프레임 위치
    const realTimestamp = segmentInfo.st + mJson.clipTimestamp * 1000;

    // C++ 검색기의 dbTimestamp(파일 위치) → 스트림 시간으로 변환
    const matchIdx = indexMap[mJson.filename];
    const matchedEp = matchIdx !== undefined ? videoInfo[matchIdx] : null;
    const streamPhash = matchedEp
        ? mJson.dbTimestamp - getEditOffset(matchedEp._editParsed, mJson.dbTimestamp)
        : mJson.dbTimestamp;

    delete mJson.filepath;
    const liveTime = getLiveVideoTime(realTimestamp, streamPhash, mJson.filename);
    const searchLog = {
        ...mJson,
        realTimestamp,
        now: liveTime ? liveTime.now : null
    };
    eventBus.emit('search_result', searchLog);

    return liveTime;
}

/**
 * 스트림 위치가 에피소드 끝에 도달하면 다음 활성 에피소드 인덱스 반환
 */
function getEffectiveIndex(rtn) {
    if (!rtn) return -1;

    const ep = videoInfo[rtn.index];
    if (rtn.now >= ep._streamDurationSec) {
        const n = videoInfo.length;
        let nextIdx = (rtn.index + 1) % n;
        for (let i = 0; i < n; i++) {
            if (!videoInfo[nextIdx].disable) return nextIdx;
            nextIdx = (nextIdx + 1) % n;
        }
    }

    return rtn.index;
}

/**
 * commands.js용 최종 출력.
 * 내부 스트림 시간 → 파일 위치(now)와 _effectiveEndSec(end)로 변환하여 반환.
 * now는 streamToFilePos로 변환 → edit [0,41]이면 now는 41, 42, 43... 으로 흐름
 * end - now = 실제 남은 파일 시간 (편집 구간 제외)
 */
function getAdjustedVideoTime(requestTime, phashTime, nowIdx) {
    const rtn = getLiveVideoTime(requestTime, phashTime, nowIdx);
    if (!rtn) return null;

    const eIdx = getEffectiveIndex(rtn);
    if (eIdx !== rtn.index) {
        const ep = videoInfo[eIdx];
        rtn.index = eIdx;
        rtn.now = streamToFilePos(ep._editParsed, 0);
        rtn.start = ep._startSec;
        rtn.end = ep._effectiveEndSec;
    } else {
        const ep = videoInfo[rtn.index];
        rtn.now = streamToFilePos(ep._editParsed, rtn.now);
        rtn.end = ep._effectiveEndSec;
    }

    return rtn;
}

// ─── 라이브 싱크 상태 관리 (동기화 쿼리 및 현재 에피소드 계산) ─────────────
const lastQueryRelPath = (schCfg.searcher && schCfg.searcher.lastquery_path) || 'data/lastquery.json';
const LASTQUERY_PATH = path.resolve(__dirname, '../', lastQueryRelPath);
let lastQuery = { index: 0, now: 0, requestTime: 0, retry: 0 };
try {
    if (fs.existsSync(LASTQUERY_PATH)) {
        lastQuery = require(LASTQUERY_PATH);
    } else {
        fs.writeFileSync(LASTQUERY_PATH, JSON.stringify(lastQuery, null, 4), 'utf-8');
    }
} catch (e) {
    console.warn('⚠️ [search] lastquery.json 로드 실패, 기본값 사용:', e.message);
}
const tempQuery = [];

/**
 * C++ 서치 엔진에서 검색된 현재 라이브 영상 싱크 데이터를
 * 파일과 메모리(lastQuery)에 저장하여 상태를 동기화합니다.
 */
function copyQuery(obj) {
    if (!obj) return;
    ['index', 'now', 'requestTime'].forEach(key => {
        if (obj[key] !== undefined) lastQuery[key] = obj[key];
    });
    tempQuery.length = 0;
    try {
        const json = JSON.stringify(lastQuery, null, 4);
        fs.writeFileSync(LASTQUERY_PATH, json, 'utf-8');
    } catch (e) {
        console.warn('⚠️ [search] lastquery.json 저장 실패:', e.message);
    }
    eventBus.emit('lastquery_update', {
        index: lastQuery.index,
        now: lastQuery.now,
        requestTime: lastQuery.requestTime,
        retry: lastQuery.retry
    });
}

/**
 * 최신 동기화된 데이터를 바탕으로 현재 방송 중인 회차와 시점(초)을 계산해 반환
 * @returns {object|null}
 */
function getEpisodeInfo() {
    if (!lastQuery.requestTime) return null;
    return getAdjustedVideoTime(lastQuery.requestTime, lastQuery.now, lastQuery.index);
}

/**
 * LiveSearcher 'match' 이벤트 핸들러: 연속성 검증 후 확정 시 싱크 저장
 */
function onMatchResult(rtn) {
    if (!rtn) return;

    const tolerance = (schCfg.sync && schCfg.sync.tolerance_sec) || 60;

    if (tempQuery.length > 0) {
        const last = tempQuery[tempQuery.length - 1];
        if (rtn.index !== last.index || Math.abs(rtn.now - last.now) > tolerance) {
            tempQuery.length = 0;
        }
    }

    tempQuery.push(rtn);
    const minConsecutive = (schCfg.sync && schCfg.sync.min_consecutive) || 4;

    if (tempQuery.length >= minConsecutive) {
        copyQuery(rtn);
        return;
    }

    const cmp = getEpisodeInfo();
    if (cmp && rtn.index === cmp.index && Math.abs(rtn.now - cmp.now) <= tolerance) {
        copyQuery(rtn);
    }
}

module.exports = {
    videoInfo,
    processSearchResult,
    getLiveVideoTime,
    getAdjustedVideoTime,
    getRemainingTime,
    getFutureDate,
    getEffectiveIndex,
    getEditOffset,
    getEpAtDate,
    reloadVideoInfo,
    lastQuery,
    copyQuery,
    getEpisodeInfo,
    onMatchResult
};

