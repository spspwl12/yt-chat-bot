// ─── character.js ─────────────────────────────────────────────────────────────
// 인물 대사 시간표 모듈 (video-sub.json 기반 인물 대사 타임라인 조회)
// 사용법: !인물대사 <인물이름 또는 대사>
//         예: !인물대사 달마
//             !인물대사 맨발이 모르는걸
// ─────────────────────────────────────────────────────────────────────────────

const cfg = require('../../data/config-youtube.js');
const msg = require('../../data/config-messages.js');
const { videoInfo, getFutureDate } = require('../video-matcher/search.js');
const videoSubManager = require('../sub-manager.js');
const {
    filterText,
    toUnicodeNumber,
    formatDate,
    roundUpTime,
    insertSpaces,
    isAfterStreamEnd,
    fromHHMMSS
} = require('../func.js');

const retryPattern = ["$1", "$1 ", " $1", "", ""];

// video-sub.json 기반 인물 맵 캐시
let cachedSubtitlesRef = null;
let charMap = null; // Map<cleanName, { originalName: string, episodes: Map<epKey, number[]> }>

/**
 * video-sub.json의 [[인물이름]] 패턴을 스캔하여 동적으로 인물별 회차/대사 시각(초) 맵 빌드
 */
function ensureCharacterMap() {
    const subtitles = videoSubManager.getSubtitles();
    if (charMap && cachedSubtitlesRef === subtitles) {
        return charMap;
    }

    cachedSubtitlesRef = subtitles;
    charMap = new Map();

    for (const epKey of Object.keys(subtitles)) {
        const lines = subtitles[epKey];
        if (!Array.isArray(lines)) continue;

        for (const line of lines) {
            if (!line || !line.text) continue;
            const m = line.text.match(/\[\[([^\]]+)\]\]/);
            if (!m) continue;

            const originalName = m[1].trim();
            if (!originalName) continue;

            const cleanName = originalName.toLowerCase().replace(/\s+/g, '');
            let entry = charMap.get(cleanName);
            if (!entry) {
                entry = {
                    originalName,
                    episodes: new Map(),
                    totalCount: 0
                };
                charMap.set(cleanName, entry);
            }
            entry.totalCount++;

            let times = entry.episodes.get(epKey);
            if (!times) {
                times = [];
                entry.episodes.set(epKey, times);
            }

            times.push(fromHHMMSS(line.start));
        }
    }

    return charMap;
}

/**
 * 쿼리로부터 타겟 인물 탐색:
 * 1. 인물명 완전 일치 검사
 * 2. 인물명 부분 일치 검사 (검색어가 인물 이름의 일부인 경우, 예: '인애' -> '박인애')
 * 3. 대사 검색 (textsearcher 연계 - 검색어가 인물명이 아닌 대사인 경우)
 * 4. 검색어가 인물명을 포함하는 경우 (예: '김두한이')
 */
function resolveTargetCharacter(query) {
    const map = ensureCharacterMap();
    if (!map || map.size === 0) return null;

    const cleanQuery = query.toLowerCase().replace(/\s+/g, '');

    // 1. 인물 이름과 완전 일치 (공백/대소문자 무시)
    if (map.has(cleanQuery)) {
        return { charEntry: map.get(cleanQuery), source: 'direct' };
    }

    // 2. 인물 이름 부분 일치 (인물 이름에 검색어가 포함되는 경우, 예: '인애' -> '박인애')
    if (cleanQuery.length >= 2) {
        const matches = [];
        for (const [cleanKey, entry] of map.entries()) {
            if (cleanKey.includes(cleanQuery)) {
                matches.push(entry);
            }
        }
        if (matches.length > 0) {
            // 이름 길이 짧은 순 -> 대사 수 많은 순 정렬
            matches.sort((a, b) => {
                if (a.originalName.length !== b.originalName.length) {
                    return a.originalName.length - b.originalName.length;
                }
                return b.totalCount - a.totalCount;
            });
            return { charEntry: matches[0], source: 'partial' };
        }
    }

    // 3. 대사 검색 (textsearcher 연계)
    const searchResults = videoSubManager.search(query);
    if (searchResults && searchResults.length > 0) {
        searchResults.sort((a, b) => b.score - a.score);
        const subtitles = videoSubManager.getSubtitles();
        const minScore = (cfg.subtitle_score && cfg.subtitle_score.min_value) || 30;

        for (const res of searchResults) {
            if (res.score < minScore) break;
            if (!res.matchedIndices || res.matchedIndices.length === 0) continue;

            const epLines = subtitles[res.key];
            if (!epLines) continue;

            const queryWords = query.split(/\s+/).filter(Boolean);
            let fallbackSpeaker = null;

            for (const idx of res.matchedIndices) {
                const line = epLines[idx - 1];
                if (!line || !line.text) continue;

                const m = line.text.match(/\[\[([^\]]+)\]\]/);
                if (!m) continue;

                const spkName = m[1].trim();
                const cleanSpk = spkName.toLowerCase().replace(/\s+/g, '');
                const entry = map.get(cleanSpk);
                if (!entry) continue;

                const lineBody = line.text.replace(/\[\[[^\]]+\]\]/, '');
                // 쿼리 단어가 대사 본문에 포함되어 있으면 최우선 매칭
                if (queryWords.some(w => lineBody.includes(w))) {
                    return { charEntry: entry, source: 'dialogue', score: res.score, matchedText: line.text };
                }

                if (!fallbackSpeaker) {
                    fallbackSpeaker = { charEntry: entry, source: 'dialogue', score: res.score, matchedText: line.text };
                }
            }

            if (fallbackSpeaker) {
                return fallbackSpeaker;
            }
        }
    }

    // 4. 검색어가 인물 이름을 포함하는 경우 (2글자 이상 인물명)
    if (cleanQuery.length >= 2) {
        const matches = [];
        for (const [cleanKey, entry] of map.entries()) {
            if (cleanKey.length >= 2 && cleanQuery.includes(cleanKey)) {
                matches.push(entry);
            }
        }
        if (matches.length > 0) {
            matches.sort((a, b) => b.totalCount - a.totalCount);
            return { charEntry: matches[0], source: 'query_includes_char' };
        }
    }

    return null;
}

