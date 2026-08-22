let musicFreq = null;

function getMusicFreq(musics) {
    if (musicFreq) return musicFreq;
    musicFreq = new Map();
    for (const epKey in musics) {
        const uniqueSongs = new Set();
        for (const m of musics[epKey]) {
            if (m && m.text) uniqueSongs.add(m.text);
        }
        for (const text of uniqueSongs) {
            musicFreq.set(text, (musicFreq.get(text) || 0) + 1);
        }
    }
    return musicFreq;
}

module.exports = {
    name: 'music',
    group: 'music',
    aliases: ['!음악', '!노래', '!브금', '!곡', '!사운드', '!bgm'],
    description: '현재/과거 재생 음악 및 음악 등장 회차 검색',

    async execute({ cmd, args, rtn, _input, ctx }) {
        const cfg = ctx.cfg;
        const msg = ctx.msg;
        const musics = ctx.musics;
        const videoInfo = ctx.videoInfo;

        if (cfg.music && !cfg.music.enable) {
            return ctx.returnWarning(msg.error.music_disabled, cmd, _input);
        }

        if (!args || args.length === 0) {
            ctx.setCooldown(cmd, 0, _input);
            if (!rtn || rtn.index === undefined) {
                return null;
            }
            const epInfo = videoInfo[rtn.index];
            const epKey = epInfo.name;
            const epMusics = musics[epKey] || [];

            const foundList = [];
            const historySec = (cfg.music && cfg.music.history_sec !== undefined) ? cfg.music.history_sec : 180;
            const historyMin = Math.floor(historySec / 60);

            // 현재 에피소드의 음악 스캔
            for (let i = epMusics.length - 1; i >= 0; i--) {
                const m = epMusics[i];
                const startSec = ctx.fromHHMMSS(m.start);
                const endSec = ctx.fromHHMMSS(m.end);

                if (rtn.now >= startSec && rtn.now <= endSec) {
                    foundList.push({ diff: 0, text: m.text });
                } else if (endSec < rtn.now && rtn.now - endSec <= historySec) {
                    let d = Math.floor((rtn.now - endSec) / 60);
                    if (d === 0) d = 1;
                    foundList.push({ diff: d, text: m.text });
                }
            }

            // 이전 에피소드의 음악도 스캔
            let remainingHistory = historySec - rtn.now;
            if (remainingHistory > 0) {
                let elapsedFromCurrent = rtn.now;
                let prevIdx = (rtn.index - 1 + videoInfo.length) % videoInfo.length;

                while (remainingHistory > 0 && prevIdx !== rtn.index) {
                    const prevEp = videoInfo[prevIdx];
                    if (!prevEp.disable) {
                        const prevKey = prevEp.name;
                        const prevMusics = musics[prevKey] || [];
                        const prevEnd = prevEp._effectiveEndSec;

                        for (let i = prevMusics.length - 1; i >= 0; i--) {
                            const m = prevMusics[i];
                            const startSec = ctx.fromHHMMSS(m.start);
                            const endSec = ctx.fromHHMMSS(m.end);

                            if (endSec > prevEnd) continue;

                            const distFromPrevEnd = prevEnd - endSec;
                            if (distFromPrevEnd > remainingHistory) continue;

                            const totalDiffSec = elapsedFromCurrent + distFromPrevEnd;
                            let d = Math.floor(totalDiffSec / 60);
                            if (d === 0) d = 1;
                            foundList.push({ diff: d, text: m.text });
                        }

                        elapsedFromCurrent += prevEnd;
                        remainingHistory -= prevEnd;
                    }
                    prevIdx = (prevIdx - 1 + videoInfo.length) % videoInfo.length;
                }
            }

            if (foundList.length > 0) {
                const enablePenalty = cfg.music && cfg.music.frequent_penalty_enable !== false;
                const freqThreshold = (cfg.music && cfg.music.frequent_threshold) ? cfg.music.frequent_threshold : 20;
                const freqMap = enablePenalty ? getMusicFreq(musics) : null;

                foundList.forEach(item => {
                    item.penalty = 0;
                    if (enablePenalty && (freqMap.get(item.text) || 0) >= freqThreshold) {
                        item.penalty = Infinity;
                    }
                });

                foundList.sort((a, b) => {
                    if (a.penalty !== b.penalty) return a.penalty - b.penalty;
                    return a.diff - b.diff;
                });

                if (cfg.music && cfg.music.max_length) {
                    while (foundList.length > 1) {
                        let tempStr = foundList.map(item => item.diff === 0 ? msg.music.currently_playing(item.text) : msg.music.played_ago(item.diff, item.text)).join(' ');
                        if (tempStr.length <= cfg.music.max_length) break;
                        foundList.pop();
                    }
                }

                foundList.sort((a, b) => a.diff - b.diff);

                let msg_str = foundList.map(item => {
                    if (item.diff === 0) return msg.music.currently_playing(item.text);
                    return msg.music.played_ago(item.diff, item.text);
                }).join(' ');

                if (cfg.music && cfg.music.max_length && msg_str.length > cfg.music.max_length) {
                    msg_str = msg_str.substring(0, cfg.music.max_length);
                }

                return {
                    msg: `${msg_str} ${ctx.getCooldownMsg(cmd)}`,
                    proc: () => `${msg_str} ${ctx.getCooldownMsg(cmd)}`
                };
            } else {
                return {
                    msg: ctx.returnWarning(msg.error.music_none_playing(historyMin), cmd, _input),
                    proc: () => `${msg.error.music_none_playing(historyMin)} ${ctx.getCooldownMsg(cmd)}`
                };
            }
        }

        const query = args.join(' ');
        const configManager = require('../../config-manager.js');
        const searchInfo = configManager.getMusicSearcher().search(query);
        if (searchInfo && searchInfo.length > 0) {
            searchInfo.sort((a, b) => b.score - a.score);

            const validResults = [];
            const removeDup = searchInfo.filter(
                (item, index, self) => index === self.findIndex(obj => obj.key === item.key)
            );

            const minScore = (cfg.music && cfg.music.min_score !== undefined) ? cfg.music.min_score : cfg.subtitle_score.min_value;

            for (const result of removeDup) {
                const matched = result.matchedIndices;
                if (!matched || matched.length === 0) continue;

                if (result.score > minScore) {
                    const key = result.key;
                    const subInfo = videoInfo.find(e => e.name === key);
                    if (!subInfo) continue;

                    let bestMObj = null;
                    let bestOutOfbounds = true;
                    for (const idx of matched) {
                        const candidate = musics[key][idx - 1];
                        if (!candidate) continue;
                        const t = ctx.fromHHMMSS(candidate.start);
                        let oob = !!subInfo.disable;
                        if (!oob && subInfo._editParsed) {
                            for (const et of subInfo._editParsed) {
                                if (t >= et.s && t <= et.e) {
                                    oob = true;
                                    break;
                                }
                            }
                        }
                        if (!oob) {
                            bestMObj = candidate;
                            bestOutOfbounds = false;
                            break;
                        }
                        if (!bestMObj) {
                            bestMObj = candidate;
                        }
                    }

                    if (bestMObj && subInfo) {
                        const subTime = ctx.fromHHMMSS(bestMObj.start);
                        const unicodenum = ctx.toUnicodeNumber(subInfo.alias);
                        const rawHwa = `${unicodenum}화`;

                        const futureDate = ctx.roundUpTime(ctx.search_lib.getFutureDate(subInfo, rtn, subTime));
                        const timestr = ctx.formatDate(futureDate);
                        const emoji = ctx.getClockEmoji(timestr);

                        const timeMsg = bestOutOfbounds ?
                            msg.subtitle.not_in_stream_short :
                            `${emoji} ${timestr.replace(/\((월|화|수|목|금|토|일)\)/g, "")}`;

                        validResults.push({
                            aliasInt: parseInt(subInfo.alias, 10) || 0,
                            rawHwa,
                            timeMsg: timeMsg.replace(/ /g, '')
                        });
                    }
                }
            }

            if (validResults.length > 0) {
                ctx.setCooldown(cmd, 0, _input);
                validResults.sort((a, b) => a.aliasInt - b.aliasInt);
                const detailsList = validResults.map(r => `${r.rawHwa}(${r.timeMsg})`);

                let detailsStr = detailsList.join(', ');
                if (cfg.music && cfg.music.max_length) {
                    let testMsg = msg.music.found_episodes(detailsStr);
                    if (testMsg.length > cfg.music.max_length && detailsList.length > 1) {
                        while (detailsList.length > 1) {
                            detailsList.pop();
                            detailsStr = detailsList.join(', ') + '...';
                            testMsg = msg.music.found_episodes(detailsStr);
                            if (testMsg.length <= cfg.music.max_length) break;
                        }
                    }
                    if (testMsg.length > cfg.music.max_length) {
                        detailsStr = detailsStr.substring(0, cfg.music.max_length - 20) + '...';
                    }
                }

                const makeMsg = (attempt) => {
                    const spaces = " ".repeat(attempt);
                    const builtMsg = msg.music.found_episodes(detailsStr);
                    return `${builtMsg}${spaces} ${ctx.getCooldownMsg(cmd)}`;
                };

                return {
                    msg: makeMsg(0),
                    proc: (attempt) => makeMsg(attempt)
                };
            }
        }

        return {
            msg: ctx.returnWarning(msg.error.music_not_found, cmd, _input),
            proc: () => `${msg.error.music_not_found} ${ctx.getCooldownMsg(cmd)}`
        };
    }
};
