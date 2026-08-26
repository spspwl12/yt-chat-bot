module.exports = {
    ffmpeg: {
        ffmpegPath: "../data/ffmpeg.exe",   // FFmpeg 실행 파일 경로
        ffprobePath: "../data/ffprobe.exe", // FFprobe 실행 파일 경로 (영상 정보 분석용)
        inputOptions: []                   // 추가 입력 옵션
    },
    ytdlp: {
        path: "../data/yt-dlp.exe", // yt-dlp 실행 파일 경로 (유튜브 영상 다운로드용)
        logLevel: "error",            // yt-dlp 로그 출력 수준: "all" | "warning" | "error" | "none"
        // 추가 전달할 yt-dlp CLI 인자 배열 (예: ["--cookies", "../data/cookies.txt"])
        commandLine: [
            "-f", "b[height<=1080]/bv",
            "-o", "-",
            "--no-part",
            "--js-runtimes", "node",
            //"--list-formats",
            //"--cookies", "../data/cookies.txt",
            //"--fragment-retries", "infinite",
            //"--extractor-args", "youtube:player-client=default",
            //"--js-runtimes", "node",
            //"--force-ipv4"
        ]
    },
    searcher: {
        path: "../data/searcher.exe",                                // C++ 등 외부 검색 엔진 실행 파일 경로
        segmentDir: "../data/seg",                                   // 세그먼트 파일 저장 디렉토리
        lastquery_path: "../data/lastquery.json",                   // 가장 최근의 영상/에피소드 정보를 저장하는 파일
        youtube_url: "https://www.youtube.com/watch?v=l1ivJtlM7gE", // 트래킹할 유튜브 라이브 채널 주소
        commandLine: [                                              // 검색 엔진(searcher.exe)에 전달할 인자 배열
            "../data/video-fingerprints.json",                         // DB파일 경로
            "30",                                                     // 처리시간(초) 등
            "../data/config.json",                                     // 설정파일 경로 (※주의: C++ searcher가 만약 json만 읽는다면 이 부분 변경이 필요할 수 있습니다)
            "16"                                                      // 프레임수 등
        ]
    },
    // ─── 동기화 ─────────────────────────────────────────────
    sync: {
        tolerance_sec: 60,          // 싱크 허용 오차 (초) — 이 범위 내면 동일 싱크로 판단
        min_consecutive: 6,         // 연속 일치 판정에 필요한 최소 샘플 수 (2 이상; 기본값: 4)
        init_delay_ms: 5000,        // 초기 동기화 지연 (ms) — 데몬 DB 로드 후 다운로더 시작까지 대기
        segment_duration_min: 4,    // 세그먼트 최소 길이 (초) - 중복/유사 무시 대용
        segment_duration_max: 20,   // 세그먼트 최대 길이 (초) — yt-dlp로 캡처할 클립 길이
        restart_delay_ms: 60000,     // 재시작 대기 (ms) — yt-dlp 또는 데몬 비정상 종료 시 (기본값 3000)
        max_restart_count: 30,      // 최대 재시작 횟수 — 초과 시 60초 대기 후 카운터 리셋
    },
    extraction: {
        fps: 30,          // 초당 추출할 프레임 수
        width: 64,       // 지문 추출용 썸네일 너비
        height: 64,      // 지문 추출용 썸네일 높이
        crop: {
            enabled: true, // 크롭 활성화 여부 (방송 로고 등을 제외하고 화면만 분석할 때 사용)
            x: 256,        // 크롭 시작 X 좌표
            y: 0,          // 크롭 시작 Y 좌표
            w: 1415,       // 크롭 너비
            h: 1070        // 크롭 높이
        }
    },
    phash: {
        resizeWidth: 64,  // pHash 계산을 위한 리사이즈 너비
        resizeHeight: 64, // pHash 계산을 위한 리사이즈 높이
        dctSize: 64,      // 영상 픽셀 분석용 DCT 크기
        lowFreqSize: 16,  // 압축/해시 대상 저주파수 크기
        hashBits: 256     // 생성할 해시 비트 수
    },
    matching: {
        hammingThreshold: 40, // 이미지 일치 판단을 위한 해밍 거리 최소 기준값 (낮을수록 더 똑같아야 일치로 판정)
        topN: 10,              // 일치하는 결과의 최대 반환 개수
        earlyExit: true       // 일치 조건 충족 시 완전 검색 없이 즉시 종료 활성화 여부
    },
    watchdog: {
        // ─── Watchdog (phash 파이프라인 무응답 감지 및 자동 재시작) ────────────────
        enable: true, // Watchdog 전체 활성화 여부 (false = 이하 모든 항목 무시)
        downloader_timeout_ms: 120000, // 이 시간(ms) 동안 새 세그먼트가 도착하지 않으면 yt-dlp + ffmpeg 파이프라인 강제 재시작 (기본 2분)
        searcher_timeout_ms: 90000, // 이 시간(ms) 동안 검색 결과(stdout)가 오지 않으면 searcher.exe 데몬을 강제 종료 후 재시작 (기본 1분 30초)
    },
};