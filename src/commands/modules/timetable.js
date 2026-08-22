function printTimeTable(rtn, change, cmd, ctx, limitLength = ctx.cfg.timetable.default_limit) {
    const videoInfo = ctx.videoInfo;
    const n = videoInfo.length;
    let str = "";
    let pdate; // 이전 회차 날짜(일자 변경 표시용)

    // 현재 방송 중인 인덱스의 바로 다음 인덱스부터 탐색 시작
    let currentIdx = (rtn.index) % n;

    // 전체 재생 리스트를 한 바퀴 돌면서 활성화된 에피소드 문자열 조립
    for (let i = 0; i < n; i++) {
        const e = videoInfo[currentIdx];
        if (!e.disable) {
            if (i === 0) {
                const firstStr = ctx.msg.timetable && ctx.msg.timetable.first_item
                    ? ctx.msg.timetable.first_item(ctx.toUnicodeNumber(e.alias), e.shorten)
                    : `${ctx.toUnicodeNumber(e.alias)}화)${e.shorten}`;
                str = ctx.insertSpaces(firstStr, change);
                currentIdx = (currentIdx + 1) % n;
                continue;
            }
            // 해당 에피소드의 방송 시작 예정 일시 계산
            const fdate = ctx.roundUpTime(ctx.search_lib.getFutureDate(e, rtn, 0));
            if (!pdate)
                pdate = fdate;

            // 출력 포맷 가공: '23:45' 혹은 '12일00:15' 형식으로 시간표 헤더 작성
            const hdr = `${ctx.formatDate(fdate, pdate, true)}`.replace(/ /g, '');
            // 에피소드 이름과 결합 ('→23:45)에피소드명')
            const itemStr = ctx.msg.timetable && ctx.msg.timetable.next_item
                ? ctx.msg.timetable.next_item(hdr, e.shorten)
                : `→${hdr})${e.shorten}`;
            const candidate = ctx.insertSpaces(itemStr, change);

            // 누적된 시간표 문자열의 총 길이가 채팅 제한치(limitLength)를 넘으면 그만 붙이고 즉시 반환
            if (str.length + candidate.length >= limitLength) {
                return str + " " + ctx.getCooldownMsg(cmd);
            }

            str += candidate;
            pdate = fdate;
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

    async execute({ cmd, rtn, _input, ctx }) {
        ctx.setCooldown(cmd, 0, _input);
        return {
            msg: printTimeTable(rtn, ctx.retryPattern[0], cmd, ctx),
            proc: function (attempt) {
                return printTimeTable(rtn, ctx.retryPattern[attempt], cmd, ctx);
            }
        };
    },

    // 헬퍼 노출 (다른 모듈 또는 외부 참조용)
    printTimeTable
};
