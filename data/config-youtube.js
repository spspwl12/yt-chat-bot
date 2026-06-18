module.exports = {
    // ─── 유튜브 설정 ────────────────────────────────────────
    yt: {
        video_id: "SnVhT306gAg",    // 봇이 입장할 유튜브 라이브 아이디
        send_delay: 3000,           // 메시지 전송 딜레이
        max_retries: 4,             // 메세지 재전송 횟수
        verify_timeout: 10000       // innertube.js의 fetchChat에서 확인 대기 최대 시간
    },
    // ─── 스팸 설정 ──────────────────────────────────────────
    spam: {
        spam_window_sec: 180,       // 봇 경고 해제 시간 s 단위  ( 180 : 3분 )
        spam_max_count: 1,          // 봇이 몇번 경고를 참을건지 ( 이 횟수가 넘어가면 경고시작 )
        spam_warn_limit: 200,       // 봇이 몇번 경고를 하는지   ( 이 횟수가 넘어가면 밴됨 )
        penalty_duration_hrs: 24,   // 명령어 입력 기록 유지 시간 (기본 12시간)
        penalty_add_sec: 180         // 명령어 입력 1회당 증가할 경고 해제 시간 (초)
    },
    // ─── 쿨타임 설정 ────────────────────────────────────────
    cooldown: {
        mode: "global",        // 'global' = 전체 명령어 공유 쿨타임, 'per-command' = 명령어 그룹별 개별 쿨타임
        time_min: 2,                // 쿨타임 시간 (분)
        error_offset_min: 1,        // 에러 발생 시 쿨타임 차감량 (분) → 실질 대기 = time_min - error_offset_min
    },
    // ─── 입력 제한 ──────────────────────────────────────────
    input: {
        enable_greeting: false,         // 봇 인사 기능 사용 여부
        text_min_length: 3,             // 명령어 텍스트 최소 길이
        text_max_length: 50,            // 명령어 텍스트 최대 길이
        enable_search: true,            // 대사 검색 기능 사용 여부
        search_min_length: 2,           // 대사 검색 시 최소 글자 수
        duplicate_history_hours: 24,    // 지정된 시간(시간 단위) 이내 동일 검색어 재사용 시 차단 (0이면 사용 안함)
        duplicate_history_penalty: 1,  // 중복 검색 시 부여할 강력한 경고 패널티 점수
        boundary_sec: 20,               // 에피소드 시작/종료 경계 (초) — 이 범위 내에서는 명령어 무시
    },
    // ─── 대사 검색 민감도 ────────────────────────────────────────
    subtitle_score: {
        min_value: 20,              // 출력 최솟값
        warn_base: 5,               // 경고 기본값 (_input.warn에 설정)
        warn_divisor: 7.5,            // 경고 점수 나눗값 (warn_base + (base - score) / warn_divisor)
        max_candidate_episodes: 5,  // 후보 에피소드 최대 표시 개수
    },
    // ─── 에피소드 전환 ──────────────────────────────────────
    episode: {
        start: 1,                   // 에피소드 시작 화
        end: 293,                   // 에피소드 마지막 화
    },
    // ─── 동기화 ─────────────────────────────────────────────
    sync: {
        tolerance_sec: 60,          // 싱크 허용 오차 (초) — 이 범위 내면 동일 싱크로 판단
        min_consecutive: 4,         // 연속 일치 판정에 필요한 최소 샘플 수 (2 이상)
        init_delay_ms: 5000,        // 초기 동기화 지연 (ms) — 데몬 DB 로드 후 다운로더 시작까지 대기
        segment_duration: 20,       // 세그먼트 길이 (초) — yt-dlp로 캡처할 클립 길이
        restart_delay_ms: 3000,     // 재시작 대기 (ms) — yt-dlp 또는 데몬 비정상 종료 시
        max_restart_count: 30,      // 최대 재시작 횟수 — 초과 시 60초 대기 후 카운터 리셋
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
        default_limit: 130,         // 시간표 기본 글자 제한
    },
    // ─── 스케줄 포스터 (schedule_poster.js) ────────────────────────────
    schedule_poster: {
        enable_poster: false,            // 전체 시간표 자동 업로드 켜기/끄기
        initial_delay_sec: 60,          // 봇 시작 후 첫 편성표 게시까지 대기 시간 (초)
        cycle_transition_delay_min: 5,  // 사이클 전환 감지 후 새 편성표 게시까지 대기 시간 (분)
    },
    // ─── AI 설정 (대사 검색 폴백) ────────────────────────────────────
    ai: {
        enable: true,                   // AI 폴백 기능 사용 여부
        url: "http://url:port/q?n={query}",  // GET 요청 URL ({query}는 query_template 결과로 치환)
        query_template: `웹 검색해서 웬만해선 그들을 막을 수 없다 시트콤 "{query}" 몇화`,  // {query}는 사용자 입력으로 치환 후 URL에 삽입
        response_path: "response",   // 응답 JSON에서 실제 문자열이 들어있는 경로 (예: "data.answer", "result.text")
        timeout_ms: 60000,              // AI API 요청 타임아웃 (ms)
    },
};
