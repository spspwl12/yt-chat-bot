module.exports = {
    name: 'time',
    group: 'time',
    aliases: ['!시간', '!타임', '!남은시간'],
    description: '현재 방영 회차 및 남은 시간 단축 출력',

    async execute({ cmd, rtn, _input, ctx }) {
        ctx.setCooldown(cmd, 0, _input);
        const info = ctx.videoInfo[rtn.index];
        const unicodenum = ctx.toUnicodeNumber(info.alias);
        const timestr = ctx.toHHMMSS(rtn.end - rtn.now);

        return {
            msg: ctx.msg.time.remaining(unicodenum, ctx.insertSpaces(info.shorten, ctx.retryPattern[0]), timestr, ctx.getCooldownMsg(cmd)),
            proc: function (attempt) {
                return ctx.msg.time.remaining(unicodenum, ctx.insertSpaces(info.shorten, ctx.retryPattern[attempt]), timestr, ctx.getCooldownMsg(cmd));
            }
        };
    }
};
