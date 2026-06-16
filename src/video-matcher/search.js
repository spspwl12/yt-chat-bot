const { fromHHMMSS } = require('../func.js');
const videoInfo = require('../../data/video-info.json');
const config = require('../../data/config-youtube.js');
const eventBus = require('../event-bus.js');

// --- 초기 메타데이터 전처리 및 시간 캐싱 ---
const indexMap = Object.create(null);
let totalVideoDurationSec = 0;

for (let i = 0; i < videoInfo.length; i++) {
    const e = videoInfo[i];
    if (!e.disable) {
        e._startSec = fromHHMMSS(e.start_time);
        e._endSec = fromHHMMSS(e.end_time);
        e._editSec = 0;
        e._editParsed = null;
        e._effectiveEndSec = e._endSec;
        if (e.edit_time) {
            const editArr = JSON.parse(e.edit_time);
            e._editParsed = editArr.map(et => ({
                s: fromHHMMSS(et.s),
                e: fromHHMMSS(et.e)
            }));
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
 */
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

/**
 * 스트림 시간 → 파일 위치 변환 (getEditOffset의 역함수)
 * 예: edit [0,41] → streamPos 0 → filePos 41, streamPos 1 → filePos 42
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
    if (cmp && jsonResult.matches.length > 1) {
        let adoptedMatch = null;

        // 1. 현재 회차와 일치하며, 시차가 20초 이내인 결과가 있다면 매칭율 복잡한 계산 없이 우선 즉시 채택
        for (const match of jsonResult.matches) {
            const matchIdx = indexMap[match.filename];
            if (matchIdx === cmp.index) {
                const diffNow = Math.abs(match.dbTimestamp - cmp.now);
                if (diffNow <= config.sync.segment_duration) {
                    adoptedMatch = match;
                    break;
                }
            }
        }

        if (adoptedMatch) {
            //if (adoptedMatch !== mJson) {
            //console.log(`pHash 보정: 1위 ${mJson.filename} → 시차 20초 이내 현재회차 ${adoptedMatch.filename} 즉시 채택`);
            //}
            mJson = adoptedMatch;
        } else {
            // 2. 기존 폴백: 1위가 방영 회차가 아닐 때, 현재 회차가 순위 안에 있으면(1위 매칭점수의 50% 이상) 채택
            const topMatchCount = mJson.matchCount;
            const topIdx = indexMap[mJson.filename];

            if (topIdx !== cmp.index) {
                const currentMatch = jsonResult.matches.find(m =>
                    indexMap[m.filename] === cmp.index
                );

                if (currentMatch && currentMatch.matchCount >= topMatchCount * 0.5) {
                    //console.log(`pHash 보정: 1위 ${mJson.filename}(${topMatchCount}매칭) → 현재회차 ${currentMatch.filename}(${currentMatch.matchCount}매칭) 채택`);
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
    const searchLog = { ...mJson, realTimestamp };
    eventBus.emit('search_result', searchLog);

    return getLiveVideoTime(realTimestamp, streamPhash, mJson.filename);
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

module.exports = { videoInfo, processSearchResult, getLiveVideoTime, getAdjustedVideoTime, getRemainingTime, getFutureDate, getEffectiveIndex, getEditOffset, getEpAtDate };
