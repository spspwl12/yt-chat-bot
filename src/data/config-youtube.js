module.exports = {
    // ─── 유튜브 설정 ────────────────────────────────────────
    yt: {
        video_id: "SnVhT306gAg",    // 봇이 입장할 유튜브 라이브 아이디
        send_delay: 3000,           // 메시지 전송 딜레이
        max_retries: 3,             // 메세지 재전송 횟수
        verify_timeout: 10000       // innertube.js의 fetchChat에서 확인 대기 최대 시간
    },
    // ─── 스팸 설정 ──────────────────────────────────────────
    spam: {
        spam_window_sec: 300,       // 봇 경고 해제 시간 s 단위  ( 300 : 5분 )
        spam_max_count: 1,          // 봇이 몇번 경고를 참을건지 ( 이 횟수가 넘어가면 경고시작 )
        spam_warn_limit: 100         // 봇이 몇번 경고를 하는지   ( 이 횟수가 넘어가면 밴됨 )
    },
    // ─── 쿨타임 설정 ────────────────────────────────────────
    cooldown: {
        mode: "global",        // 'global' = 전체 명령어 공유 쿨타임, 'per-command' = 명령어 그룹별 개별 쿨타임
        time_min: 3,                // 쿨타임 시간 (분)
        error_offset_min: 2,        // 에러 발생 시 쿨타임 차감량 (분) → 실질 대기 = time_min - error_offset_min
    },
    // ─── 입력 제한 ──────────────────────────────────────────
    input: {
        text_min_length: 3,         // 명령어 텍스트 최소 길이
        text_max_length: 50,        // 명령어 텍스트 최대 길이
        search_min_length: 4,       // 대사 검색 시 최소 글자 수
        boundary_sec: 20,           // 에피소드 시작/종료 경계 (초) — 이 범위 내에서는 명령어 무시
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
        stale_min: 30,              // 동기화 갱신 판단 기준 (분) — 마지막 요청 후 이 시간 경과 시 재갱신
        tolerance_sec: 60,          // 싱크 허용 오차 (초) — 이 범위 내면 동일 싱크로 판단
        init_delay_ms: 5000,        // 초기 동기화 지연 (ms) — 앱 시작 후 첫 동기화까지 대기
        interval_ms: 60000,         // 동기화 주기 (ms) — 주기적으로 동기화 시도
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
};
