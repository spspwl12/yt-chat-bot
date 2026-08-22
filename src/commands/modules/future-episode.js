function printFutureEpisode(rtn, cmd, skipCount, label, _input, ctx) {
    const videoInfo = ctx.videoInfo;
    const n = videoInfo.length;
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
        return ctx.returnWarning(ctx.msg.error.next_episode_not_found(label), cmd, _input);
    }

    // 찾은 에피소드가 방영될 미래의 예정 시각 계산
    const futureDate = ctx.roundUpTime(ctx.search_lib.getFutureDate(info, rtn, 0));
    const unicodenum = ctx.toUnicodeNumber(info.alias);
    const timestr = ctx.formatDate(futureDate);
    const emoji = ctx.getClockEmoji(timestr);

    ctx.setCooldown(cmd, 0, _input);
    return {
        msg: ctx.msg.episode.future(label, unicodenum, ctx.insertSpaces(info.title, ctx.retryPattern[0]), emoji, timestr, ctx.getCooldownMsg(cmd)),
        proc: function (attempt) {
            return ctx.msg.episode.future(label, unicodenum, ctx.insertSpaces(info.title, ctx.retryPattern[attempt]), emoji, timestr, ctx.getCooldownMsg(cmd));
        }
    };
}

function printNumEpisode(rtn, num, cmd, ctx) {
    const videoInfo = ctx.videoInfo;
    const info = videoInfo.find(e => e.alias == num);

    if (!info)
        return null;

    if (videoInfo[rtn.index] === info) {
        return printNowEpisode(rtn, cmd, ctx);
    }

    const futureDate = ctx.roundUpTime(ctx.search_lib.getFutureDate(info, rtn, 0));
    const unicodenum = ctx.toUnicodeNumber(info.alias);
    const timestr = ctx.formatDate(futureDate);
    const emoji = ctx.getClockEmoji(timestr);

    let timeMsg = info.disable
        ? ctx.msg.episode.scheduled_no_stream
        : ctx.msg.episode.scheduled_time(emoji, timestr);

    return {
        msg: ctx.msg.episode.scheduled(unicodenum, ctx.insertSpaces(info.title, ctx.retryPattern[0]), timeMsg, ctx.getCooldownMsg(cmd)),
        proc: function (attempt) {
            return ctx.msg.episode.scheduled(unicodenum, ctx.insertSpaces(info.title, ctx.retryPattern[attempt]), timeMsg, ctx.getCooldownMsg(cmd));
        }
    };
}

function printNowEpisode(rtn, cmd, ctx) {
    const videoInfo = ctx.videoInfo;
    const info = videoInfo[rtn.index];
    const unicodenum = ctx.toUnicodeNumber(info.alias);
    const timestr = ctx.toHHMMSS(rtn.end - rtn.now);

    return {
        msg: ctx.msg.episode.now_playing(unicodenum, ctx.insertSpaces(info.title, ctx.retryPattern[0]), timestr, ctx.getCooldownMsg(cmd)),
        proc: function (attempt) {
            return ctx.msg.episode.now_playing(unicodenum, ctx.insertSpaces(info.title, ctx.retryPattern[attempt]), timestr, ctx.getCooldownMsg(cmd));
        }
    };
}

module.exports = {
    name: 'future-episode',
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

    async execute({ cmd, group, rtn, _input, ctx }) {
        if (group === 'next') {
            return printFutureEpisode(rtn, cmd, 1, '다음', _input, ctx);
        }
        if (group === 'nextnext') {
            return printFutureEpisode(rtn, cmd, 2, '다다음', _input, ctx);
        }
        if (group === 'first') {
            ctx.setCooldown(cmd, 0, _input);
            return printNumEpisode(rtn, ctx.cfg.episode.start, cmd, ctx);
        }
        if (group === 'last') {
            ctx.setCooldown(cmd, 0, _input);
            return printNumEpisode(rtn, ctx.cfg.episode.end, cmd, ctx);
        }
        return null;
    },

    printFutureEpisode,
    printNumEpisode,
    printNowEpisode
};
