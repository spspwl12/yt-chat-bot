const msg = require('../../data/config-messages.js');
const { videoInfo } = require('../video-matcher/search.js');
const { toUnicodeNumber, toHHMMSS, insertSpaces } = require('../func.js');

const retryPattern = ["$1", "$1 ", " $1", "", ""];

module.exports = {
    name: 'time',
    group: 'time',
    icon: '⏰',
    aliases: ['!시간', '!타임', '!남은시간'],
    description: '현재 방영 회차 및 남은 시간 단축 출력',

    web: {
        title: '현재 시각',
        icon: '⏰',
        description: '현재 한국 시간 표시 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, rtn, _input, ctx }) {
        ctx.setCooldown(cmd, 0, _input);
        const info = videoInfo[rtn.index];
        const unicodenum = toUnicodeNumber(info.alias);
        const timestr = toHHMMSS(rtn.end - rtn.now);

        return {
            msg: msg.time.remaining(unicodenum, insertSpaces(info.shorten, retryPattern[0]), timestr, ctx.getCooldownMsg(cmd)),
            proc: function (attempt) {
                return msg.time.remaining(unicodenum, insertSpaces(info.shorten, retryPattern[attempt]), timestr, ctx.getCooldownMsg(cmd));
            }
        };
    }
};
