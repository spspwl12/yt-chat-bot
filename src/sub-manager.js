const fs = require('fs');
const path = require('path');
const TextSearchEngine = require('./textsearcher.js');
const configManager = require('./config-manager.js');
const { cfg } = configManager;
const search_lib = require('./video-matcher/search.js');
const { fromHHMMSS, roundUpTime, formatDate, getClockEmoji, toUnicodeNumber } = require('./func.js');

const VIDEO_SUB_PATH = configManager.PATHS.videoSub;

let subtitles = {};
let searcher = null;

function load() {
    try {
        const raw = fs.readFileSync(VIDEO_SUB_PATH, 'utf8').replace(/^\uFEFF/, '').trim();
        subtitles = JSON.parse(raw);
        searcher = new TextSearchEngine(subtitles);
        return true;
    } catch (e) {
        console.warn('⚠️ [경고] video-sub.json 로드 실패 - 대사 검색 기능 제한됨');
        subtitles = {};
        searcher = new TextSearchEngine(subtitles);
        return false;
    }
}

// 최초 로드
load();

function reloadVideoSub() {
    try {
        const raw = fs.readFileSync(VIDEO_SUB_PATH, 'utf8').replace(/^\uFEFF/, '').trim();
        subtitles = JSON.parse(raw);
        searcher = new TextSearchEngine(subtitles);
        console.log(`[video-sub-manager] video-sub.json 리로드 완료`);
        return true;
    } catch (e) {
        console.error('[video-sub-manager] video-sub.json 리로드 실패:', e.message);
        return false;
    }
}

function searchAndFormat(query, rtn) {
    const searchInfo = searcher.search(query);
    if (!searchInfo || searchInfo.length === 0) return { validResults: [], searchInfo: [] };

    searchInfo.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const zeroA = a.matchedIndices?.includes(1);
        const zeroB = b.matchedIndices?.includes(1);
        if (zeroA !== zeroB) return zeroA ? -1 : 1;

        const lenA = a.matchedIndices ? a.matchedIndices.length : 0;
        const lenB = b.matchedIndices ? b.matchedIndices.length : 0;
        if (lenB !== lenA) return lenB - lenA;
        if (b.alpha !== a.alpha) return b.alpha - a.alpha;
        return a.key.localeCompare(b.key, undefined, { numeric: true });
    });

    const validResults = [];
    const removeDup = searchInfo.filter(
        (item, index, self) => index === self.findIndex(obj => obj.key === item.key)
    );

    const videoInfo = search_lib.videoInfo;

    for (const result of removeDup) {
        if (validResults.length >= 3) break;

        const matched = result.matchedIndices;
        if (!matched || matched.length === 0) continue;

        const score = result.score;
        if (score > cfg.subtitle_score.min_value) {
            const key = result.key;
            const pfSub = subtitles[key] ? subtitles[key][matched[0] - 1] : undefined;

            if (pfSub) {
                const subInfo = videoInfo.find(e => e.name === key);
                if (!subInfo) continue;

                const subSt = fromHHMMSS(pfSub.start);
                const subEd = fromHHMMSS(pfSub.end);
                const futureDate = roundUpTime(search_lib.getFutureDate(subInfo, rtn, subSt));

                let outOfbounds = subInfo.disable;
                if (!outOfbounds && subInfo._editParsed) {
                    for (const et of subInfo._editParsed) {
                        if (subSt && subSt >= et.s && subSt <= et.e) {
                            outOfbounds = true;
                            break;
                        }
                    }
                }

                const unicodenum = toUnicodeNumber(subInfo.alias);
                const unicodescore = toUnicodeNumber(score);
                const timestr = formatDate(futureDate);
                const emoji = getClockEmoji(timestr);

                validResults.push({
                    subInfo, outOfbounds, unicodenum, unicodescore, timestr, emoji, score, key, subSt, subEd
                });
            }
        }
    }

    return { validResults, searchInfo };
}

module.exports = {
    reloadVideoSub,
    search: (query) => searcher.search(query),
    searchAndFormat,
    getSubtitles: () => subtitles,
    hasSubtitles: () => Object.keys(subtitles).length > 0
};
