const cfg = require('../../data/config-youtube.js');
const msg = require('../../data/config-messages.js');
const { videoInfo, getEditOffset, getRemainingTime } = require('../video-matcher/search.js');
const { toUnicodeNumber, formatDate, roundUpTime, insertSpaces } = require('../func.js');

const retryPattern = ["$1", "$1 ", " $1", "", ""];

function findEpisodeIndex(query) {
    if (!query || typeof query !== 'string') return -1;
    const trimmed = query.trim();
    if (!trimmed) return -1;

    // 1. 숫자 회차 매칭 (예: "5", "5화", "5회", "5편", "제5화" 등)
    const numMatch = trimmed.match(/^제?(\d+)(화|회|편)?$/);
    if (numMatch) {
        const num = parseInt(numMatch[1], 10);
        const idx = videoInfo.findIndex(e => e.alias == num || parseInt(e.alias, 10) === num);
        if (idx !== -1) return idx;
    }

    // 2. 키워드 매칭 (alias, shorten, title)
    const cleanQuery = trimmed.replace(/\s+/g, '').toLowerCase();
    if (cleanQuery.length >= 1) {
        // alias 완전 일치 우선
        let idx = videoInfo.findIndex(e => e.alias && e.alias.toString().toLowerCase() === cleanQuery);
        if (idx !== -1) return idx;

        // shorten 또는 title 부분 일치 (공백/대소문자 무시)
        idx = videoInfo.findIndex(e => {
            const shortenClean = e.shorten ? e.shorten.replace(/\s+/g, '').toLowerCase() : '';
            const titleClean = e.title ? e.title.replace(/\s+/g, '').toLowerCase() : '';
            return shortenClean.includes(cleanQuery) || titleClean.includes(cleanQuery);
        });
        if (idx !== -1) return idx;
    }

    return -1;
}

function printTimeTable(rtn, change, cmd, ctx, limitLength = cfg.timetable.default_limit, startIdx = null) {
    const n = videoInfo.length;
    if (n === 0) return null;

    let str = "";
    let pdate = null; // 이전 회차 날짜(일자 변경 표시용)

    const currentEp = videoInfo[rtn.index];
    const streamNow = rtn.now - getEditOffset(currentEp._editParsed, rtn.now);
    const constTime = parseInt(Date.now() / 1000) - streamNow;

    // 지정된 startIdx가 유효하면 해당 인덱스부터, 아니면 현재 방송 중인 인덱스(rtn.index)부터 탐색 시작
    const effectiveStartIdx = (startIdx !== null && startIdx >= 0 && startIdx < n) ? startIdx : (rtn.index % n);
    let accumSec = getRemainingTime(videoInfo[effectiveStartIdx].name, rtn.index);

    let currentIdx = effectiveStartIdx;
    let isFirst = true;

    // 전체 재생 리스트를 한 바퀴 돌면서 활성화된 에피소드 문자열 조립
    for (let i = 0; i < n; i++) {
        const e = videoInfo[currentIdx];
        if (!e.disable) {
            const fdate = roundUpTime(new Date((constTime + accumSec) * 1000));

            if (isFirst) {
                isFirst = false;
                if (currentIdx === rtn.index) {
                    const firstStr = msg.timetable && msg.timetable.first_item
                        ? msg.timetable.first_item(toUnicodeNumber(e.alias), e.shorten)
                        : `${toUnicodeNumber(e.alias)}화)${e.shorten}`;
                    str = insertSpaces(firstStr, change);
                } else {
                    pdate = fdate;
                    const hdr = `${formatDate(fdate, null, true)}`.replace(/ /g, '');
                    const firstStr = `${toUnicodeNumber(e.alias)}화 ${hdr})${e.shorten}`;
                    str = insertSpaces(firstStr, change);
                }
                accumSec += e._streamDurationSec;
                currentIdx = (currentIdx + 1) % n;
                continue;
            }

            if (!pdate)
                pdate = fdate;

            // 출력 포맷 가공: '23:45' 혹은 '12일00:15' 형식으로 시간표 헤더 작성
            const hdr = `${formatDate(fdate, pdate, true)}`.replace(/ /g, '');
            // 에피소드 이름과 결합 ('→23:45)에피소드명')
            const itemStr = msg.timetable && msg.timetable.next_item
                ? msg.timetable.next_item(hdr, e.shorten)
                : `→${hdr})${e.shorten}`;
            const candidate = insertSpaces(itemStr, change);

            // 누적된 시간표 문자열의 총 길이가 채팅 제한치(limitLength)를 넘으면 그만 붙이고 즉시 반환
            if (str.length + candidate.length >= limitLength) {
                return str + " " + ctx.getCooldownMsg(cmd);
            }

            str += candidate;
            pdate = fdate;
            accumSec += e._streamDurationSec;
        }
        currentIdx = (currentIdx + 1) % n;
    }

    return str ? str + " " + ctx.getCooldownMsg(cmd) : null;
}

module.exports = {
    name: 'timetable',
    group: 'timetable',
    aliases: ['!시간표', '!편성표', '!방영표', '!방송표', '!상영표', '!스케줄', '!스케쥴', '!스캐쥴', '!스캐줄', '!편성', '!순서'],
    description: '곧 방영될 회차들의 목록과 예상 시작 시각 요약 출력',

    async execute({ cmd, args, rtn, _input, ctx }) {
        let startIdx = null;

        if (args && args.length > 0) {
            const query = args.join(' ').trim();
            if (query.length > 0) {
                const foundIdx = findEpisodeIndex(query);
                if (foundIdx !== -1) {
                    startIdx = foundIdx;
                }
            }
        }

        ctx.setCooldown(cmd, 0, _input);
        const limitLength = (cfg.timetable && cfg.timetable.default_limit) || 130;
        return {
            msg: printTimeTable(rtn, retryPattern[0], cmd, ctx, limitLength, startIdx),
            proc: function (attempt) {
                return printTimeTable(rtn, retryPattern[attempt], cmd, ctx, limitLength, startIdx);
            }
        };
    },

    findEpisodeIndex,
    printTimeTable
};
