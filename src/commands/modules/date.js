module.exports = {
    name: 'date',
    group: 'date',
    aliases: ['!날짜', '!날자'],
    description: '특정 날짜 및 시간에 방영될 회차 정보 조회',

    async execute({ cmd, args, rtn, _input, ctx }) {
        if (!args || args.length === 0) {
            return ctx.returnWarning(ctx.msg.error.date_missing, cmd, _input);
        }

        const dtStr = args.join(' ');
        const dtParsed = ctx.parseKoreanDate(dtStr);
        if (!dtParsed) {
            return ctx.returnWarning(ctx.msg.error.date_invalid_format, cmd, _input);
        }

        const nowTime = Date.now();
        const limitFutureTime = nowTime + (1000 * 60 * 60 * 24 * 90); // 약 3개월(90일)

        if (dtParsed.endDate.getTime() < nowTime) {
            return ctx.returnWarning(ctx.msg.error.date_past, cmd, _input);
        }

        if (dtParsed.startDate.getTime() > limitFutureTime) {
            return ctx.returnWarning(ctx.msg.error.date_too_far, cmd, _input);
        }

        const makeDateMsg = (attempt) => {
            const yyyy = dtParsed.startDate.getFullYear();
            const mm = String(dtParsed.startDate.getMonth() + 1).padStart(2, '0');
            const dd = String(dtParsed.startDate.getDate()).padStart(2, '0');
            const hh = String(dtParsed.startDate.getHours()).padStart(2, '0');
            const min = String(dtParsed.startDate.getMinutes()).padStart(2, '0');

            const reqDateStr = dtParsed.hasTime ?
                `${yyyy}-${mm}-${dd} ${hh}:${min}` :
                `${yyyy}-${mm}-${dd}`;

            if (dtParsed.hasDate && !dtParsed.hasTime) {
                const stEp = ctx.search_lib.getEpAtDate(dtParsed.startDate, rtn);
                const edEp = ctx.search_lib.getEpAtDate(dtParsed.endDate, rtn);

                const numSt = ctx.toUnicodeNumber(stEp.info.alias);
                const numEd = ctx.toUnicodeNumber(edEp.info.alias);

                if (stEp.idx === edEp.idx) {
                    return ctx.msg.date.full_repeat(reqDateStr, ctx.getCooldownMsg(cmd));
                } else {
                    return ctx.msg.date.range_episodes(reqDateStr, numSt, numEd, ctx.getCooldownMsg(cmd));
                }
            } else {
                const tEp = ctx.search_lib.getEpAtDate(dtParsed.startDate, rtn);
                const info = tEp.info;
                const threshold = ctx.cfg.input.boundary_sec;

                const numStr = ctx.toUnicodeNumber(info.alias);
                let overlaps = [];
                let mainTxt = `"${numStr}. ${ctx.insertSpaces(info.title, ctx.retryPattern[attempt])}"`;

                const epRemainSec = info._streamDurationSec - tEp.streamPos;
                const timestr = ctx.toHHMMSS(epRemainSec);

                if (tEp.streamPos < threshold) {
                    let pIdx = (tEp.idx - 1 + ctx.videoInfo.length) % ctx.videoInfo.length;
                    while (ctx.videoInfo[pIdx].disable) pIdx = (pIdx - 1 + ctx.videoInfo.length) % ctx.videoInfo.length;
                    const pInfo = ctx.videoInfo[pIdx];
                    overlaps.push(`"${ctx.toUnicodeNumber(pInfo.alias)}. ${ctx.insertSpaces(pInfo.title, ctx.retryPattern[attempt])}"`);
                    overlaps.push(mainTxt);
                } else if (info._streamDurationSec - tEp.streamPos < threshold) {
                    overlaps.push(mainTxt);
                    let nIdx = (tEp.idx + 1) % ctx.videoInfo.length;
                    while (ctx.videoInfo[nIdx].disable) nIdx = (nIdx + 1) % ctx.videoInfo.length;
                    const nInfo = ctx.videoInfo[nIdx];
                    overlaps.push(`"${ctx.toUnicodeNumber(nInfo.alias)}. ${ctx.insertSpaces(nInfo.title, ctx.retryPattern[attempt])}"`);
                } else {
                    overlaps.push(mainTxt);
                }

                const overlapStr = overlaps.join(" 및 ");
                ctx.setCooldown(cmd, 0, _input);
                return ctx.msg.date.exact_episode(reqDateStr, overlapStr, timestr, ctx.getCooldownMsg(cmd));
            }
        };

        ctx.setCooldown(cmd, 0, _input);
        return {
            msg: makeDateMsg(0),
            proc: function (att) {
                return makeDateMsg(att);
            }
        };
    }
};
