const cfg = require('../../data/config-youtube.js');
const msg = require('../../data/config-messages.js');
const { videoInfo, getFutureDate } = require('../video-matcher/search.js');
const { toUnicodeNumber, toHHMMSS, formatDate, roundUpTime, getClockEmoji, insertSpaces } = require('../func.js');

const retryPattern = ["$1", "$1 ", " $1", "", ""];

function printFutureEpisode(rtn, cmd, skipCount, label, _input, ctx) {
    const n = videoInfo.length;
    if (n === 0) return ctx.returnWarning(msg.error.next_episode_not_found(label), cmd, _input);

    let currentIdx = (rtn.index + 1) % n;
    let info = null;
    let foundCount = 0;

    // 현재 인덱스 이후부터 재생 리스트를 순회하며 활성화(disable !== true)된 목표 에피소드 색인
    for (let i = 0; i < n; i++) {
        const e = videoInfo[currentIdx];
        if (!e.disable) {
            foundCount++;
            if (foundCount === skipCount) {
                info = e;
                break;
            }
        }
        currentIdx = (currentIdx + 1) % n;
    }

    if (info === null) {
        return ctx.returnWarning(msg.error.next_episode_not_found(label), cmd, _input);
    }

    // 찾은 에피소드가 방영될 미래의 예정 시각 계산
    const futureDate = roundUpTime(getFutureDate(info, rtn, 0));
    const unicodenum = toUnicodeNumber(info.alias);
    const timestr = formatDate(futureDate);
    const emoji = getClockEmoji(timestr);

    ctx.setCooldown(cmd, 0, _input);
    return {
        msg: msg.episode.future(label, unicodenum, insertSpaces(info.title, retryPattern[0]), emoji, timestr, ctx.getCooldownMsg(cmd)),
        proc: function (attempt) {
            return msg.episode.future(label, unicodenum, insertSpaces(info.title, retryPattern[attempt]), emoji, timestr, ctx.getCooldownMsg(cmd));
        }
    };
}

function printNumEpisode(rtn, num, cmd, ctx) {
    const info = videoInfo.find(e => e.alias == num);

    if (!info)
        return null;

    if (videoInfo[rtn.index] === info) {
        return printNowEpisode(rtn, cmd, ctx);
    }

    const futureDate = roundUpTime(getFutureDate(info, rtn, 0));
    const unicodenum = toUnicodeNumber(info.alias);
    const timestr = formatDate(futureDate);
    const emoji = getClockEmoji(timestr);

    let timeMsg = info.disable
        ? msg.episode.scheduled_no_stream
        : msg.episode.scheduled_time(emoji, timestr);

    return {
        msg: msg.episode.scheduled(unicodenum, insertSpaces(info.title, retryPattern[0]), timeMsg, ctx.getCooldownMsg(cmd)),
        proc: function (attempt) {
            return msg.episode.scheduled(unicodenum, insertSpaces(info.title, retryPattern[attempt]), timeMsg, ctx.getCooldownMsg(cmd));
        }
    };
}

function printNowEpisode(rtn, cmd, ctx) {
    const info = videoInfo[rtn.index];
    if (!info) return null; // videoInfo 비어 있거나 index 범위 벗어날 경우 방어
    const unicodenum = toUnicodeNumber(info.alias);
    const timestr = toHHMMSS(rtn.end - rtn.now);

    return {
        msg: msg.episode.now_playing(unicodenum, insertSpaces(info.title, retryPattern[0]), timestr, ctx.getCooldownMsg(cmd)),
        proc: function (attempt) {
            return msg.episode.now_playing(unicodenum, insertSpaces(info.title, retryPattern[attempt]), timestr, ctx.getCooldownMsg(cmd));
        }
    };
}

module.exports = {
    name: 'future',
    icon: '⏭️',
    groups: {
        'next': ['!다음', '!다음화', '!다음회', '!다음편', '!다음회차'],
        'nextnext': ['!다다음', '!다다음화', '!다다음회', '!다다음편', '!다다음회차'],
        'first': ['!첫화', '!첫회', '!처음화', '!처음회', '!처음편', '!첫편'],
        'last': ['!마지막', '!마지막화', '!마지막회', '!마지막편', '!최종화', '!최종회', '!최종편', '!막화', '!막회']
    },
    aliases: [
        '!다음', '!다음화', '!다음회', '!다음편', '!다음회차',
        '!다다음', '!다다음화', '!다다음회', '!다다음편', '!다다음회차',
        '!첫화', '!첫회', '!처음화', '!처음회', '!처음편', '!첫편',
        '!마지막', '!마지막화', '!마지막회', '!마지막편', '!최종화', '!최종회', '!최종편', '!막화', '!막회'
    ],
    description: '다음, 다다음, 첫화, 마지막화 방영 예정 정보 조회',

    web: {
        title: '미래 회차',
        icon: '🔜',
        description: '다음화/그다음화 예정 회차 정보 조회 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, group, rtn, _input, ctx }) {
        if (group === 'next') {
            return printFutureEpisode(rtn, cmd, 1, '다음', _input, ctx);
        }
        if (group === 'nextnext') {
            return printFutureEpisode(rtn, cmd, 2, '다다음', _input, ctx);
        }
        if (group === 'first') {
            ctx.setCooldown(cmd, 0, _input);
            return printNumEpisode(rtn, cfg.episode.start, cmd, ctx);
        }
        if (group === 'last') {
            ctx.setCooldown(cmd, 0, _input);
            return printNumEpisode(rtn, cfg.episode.end, cmd, ctx);
        }
        return null;
    },

    printFutureEpisode,
    printNumEpisode,
    printNowEpisode
};
