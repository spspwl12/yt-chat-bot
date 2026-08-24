const cfg = require('../../data/config-youtube.js');
const msg = require('../../data/config-messages.js');
const { videoInfo, getFutureDate } = require('../video-matcher/search.js');
const videoSubManager = require('../sub-manager.js');
const { searchEpisodeByAI } = require('../ai.js');
const { sendChat } = require('../innertube.js');
const { filterText, hasProfanity, toUnicodeNumber, toUnicodeNumber2, formatDate, roundUpTime, insertSpaces } = require('../func.js');
const { printNowEpisode, printNumEpisode } = require('./future.js');

const retryPattern = ["$1", "$1 ", " $1", "", ""];

function printMultiEpisodeTimetable(rtn, episodeNums, cmd, ctx) {
    const limitLength = cfg.timetable.default_limit;
    const currentInfo = videoInfo[rtn.index];

    let totalCycleMs = 0;
    for (const ep of videoInfo) {
        if (!ep.disable) totalCycleMs += (ep._streamDurationSec || ep._durationSec || 0);
    }
    totalCycleMs *= 1000;

    const seenCount = {};
    const entries = [];
    for (const num of episodeNums) {
        const info = videoInfo.find(e => e.alias == num);
        if (!info) continue;

        seenCount[num] = (seenCount[num] || 0);
        const cycleOffset = seenCount[num];
        seenCount[num]++;

        const baseFutureDate = roundUpTime(getFutureDate(info, rtn, 0));
        const futureDate = new Date(baseFutureDate.getTime() + cycleOffset * totalCycleMs);

        entries.push({
            alias: info.alias,
            futureDate: futureDate,
        });
    }

    if (entries.length === 0) return null;
    entries.sort((a, b) => a.futureDate.getTime() - b.futureDate.getTime());

    const makeMsg = (change) => {
        const currentAlias = toUnicodeNumber(currentInfo.alias);
        let str = `${currentAlias}화`;
        let pdate = null;

        for (const entry of entries) {
            const hdr = `${formatDate(entry.futureDate, pdate, true)})`.replace(/ /g, '');
            const unicodeAlias = toUnicodeNumber(entry.alias);
            const candidate = insertSpaces(`→${hdr}${unicodeAlias}화`, change);
            if (str.length + candidate.length >= limitLength) break;
            str += candidate;
            pdate = entry.futureDate;
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
    name: 'episode',
    group: 'episode',
    aliases: ['!대사', '!몇회', '!몇화', '!몆화', '!몆회', '!몇편', '!편수', '!화차', '!현재회차', '!현재몇편', '!현재몇화', '!지금몇화', '!지금몇회', '!지금몇편', '!지금회차', '!회차', '!ㅁㅎ'],
    description: '현재 회차, 에피소드 예정 시간, 다중 회차 및 대사 검색',

    async execute({ cmd, args, rtn, _input, ctx }) {
        if (!args || args.length <= 0) {
            ctx.setCooldown(cmd, 0, _input);
            return printNowEpisode(rtn, cmd, ctx);
        }

        const query = args[0];

        // ─── 복수 에피소드 번호 감지 ──────────────────────────────
        const multiTokens = query.trim().split(/[\s,]+/);
        if (multiTokens.length >= 2) {
            const parsedNums = [];
            let allInRange = true;

            for (const token of multiTokens) {
                const m = token.match(/^(\d+)(화|회)?$/);
                if (!m) {
                    allInRange = false;
                    break;
                }
                const num = parseInt(m[1], 10);
                if (num < cfg.episode.start || num > cfg.episode.end) {
                    allInRange = false;
                    break;
                }
                parsedNums.push(num);
            }

            if (allInRange && parsedNums.length >= 2) {
                ctx.setCooldown(cmd, 0, _input);
                return printMultiEpisodeTimetable(rtn, parsedNums, cmd, ctx);
            }
        }

        const numbers = query.match(/^(\d+)(\S)?/);
        const parseChapter = numbers ? parseInt(numbers[1], 10) : NaN;
        const isChapter = numbers && parseChapter >= cfg.episode.start && parseChapter <= cfg.episode.end &&
            (!numbers[2] || "화회".includes(numbers[2]));

        // 24시간 이내 동일 검색어 체크
        if (cfg.input.duplicate_history_hours > 0 && _input.spamGuard) {
            const normalizedQuery = isChapter ? parseChapter.toString() : filterText(query);

            const now = Date.now();
            const expiry = now - (cfg.input.duplicate_history_hours * 60 * 60 * 1000);

            const history = _input.spamGuard.getSearchHistory(_input.channelId).filter(item => item.time >= expiry);
            const duplicateFound = history.some(item => item.query === normalizedQuery);

            if (duplicateFound) {
                _input.warn = cfg.input.duplicate_history_penalty || 1;
                _input.spamGuard.setSearchHistory(_input.channelId, history);
                return null;
            }

            _input.onSuccess = () => {
                if (cfg.input.duplicate_history_hours > 0) {
                    history.push({ query: normalizedQuery, time: Date.now() });
                    _input.spamGuard.setSearchHistory(_input.channelId, history);
                }
            };
        }

        if (isChapter) {
            ctx.setCooldown(cmd, 0, _input);
            return printNumEpisode(rtn, parseChapter, cmd, ctx);
        }

        if (query) {
            const reqStr = query.replace(/\s+/g, '');
            if (reqStr.length >= cfg.input.search_min_length) {
                const lowerQuery = reqStr.toLowerCase();
                const titleMatched = videoInfo.find(info =>
                    (info.title && info.title.replace(/\s+/g, '').toLowerCase().includes(lowerQuery)) ||
                    (info.shorten && info.shorten.replace(/\s+/g, '').toLowerCase().includes(lowerQuery))
                );

                if (titleMatched) {
                    ctx.setCooldown(cmd, 0, _input);
                    return printNumEpisode(rtn, titleMatched.alias, cmd, ctx);
                }
            }
        }

        if (cfg.input.enable_search === false) {
            return ctx.returnWarning(msg.error.search_disabled, cmd, _input);
        }

        if (_input && _input.warn >= 1) {
            return null;
        }

        const trackerInfo = _input.spamGuard && _input.spamGuard.tracker.get(_input.channelId);
        if (trackerInfo && (trackerInfo.searchBanned || trackerInfo.warns >= 1)) {
            return null;
        }

        if (query.length < cfg.input.search_min_length) {
            return ctx.returnWarning(msg.error.search_min_length(cfg.input.search_min_length), cmd, _input);
        }

        const searchText = filterText(query);
        if (hasProfanity(searchText)) {
            return ctx.returnWarning(msg.error.search_profanity, cmd, _input);
        }

        const baseWarn = cfg.subtitle_score.warn_base || 10;
        const { validResults, searchInfo } = videoSubManager.searchAndFormat(query, rtn);
        if (validResults && validResults.length > 0) {
            _input.warn = baseWarn +
                parseInt((100 - validResults[0].score) / cfg.subtitle_score.warn_divisor);

            ctx.setCooldown(cmd, 0, _input);

            const isDefinitive = validResults[0].score >= 100 ||
                validResults.length === 1 ||
                (validResults[0].score - validResults[1].score >= 10);

            if (isDefinitive) {
                const firstResult = validResults[0];

                if (firstResult.subSt === 0 && firstResult.subEd === 0) {
                    _input.warn = 0;
                    ctx.setCooldown(cmd, 0, _input);
                    return printNumEpisode(rtn, firstResult.subInfo.alias, cmd, ctx);
                }

                const subEpisodeKeys = searchInfo
                    .filter(e => searchInfo[0].key !== e.key && e.score >= firstResult.score)
                    .slice(0, cfg.subtitle_score.max_candidate_episodes)
                    .map(e => e.key);

                const subEpisodeSet = new Set(subEpisodeKeys);
                const subEpisodeMatching = videoInfo
                    .filter(e => subEpisodeSet.has(e.name))
                    .map(e => e.alias);

                const message = (firstResult.outOfbounds ? msg.subtitle.not_in_stream :
                    msg.subtitle.found_time(firstResult.emoji, firstResult.timestr)) +
                    `${subEpisodeMatching.length > 0 ? msg.subtitle.candidates(subEpisodeMatching) : ''}`;

                const prefixEmoji = firstResult.score < 100 ? "⚠️ 📜" : "📜";

                return {
                    msg: msg.subtitle.found_definitive(prefixEmoji, firstResult.unicodenum,
                        insertSpaces(firstResult.subInfo.title, retryPattern[0]),
                        message, firstResult.unicodescore, ctx.getCooldownMsg(cmd)),
                    proc: function (attempt) {
                        return msg.subtitle.found_definitive(prefixEmoji, firstResult.unicodenum,
                            insertSpaces(firstResult.subInfo.title, retryPattern[attempt]),
                            message, firstResult.unicodescore, ctx.getCooldownMsg(cmd));
                    }
                };
            } else {
                const makeMsg = (attempt) => {
                    const mapped = validResults.map((r, i) => {
                        const rankEmoji = toUnicodeNumber2((i + 1).toString());
                        const title = insertSpaces(r.subInfo.shorten, retryPattern[attempt]);
                        const timeMsg = r.outOfbounds ?
                            msg.subtitle.not_in_stream_short :
                            `${r.emoji} ${r.timestr.replace(/\((월|화|수|목|금|토|일)\)/g, "")}`;

                        return {
                            n: `${rankEmoji}${r.unicodenum})${title}${timeMsg.replace(/ /g, '')}`,
                            s: `${rankEmoji}${r.unicodenum}화${timeMsg.replace(/ /g, '')}`
                        };
                    });
                    const WrongMsg = msg.subtitle.ambiguous_warning;
                    return {
                        n: `${WrongMsg} ${mapped.map(e => e.n).join('')} ${ctx.getCooldownMsg(cmd)}`,
                        s: `${WrongMsg} ${mapped.map(e => e.s).join('')} ${ctx.getCooldownMsg(cmd)}`
                    };
                };

                return {
                    msg: makeMsg(0).n,
                    proc: function (attempt) {
                        if (attempt === 1)
                            return makeMsg(attempt).s;
                        else
                            return ctx.returnWarning(msg.error.search_output_failed, cmd, _input);
                    }
                };
            }
        }

        // AI 폴백 시도
        if (cfg.ai && cfg.ai.enable) {
            sendChat(msg.error.search_ai_pending);

            searchEpisodeByAI(query, cfg.ai, cfg.episode.start, cfg.episode.end)
                .then(episodeNum2 => {
                    if (episodeNum2 !== null) {
                        console.log(`🤖 AI: "${query}" → ${episodeNum2}화`);
                        ctx.setCooldown(cmd, 0, _input);
                        const result = printNumEpisode(rtn, episodeNum2, cmd, ctx);
                        if (result) {
                            if (typeof result === 'string')
                                return sendChat(`🤖 ${result}`);
                            return sendChat(`🤖 ${result.msg}`);
                        }
                    }

                    sendChat(ctx.returnWarning(msg.error.search_failed, cmd, _input));
                })
                .catch(err => {
                    console.error('AI 검색 중 오류 발생:', err);
                });

            if (_input) _input.warn = baseWarn * 5;
            return null;
        }

        _input.warn = baseWarn;
        return ctx.returnWarning(msg.error.search_not_found, cmd, _input);
    }
};
