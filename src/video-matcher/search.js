const util = require('util');
const fs = require('fs');
const { fromHHMMSS } = require('../func.js');
const { execFile } = require('child_process');
const execFilePromise = util.promisify(execFile);
const videoInfo = require('../data/video-info.json');
const config = require('../data/config-search.js');
const path = require("path");

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

async function downloadVideo(url, outputPath, durationSeconds = 20) {
    const da = { st: null, ed: null, size: 0 };

    try {
        const folderPath = path.dirname(outputPath);
        const outputFilename = path.basename(outputPath);

        const watcher = fs.watch(folderPath, (eventType, filename) => {
            if (filename.includes(outputFilename)) {
                da.st = Date.now();
                watcher.close();
            }
        });

        const { stdout } = await execFilePromise(config.ytdlp.path, [
            "-f", "best[height<=1080]",
            "--merge-output-format", "mp4",
            "-o", outputPath,
            "--external-downloader", config.ffmpeg.ffmpegPath,
            "--external-downloader-args", `ffmpeg:-t ${durationSeconds}`,
            url
        ]);

        da.ed = Date.now();
        watcher.close();

        if (!stdout)
            return null;

        const stats = fs.statSync(outputPath);
        da.size = stats;

        return da;
    } catch (e) {
        console.error(e)
        return da;
    }
}

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

async function getVideoDuration(filePath) {
    try {
        const { stdout } = await execFilePromise(config.ffmpeg.ffprobePath, [
            '-v', 'error',
            '-count_frames', '-select_streams', 'v:0',
            '-show_entries', 'stream=nb_read_frames,r_frame_rate',
            '-of', 'default=noprint_wrappers=1', filePath
        ]);

        const lines = stdout.trim().split("\n");
        let nbFrames = 0, frameRate = 0;

        for (const line of lines) {
            if (line.startsWith("nb_read_frames")) {
                nbFrames = parseInt(line.split("=")[1], 10);
            } else if (line.startsWith("r_frame_rate")) {
                const [num, den] = line.split("=")[1].trim().split("/").map(Number);
                if (den !== 0) frameRate = num / den;
            }
        }

        return (nbFrames > 0 && frameRate > 0) ? nbFrames / frameRate : 0;
    } catch {
        return 0;
    }
}

/**
 * 내부적으로 스트림 시간 기반으로 동작.
 * phashTime은 스트림 시간 (getTimeAsync에서 변환, 또는 lastQuery에서 재사용)
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
        requestTime: requestTime
    };
}

function floorToDecimal(num, digits) {
    const factor = Math.pow(10, digits);
    return Math.floor(num * factor) / factor;
}

let loading = false;

async function getTimeAsync(youtube_url) {
    if (loading) return null;
    loading = true;

    try {
        const deleteMP4 = async function () {
            await fs.promises.unlink(config.searcher.livemp4_path).catch(console.error);
        };

        const streamTime = await downloadVideo(
            youtube_url,
            config.searcher.livemp4_path,
            20
        );

        if (streamTime.size < 1024) {
            await deleteMP4();
            return null;
        }

        const downloadTime = floorToDecimal((streamTime.ed - streamTime.st) / 1000, 5);
        if (downloadTime < 1) {
            await deleteMP4();
            return null;
        }

        console.log("비디오 다운로드 완료.");

        const videoTime = floorToDecimal(
            await getVideoDuration(config.searcher.livemp4_path),
            5
        );

        if (videoTime < downloadTime) {
            await deleteMP4();
            console.error("다운로드타임이 비디오타임보다 깁니다.");
            return null;
        }

        // C++ 검색기가 config.json을 필요로 하므로, config 객체를 json으로 변환하여 저장
        const targetConfigPath = config.searcher.commandLine
            .find(arg => arg.endsWith('.json') && arg.includes('config'));

        if (targetConfigPath)
            await fs.promises.writeFile(targetConfigPath, JSON.stringify(config), 'utf8');

        const out = await execFilePromise(
            config.searcher.path,
            config.searcher.commandLine,
            { encoding: "utf8" }
        );

        if (targetConfigPath)
            await fs.promises.unlink(targetConfigPath).catch(console.error);

        await deleteMP4();

        if (!out.stdout) return null;

        const json = JSON.parse(out.stdout);
        if (json.error || !json.matches?.length) return null;

        const mJson = json.matches[0];
        if (videoTime < mJson.clipTimestamp) {
            console.error("매칭된 클립 위치가 비디오 길이보다 깁니다.");
            return null;
        }

        const realTimestamp =
            streamTime.st +
            mJson.clipTimestamp * 1000;

        delete mJson.filepath;

        console.log(JSON.stringify({ ...mJson, videoTime, downloadTime, realTimestamp }));

        // C++ 검색기의 dbTimestamp(파일 위치) → 스트림 시간으로 변환
        const matchIdx = indexMap[mJson.filename];
        const matchedEp = matchIdx !== undefined ? videoInfo[matchIdx] : null;
        const streamPhash = matchedEp
            ? mJson.dbTimestamp - getEditOffset(matchedEp._editParsed, mJson.dbTimestamp)
            : mJson.dbTimestamp;

        return getLiveVideoTime(realTimestamp, streamPhash, mJson.filename);
    } catch (err) {
        console.error(err);
        return null;
    } finally {
        loading = false;
    }
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

module.exports = { videoInfo, getTimeAsync, getLiveVideoTime, getAdjustedVideoTime, getRemainingTime, getFutureDate, getEffectiveIndex };
