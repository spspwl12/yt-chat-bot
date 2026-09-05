module.exports = {
    // ─── 웹 대시보드 서버 설정 ──────────────────────────────
    web: {
        port: 12345, // 웹 관리자 대시보드 포트 번호
    },
    // ─── 유튜브 설정 ────────────────────────────────────────
    yt: {
        video_id: "l1ivJtlM7gE",    // 봇이 입장할 유튜브 라이브 아이디
        chat_mode: "top",          // 채팅 모드: 'live' = 실시간 채팅 (모든 메시지), 'top' = 주요 채팅 (인기 메시지만)
        send_delay: 3000,           // 메시지 전송 딜레이
        max_retries: 4,             // 메세지 재전송 횟수
        verify_timeout: 10000       // innertube.js의 fetchChat에서 확인 대기 최대 시간
    },
    // ─── 스팸 설정 ──────────────────────────────────────────
    spam: {
        spam_window_sec: 60,       // 봇 경고 해제 시간 s 단위  ( 180 : 3분 )
        spam_max_count: 1,          // 봇이 몇번 경고를 참을건지 ( 이 횟수가 넘어가면 경고시작 )
        spam_warn_limit: 10000,       // 봇이 몇번 경고를 하는지   ( 이 횟수가 넘어가면 밴됨 )
        penalty_duration_hrs: 24,   // 명령어 입력 기록 유지 시간 (기본 12시간)
        penalty_add_sec: 60,         // 명령어 입력 1회당 증가할 경고 해제 시간 (초)
        enable_user_cooldown_warn: false, // 개인 쿨타임 걸린 유저에게 경고 메시지 출력 여부
        group_warns: {              // 명령어 그룹별 부여할 기본 Warns (경고/도배 패널티 수치)
            "greeting, help": 10,
            "episode, time, date, cycle": 0,
            "next, nextnext, first, last": 0,
            "timetable": 10,
            "music": 2,
            "stats": 30,
            "coolcheck": 1,
            "weather, dice, menu, searchrank, exchange, crypto, fortune": 10,
        }
    },
    // ─── 쿨타임 설정 ────────────────────────────────────────
    cooldown: {
        mode: "per-command",        // 'global' = 전체 명령어 공유 쿨타임, 'per-command' = 명령어 그룹별 개별 쿨타임
        time_min: 1,                // 쿨타임 시간 (분)
        error_offset_min: 0,        // 에러 발생 시 쿨타임 차감량 (분) → 실질 대기 = time_min - error_offset_min
        group_times: {              // 명령어 그룹별 개별 쿨타임 (모드가 per-command일 때 적용)
            "greeting, help": 60,
            "episode, time, date, cycle": 1,
            "next, nextnext, first, last": 1,
            "timetable": 2,
            "music": 2,
            "stats": 5,
            "coolcheck": 1,
            "weather, dice, menu, searchrank, exchange, crypto, fortune": 10,
        }
    },
    // ─── 유저 스탯 설정 ──────────────────────────────────────────
    stats: {
        enable: true,                   // 스탯 기능 사용 여부
        db_path: "../data/chat_stats.db", // sqlite3 DB 파일 경로
        watch_threshold_min: 5,        // 라이브 시청시간 판정 기준 (분) - 이 시간 이내 연속 채팅 시 시청시간 누적
        exclude_channel_ids: ["UCtC1Mlh_p9reIImKeNgbQzg"],        // 스탯 집계에서 제외할 channel_id 목록 (봇 계정 등)
        rank_chat_len_limit: 160,       // 랭킹 채팅 출력 최대 글자 수 (기본 160)
        rank_chat_nick_len_limit: 5,   // 랭킹 닉네임 최대 글자 수 (기본 10, 초과 시 ... 표기)
        anti_macro_enable: true,   // 참여시간 파밍 방지 (비슷한 시간간격, 동일/순환 이모지 및 채팅 매크로 감지 시 시청시간 누적 제외)
    },
    // ─── 입력 제한 ──────────────────────────────────────────
    input: {
        enable_greeting: false,     // 봇 인사 기능 사용 여부
        enable_search: true,      // 대사 검색 기능 사용 여부
        text_min_length: 3,         // 명령어 텍스트 최소 길이
        text_max_length: 50,        // 명령어 텍스트 최대 길이
        search_min_length: 2,       // 대사 검색 시 최소 글자 수
        duplicate_history_hours: 0,    // 지정된 시간(시간 단위) 이내 동일 검색어 재사용 시 차단 (0이면 사용 안함)
        duplicate_history_penalty: 1,  // 중복 검색 시 부여할 경고 패널티 점수      
        boundary_sec: 10,           // 에피소드 시작/종료 경계 (초) — 이 범위 내에서는 명령어 무시
    },
    // ─── 대사 검색 민감도 ────────────────────────────────────────
    subtitle_score: {
        min_value: 30,              // 출력 최솟값 (기본값 30)
        warn_base: 30,               // 경고 기본값 (_input.warn에 설정) (기본값 50)
        warn_divisor: 0.2,            // 경고 점수 나눗값 (warn_base + (base - score) / warn_divisor) (기본값 0.2)
        max_candidate_episodes: 5,  // 후보 에피소드 최대 표시 개수
    },
    // ─── 음악 명령어 설정 ────────────────────────────────────────
    music: {
        enable: false,               // 음악 검색 기능 사용 여부
        max_length: 150,            // !음악 (단일) 출력 최대 길이 (이 길이를 초과하면 오래된 곡부터 잘림)
        history_sec: 180,           // 검색어가 없을 때 과거 재생된 음악을 역추적할 최대 시간 (초)
        frequent_penalty_enable: true, // 자주 등장하는 곡(오프닝, 엔딩 등) 우선순위 하향 여부
        frequent_threshold: 20,        // 우선순위 하향 기준 횟수 (해당 횟수 이상 모든 에피소드에서 등장한 곡은 뒤로 밀림)
        min_score: 50,              // 음악 검색 시 결과 일치율 커트라인 (영어 곡명 등 오타 허용치 조절. 높을수록 깐깐해짐)
    },
    // ─── 에피소드 전환 ──────────────────────────────────────
    episode: {
        start: 1,                   // 에피소드 시작 화
        end: 124,                   // 에피소드 마지막 화
        stream_start_time: "2026-07-10 19:00:00", // 최초 스트리밍 방송 시작 일시
    },
    // ─── 에피소드 변경 알림 ──────────────────────────────────
    notice: {
        check_interval_ms: 5000,    // 에피소드 변경 체크 주기 (ms)
        sleep_count: 60,            // 알림 후 재알림 방지 카운트 (체크 횟수 기준)
        delay_base_ms: 5000,       // 알림 전송 지연 기본값 (ms)
        delay_random_ms: 5000,      // 알림 전송 지연 랜덤 범위 (ms) — 최종: base + random * range
        tip_chance: 0.01,           // 팁 메시지 표시 확률 (0.0 ~ 1.0)
    },
    // ─── 시간표 ─────────────────────────────────────────────
    timetable: {
        default_limit: 160,         // 시간표 기본 글자 제한
    },
    // ─── 스케줄 포스터 (schedule_poster.js) ────────────────────────────
    schedule_poster: {
        enable_poster: false,            // 전체 시간표 자동 업로드 켜기/끄기
        initial_delay_sec: 60,          // 봇 시작 후 첫 편성표 게시까지 대기 시간 (초)
        cycle_transition_delay_min: 5,  // 사이클 전환 감지 후 새 편성표 게시까지 대기 시간 (분)
    },
    // ─── AI 설정 (대사 검색 폴백) ────────────────────────────────────
    ai: {
        enable: false,                   // AI 폴백 기능 사용 여부
        url: "http://url:port/q?n={query}",  // GET 요청 URL ({query}는 query_template 결과로 치환)
        query_template: `웹 검색해서 웬만해선 그들을 막을 수 없다 시트콤 "{query}" 몇화`,  // {query}는 사용자 입력으로 치환 후 URL에 삽입
        response_path: "response",   // 응답 JSON에서 실제 문자열이 들어있는 경로 (예: "data.answer", "result.text")
        timeout_ms: 60000,              // AI API 요청 타임아웃 (ms)
    },
};