/**
 * 인물 대사 시간표 포맷팅 (printMultiEpisodeTimetable 스타일)
 * 각 대사가 방영될 실제 시각(1분 단위 분 타임스탬프)별로 타임라인 구성
 * 같은 회차, 같은 시:분(1분 이내) 대사는 [N개]로 합산되고, 분이 다르면 개별 항목으로 출력
 */
function printCharacterTimetable(rtn, charEntry, cmd, ctx) {
    const limitLength = (cfg.timetable && cfg.timetable.default_limit) || 150;
    const currentInfo = videoInfo[rtn.index];
    const n = videoInfo.length;

    // 분(Minute) 단위 매핑: 동일 회차 & 동일 시각(분) 대사는 count 합산
    const minuteMap = new Map();

    const addDialogue = (info, sec) => {
        const fdate = roundUpTime(getFutureDate(info, rtn, sec));
        const minuteTimestamp = Math.floor(fdate.getTime() / 60000);
        const mapKey = `${info.alias}_${minuteTimestamp}`;

        const existing = minuteMap.get(mapKey);
        if (existing) {
            existing.count++;
        } else {
            minuteMap.set(mapKey, {
                alias: info.alias,
                futureDate: new Date(minuteTimestamp * 60000),
                count: 1
            });
        }
    };

    // 1. 현재 회차에서 아직 지나지 않은 대사들
    const curTimes = charEntry.episodes.get(currentInfo.name) || [];
    for (const sec of curTimes) {
        if (sec >= (rtn.now || 0)) {
            addDialogue(currentInfo, sec);
        }
    }

    // 2. 미래 회차들의 대사들
    for (let step = 1; step < n; step++) {
        const idx = (rtn.index + step) % n;
        const info = videoInfo[idx];
        if (!info || info.disable) continue;

        const times = charEntry.episodes.get(info.name);
        if (!times || times.length === 0) continue;

        for (const sec of times) {
            addDialogue(info, sec);
        }
    }

    const entries = Array.from(minuteMap.values());
    if (entries.length === 0) {
        return null;
    }

    entries.sort((a, b) => a.futureDate.getTime() - b.futureDate.getTime());

    const makeMsg = (change) => {
        const currentAlias = toUnicodeNumber(currentInfo.alias);
        let str = `[${charEntry.originalName}의 대사 시간표] ${currentAlias}화`;
        let pdate = null;

        for (const entry of entries) {
            const unicodeAlias = toUnicodeNumber(entry.alias);
            let candidate;
            if (isAfterStreamEnd(entry.futureDate)) {
                candidate = insertSpaces(`→✖)${unicodeAlias}화`, change);
            } else {
                const hdr = `${formatDate(entry.futureDate, pdate, true)})`.replace(/ /g, '');
                candidate = insertSpaces(`→${hdr}${unicodeAlias}화`, change);
                pdate = entry.futureDate;
            }
            if (str.length + candidate.length >= limitLength) break;
            str += candidate;
        }

        return str + " " + ctx.getCooldownMsg(cmd);
    };

    return {
        msg: makeMsg(retryPattern[0]),
        proc: function (attempt) {
            return makeMsg(retryPattern[attempt]);
        }
    };
}

module.exports = {
    name: 'character',
    group: 'character',
    icon: '🎭',
    aliases: ['!인물대사', '!인물', '!인물시간'],
    description: '등장인물 대사 시간표 조회 및 대사 기반 인물 대사 시간표 검색',

    web: {
        title: '인물 대사 시간표',
        icon: '🎭',
        description: 'video-sub.json 기반 등장인물 대사 시간표 조회',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, args, rtn, _input, ctx }) {
        if (!args || args.length === 0) {
            return ctx.returnWarning('⚠️ 인물 대사 명령어는 인물의 대사 시간표를 출력하는 명령어 입니다. 인물 이름 또는 대사를 입력해주세요. (예: !인물대사 달마)', cmd, _input);
        }

        const query = args.join(' ').trim();
        if (query.length > 100) {
            return ctx.returnWarning('⚠️ 검색어가 너무 깁니다. (100자 이내)', cmd, _input);
        }

        const resolved = resolveTargetCharacter(query);
        if (!resolved || !resolved.charEntry) {
            if (_input) _input.warn = (cfg.subtitle_score && cfg.subtitle_score.warn_base) || 10;
            return ctx.returnWarning(msg.error.search_not_found || '대사 또는 인물을 찾을 수 없습니다.', cmd, _input);
        }

        if (!rtn) {
            return ctx.returnWarning('⚠️ 현재 방영 정보를 확인할 수 없습니다.', cmd, _input);
        }

        ctx.setCooldown(cmd, 0, _input);
        const result = printCharacterTimetable(rtn, resolved.charEntry, cmd, ctx);

        if (!result) {
            return ctx.returnWarning(`⚠️ [${resolved.charEntry.originalName}]의 남은 방영 예정 대사가 없습니다.`, cmd, _input);
        }

        return result;
    },

    printCharacterTimetable,
    resolveTargetCharacter,
    ensureCharacterMap
};
