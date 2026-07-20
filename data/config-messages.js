module.exports = {
    // ─── 일반 오류 / 경고 ─────────────────────────────────────
    error: {
        text_too_long: (maxLen) => `⚠️ 문장이 길어요. ${maxLen}자 이내로 간단히 작성해 주세요.`,
        search_disabled: `⚠️ 대사 검색 기능이 비활성화되어 있습니다.`,
        search_min_length: (minLen) => `⚠️ 대사를 ${minLen} 글자 이상 입력하세요.`,
        search_profanity: `⚠️ 대사에 욕설이 포함되어 있습니다.`,
        search_not_found: `⚠️ 대사를 정확히 입력하세요.`,
        search_failed: `⚠️ 검색에 실패했습니다.`,
        search_output_failed: `⚠️ 출력에 실패했습니다.`,
        search_ai_pending: `⚠️ 대사를 찾을 수 없습니다. 입력한 내용이 줄거리일 수 있어 AI 확인 후 답변드리겠습니다.`,
        music_disabled: `⚠️ 음악 검색 기능이 비활성화되어 있습니다.`,
        music_not_found: `⚠️ 검색된 노래가 없습니다. 정확히 입력해주세요.`,
        music_none_playing: (historyMin) => `⚠️ ${historyMin}분 이내에 재생된 음악이 없습니다.`,
        next_episode_not_found: (label) => `⚠️ ${label} 회차 정보를 확인할 수 없습니다.`,
        date_missing: `⚠️ 날짜나 시간을 입력하세요. (예: !날짜 19시 30분, !날짜 11/12)`,
        date_invalid_format: `⚠️ 날짜 형식을 인식하지 못했습니다.`,
        date_past: `⚠️ 과거 날짜나 시간은 조회할 수 없습니다.`,
        date_too_far: `⚠️ 너무 먼 미래의 날짜는 조회할 수 없습니다. (최대 3개월 이내)`,
    },

    // ─── 도움말 ────────────────────────────────────────────────
    help: {
        main: `ℹ️ 명령어: !몇화, !다음화, !시간표, !첫화, !마지막화, !날짜, !음악 ` +
            `ℹ️ !몇화 사용법: !몇화 64화, !몇화 31 64 72 121, !몇화 괜히똥쌌네` +
            `ℹ️ 대사 검색 명령어는 남용을 막기 위해 긴 개인 쿨타임이 적용됩니다. (최대 327시간)` +
            `ℹ️ 쿨타임이 걸린 상태에서 명령어를 사용할 경우, 쿨타임이 초기화되면서 동시에 늘어납니다.`,
    },

    // ─── 에피소드 / 회차 안내 ─────────────────────────────────
    episode: {
        now_playing: (unicodenum, title, timestr, cooldownMsg) =>
            `🎬 현재 회차는 "${unicodenum}. ${title}" 이고 🕒 남은 시간은 ${timestr} 초 입니다. ${cooldownMsg}`,
        scheduled: (unicodenum, title, timeMsg, cooldownMsg) =>
            `🔜 예정 회차는 "${unicodenum}. ${title}" 이고 ${timeMsg} ${cooldownMsg}`,
        scheduled_time: (emoji, timestr) => `${emoji} 예정 시간은 ${timestr} 분 입니다.`,
        scheduled_no_stream: `스트리밍하지 않습니다.`,
        future: (label, unicodenum, title, emoji, timestr, cooldownMsg) =>
            `👉🏻 ${label} 회차는 "${unicodenum}. ${title}" 이고 ${emoji} 예정 시간은 ${timestr} 분 입니다. ${cooldownMsg}`,
    },

    // ─── 현재 회차 알림 (noticeChangeEpisode) ─────────────────
    notice: {
        now_episode: (unicodenum, title, rankSuffix) =>
            `📢 현재 회차는 "${unicodenum}. ${title}" 입니다.${rankSuffix}`,
        rank_suffix: (viewsRank, funnyRank) =>
            ` (조회수: ${viewsRank}위, ㅋㅋ개수: ${funnyRank}위)`,
    },

    // ─── 대사 검색 결과 ───────────────────────────────────────
    subtitle: {
        found_definitive: (prefixEmoji, unicodenum, title, message, unicodescore, cooldownMsg) =>
            `${prefixEmoji} 요청하신 대사는 "${unicodenum}. ${title}" 에 등장하며 ${message} 정확도: ${unicodescore}% ${cooldownMsg}`,
        found_time: (emoji, timestr) => `${emoji} 등장 시간은 ${timestr} 분 입니다. `,
        not_in_stream: `스트리밍에는 등장하지 않습니다.`,
        candidates: (aliases) => `(후보: ${aliases})`,
        ambiguous_warning: `⚠️ 대사를 정확히 입력하세요.`,
        not_in_stream_short: `스트리밍X`,
    },

    // ─── 음악 검색 결과 ───────────────────────────────────────
    music: {
        currently_playing: (title) => `🎵(현재) ${title}`,
        played_ago: (minutes, title) => `🎵(${minutes}분 전) ${title}`,
        found_episodes: (details) => `🎵 입력하신 노래가 등장하는 회차는 ${details} 가 있습니다.`,
    },

    // ─── 날짜 조회 결과 ───────────────────────────────────────
    date: {
        full_repeat: (dateStr, cooldownMsg) =>
            `🗓️ [${dateStr}] 전체 회차가 반복 방송될 예정입니다. ${cooldownMsg}`,
        range_episodes: (dateStr, numSt, numEd, cooldownMsg) =>
            `🗓️ [${dateStr}] ${numSt}화 ~ ${numEd}화가 방송될 예정입니다. ${cooldownMsg}`,
        exact_episode: (dateStr, overlapStr, timestr, cooldownMsg) =>
            `🗓️ [${dateStr}] 해당 날짜에 ${overlapStr} 이(가) 방영될 예정이고 🕒 남은 시간은 ${timestr} 초 입니다. ${cooldownMsg}`,
    },

    // ─── 시간 단축 조회 (!시간) ───────────────────────────────
    time: {
        remaining: (unicodenum, title, timestr, cooldownMsg) =>
            `🎬 "${unicodenum}. ${title}" 방영중 ${timestr}초 남음 ${cooldownMsg}`,
    },

    // ─── 쿨타임 안내 ─────────────────────────────────────────
    cooldown: {
        suffix: (minutes) => `(쿨타임 ${minutes}분)`,
    },
};
