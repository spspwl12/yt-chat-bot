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
        stats_disabled: `⚠️ 스탯 기능이 비활성화되어 있습니다.`,
        stats_not_found: `⚠️ 스탯 정보를 찾을 수 없습니다.`,
        next_episode_not_found: (label) => `⚠️ ${label} 회차 정보를 확인할 수 없습니다.`,
        date_missing: `⚠️ 날짜나 시간을 입력하세요. (예: !날짜 19시 30분, !날짜 11/12)`,
        date_invalid_format: `⚠️ 날짜 형식을 인식하지 못했습니다.`,
        date_past: `⚠️ 과거 날짜나 시간은 조회할 수 없습니다.`,
        date_too_far: `⚠️ 너무 먼 미래의 날짜는 조회할 수 없습니다. (최대 3개월 이내)`,
        coolcheck_missing_name: (cmd) => `⚠️ 닉네임을 입력해 주세요. (예: ${cmd} 닉네임)`,
        coolcheck_not_found: (name) => `⚠️ "${name}" 닉네임을 가진 유저를 찾을 수 없습니다.`,
        coolcheck_failed: `⚠️ 쿨타임 정보를 불러올 수 없습니다.`,
        coolcheck_self: `⚠️ 자기 자신의 쿨타임은 조회할 수 없습니다.`,
    },

    // ─── 도움말 ────────────────────────────────────────────────
    help: {
        main:
            `ℹ️ 명령어: 몇화,다음화,첫화,막화,날짜,시간표` +
            `ℹ️ 몇화 사용법: !몇화 64화 / !몇화 20 24 / !몇화 고자라니 [대사검색]` +
            `ℹ️ 대사 검색은 매우 무거운 명령어입니다.`,
        main2:
            `ℹ️ 개인쿨타임 중 명령어 사용 시 다시 시간을 잽니다.` +
            `ℹ️ 개인쿨타임 확인: !쿨타임 [닉네임]` +
            `ℹ️ 한정된 봇의 채팅수 및 도배 방지를 위해 쿨타임이 엄격하니 양해 바랍니다.`,
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
            `${prefixEmoji} 요청하신 대사는 "${unicodenum}. ${title}" 에 등장하며 ${message} 대사 정확도: ${unicodescore}% ${cooldownMsg}`,
        found_time: (emoji, timestr) => `${emoji} 대사를 말하는 시각은 ${timestr} 분 입니다. `,
        not_in_stream: `스트리밍에는 등장하지 않습니다.`,
        candidates: (aliases) => `(후보: ${aliases})`,
        ambiguous_warning: `⚠️ 여러 에피소드가 검색되었습니다.`,
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

    // ─── 바퀴수 / 완주 횟수 조회 (!바퀴, !회차수) ──────────────
    cycle: {
        current: (
            currentRepeat,
            completedRepeats,
            percent,
            unicodenum,
            title,
            cooldownMsg,
            currentAlias,
            lastEpisode,
            remainingCycleMin,
            remainingEpMin,
        ) =>
            `🔄 현재 ${currentRepeat}트 입니다. ${currentAlias}/${lastEpisode}화 ${remainingEpMin}분 남았습니다. ${cooldownMsg}`.trim(),
    },

    // ─── 시간표 반복문 출력 ───────────────────────────────────
    timetable: {
        first_item: (unicodenum, title) => `${unicodenum}화)${title}`,
        next_item: (header, title) => `→${header})${title}`,
    },

    // ─── 유저 스탯 조회 결과 ───────────────────────────────────
    stats: {
        user_stats: (name, totalMsgs, totalRank, daysCount, todayMsgs, todayRank, todayWatchStr, todayWatchRank, totalWatchStr, totalWatchRank, cooldownMsg) =>
            `📊 [ ${name} 님의 스탯 ] 출석: ${daysCount}일 | 오늘 채팅수: ${todayMsgs}개 (${todayRank}위) | 오늘 참여시간: ${todayWatchStr} (${todayWatchRank}위) | 총 채팅수: ${totalMsgs}개 (${totalRank}위) | 총 참여시간: ${totalWatchStr} (${totalWatchRank}위) ${cooldownMsg}`,
        overview: (todayUsers, todayMsgs, totalUsers, totalMsgs, top100MsgRatio, totalWatchStr, top100WatchRatio, cooldownMsg) =>
            `📊 [전체 통계] 오늘 활동 유저: ${todayUsers}명 | 오늘 채팅: ${todayMsgs}개 | 총 등록 유저: ${totalUsers}명 | 총 누적 채팅: ${totalMsgs}개 (상위 100명 비율: ${top100MsgRatio}%) | 총 시청시간: ${totalWatchStr} (상위 100명 비율: ${top100WatchRatio}%) ※상위 100명이 100%에 가까울수록 유입이 없음을 의미함.${cooldownMsg}`,
        rank_header: (title) => `🏆 [${title}] `,
        rank_item: (rankStr, name, valueStr) => `${rankStr} ${name}`,
        rank_separator: ` | `,
        rank_list: (title, itemsStr, cooldownMsg) => `🏆 [${title}] ${itemsStr} ${cooldownMsg}`.trim(),
        invalid_arg: `⚠️ !스탯 뒤에 다음 단어만 인식합니다. ▶전체: 전체 통계 요약 ▶총시간: 전체 참여시간 순위 ▶총채팅: 전체 채팅수 순위 ▶채팅: 오늘 채팅수 순위 ▶시간: 오늘 참여시간 순위`,
    },

    // ─── 쿨타임 안내 ─────────────────────────────────────────
    cooldown: {
        suffix: (minutes) => `(쿨타임 ${minutes}분)`,
        user_warning: (name, minutes) => `${name} 님은 ${minutes}분 뒤에 명령어 사용 가능합니다.`,
    },

    // ─── 쿨타임 조회 (!쿨타임) ───────────────────────────────
    coolcheck: {
        item_active: (name, timeStr) => `${name} 님은 쿨타임 🕐 ${timeStr} 이 걸려 있습니다.`,
        item_clean: (name) => `${name} 님은 쿨타임이 없습니다.`,
        item_banned: (name) => `${name} 님은 쿨타임이 없습니다.`,
    },

    // ─── 날씨 조회 (!날씨) ───────────────────────────────────
    weather: {
        national_summary: (weatherList, sunStr, cooldownMsg, headerEmoji = '⛅') =>
            `${headerEmoji} [전국 날씨] ${weatherList} | ${sunStr} ${cooldownMsg}`.trim(),
        city_weather: (city, temp, desc, emoji, sunStr, cooldownMsg) =>
            `${emoji} [${city} 날씨] 현재 기온: ${temp}°C (${desc}) | ${sunStr} ${cooldownMsg}`.trim(),
        tomorrow_national_summary: (weatherList, sunStr, cooldownMsg, headerEmoji = '⛅') =>
            `${headerEmoji} [내일 날씨] ${weatherList} | ${sunStr} ${cooldownMsg}`.trim(),
        tomorrow_city_weather: (city, minTemp, maxTemp, desc, emoji, pop, precip, sunStr, cooldownMsg) => {
            const rainInfo = pop > 0 ? (precip > 0 ? `, 강수확률 ${pop}%, 예상 강수량 ${precip}mm` : `, 강수확률 ${pop}%`) : '';
            return `${emoji} [내일 ${city} 날씨] 최저 ${minTemp}°C / 최고 ${maxTemp}°C (${desc}${rainInfo}) | ${sunStr} ${cooldownMsg}`.trim();
        },
        fetch_error: (cooldownMsg) => `⚠️ 날씨 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`,
        invalid_city: (query, cooldownMsg) => `⚠️ "${query}" 지역의 날씨 정보를 찾을 수 없습니다. (예: 서울, 부산, 수원, 강릉, 제주 등) ${cooldownMsg}`,
    },

    // ─── 환율 조회 (!환율, !달러, !엔화, !유로, !위안) ────────
    exchange: {
        summary: (rateListStr, cooldownMsg) => `💱 [실시간 환율] ${rateListStr} ${cooldownMsg}`.trim(),
        single: (title, detailsStr, cooldownMsg) => `${title} ${detailsStr} ${cooldownMsg}`.trim(),
        fetch_error: (cooldownMsg) => `⚠️ 환율 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`.trim(),
    },

    // ─── 가상화폐 시세 (!비트코인, !코인) ─────────────────────
    crypto: {
        summary: (coinListStr, cooldownMsg) => `🪙 [가상화폐 실시간 시세] ${coinListStr} ${cooldownMsg}`.trim(),
        single: (name, symbol, priceStr, changeStr, highLowStr, cooldownMsg) =>
            `🪙 [${name}(${symbol})] 현재가: ${priceStr} (${changeStr})${highLowStr ? ` | ${highLowStr}` : ''} ${cooldownMsg}`.trim(),
        not_found: (query, cooldownMsg) => `⚠️ "${query}" 코인을 찾을 수 없습니다. (예: 비트코인, 이더리움, 리플, SOL, DOGE 등) ${cooldownMsg}`.trim(),
        fetch_error: (cooldownMsg) => `⚠️ 가상화폐 시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`.trim(),
    },

    // ─── 영어사전 (!영어) ─────────────────────────────────────
    english: {
        result: (query, translation, cooldownMsg) => `📖 [영어사전] ${query} → ${translation} ${cooldownMsg}`.trim(),
        missing_word: `⚠️ 한글 또는 영어를 입력하세요. (예: !영어 immune, !영어 산업화)`,
        not_found: (query, cooldownMsg) => `⚠️ "${query}"에 대한 검색 결과를 찾을 수 없습니다. ${cooldownMsg}`.trim(),
        fetch_error: (cooldownMsg) => `⚠️ 사전 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`.trim(),
    },

    // ─── 오늘의 운세 (!운세) ─────────────────────────────────
    fortune: {
        result: (f, cooldownMsg) => {
            const tag = f.detailTag ? ` (${f.detailTag})` : '';
            const iljin = f.iljin ? ` · ${f.iljin}` : '';
            return `${f.zodiacEmoji}[${f.label} 오늘의 운세${iljin}] ${f.luck.color} ${f.luck.star} ${f.luck.label}${tag} | ${f.fortuneText} | 🍀 행운색: ${f.luckyColor} / 행운수: ${f.luckyNumber} / 행운방향: ${f.luckyDir} ${cooldownMsg}`.trim();
        },
        missing_target: `⚠️ 띠, 별자리 또는 출생연도를 입력하세요. (예: !운세 호랑이, !운세 사자자리, !운세 1995년생)`,
    },

    // ─── 주사위 (!주사위) ────────────────────────────────────
    dice: {
        roll_standard: (name, emoji, number, min, max, cooldownMsg) =>
            `🎲 [${name}]님의 주사위 결과: ${emoji} ${number} (${min}~${max}) ${cooldownMsg}`,
        roll_custom: (name, number, min, max, cooldownMsg) =>
            `🎲 [${name}]님의 주사위(${min}~${max}): ${number} ${cooldownMsg}`,
        choose_option: (name, chosen, cooldownMsg) => `🎲 [${name}]님의 선택: "${chosen}" ${cooldownMsg}`,
        invalid_range: `⚠️ 주사위 범위를 올바르게 입력해 주세요. (예: !주사위 100, !주사위 1 100)`,
    },

    // ─── 메뉴 추천 (!점심, !저녁) ───────────────────────────
    menu: {
        lunch: (name, menu, desc, cooldownMsg) =>
            `🍴 [점심 추천] ${name}님, 오늘의 점심 메뉴는 "${menu}" 어떠세요? (${desc}) ${cooldownMsg}`,
        dinner: (name, menu, desc, cooldownMsg) =>
            `🍴 [저녁 추천] ${name}님, 오늘의 저녁 메뉴는 "${menu}" 어떠세요? (${desc}) ${cooldownMsg}`,
        general: (label, name, menu, desc, cooldownMsg) =>
            `🍴 [${label} 추천] ${name}님, 오늘은 "${menu}" 어떠세요? (${desc}) ${cooldownMsg}`,
    },

    // ─── 실시간 검색순위 (!실검) ─────────────────────────────
    searchrank: {
        top10: (rankListStr, cooldownMsg) => `🔥 [실시간 검색순위] ${rankListStr} ${cooldownMsg}`.trim(),
        fetch_error: (cooldownMsg) => `⚠️ 실시간 검색순위를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`.trim(),
    },
};