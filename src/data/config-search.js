module.exports = {
    ffmpeg: {
        ffmpegPath: "./data/ffmpeg.exe",   // FFmpeg 실행 파일 경로
        ffprobePath: "./data/ffprobe.exe", // FFprobe 실행 파일 경로 (영상 정보 분석용)
        inputOptions: []                   // 추가 입력 옵션
    },
    ytdlp: {
        path: "./data/yt-dlp.exe",                  // yt-dlp 실행 파일 경로 (유튜브 영상 다운로드용)
        output: "./data/__livefe20e28dced625646.mp4" // 다운로드할 영상의 임시 저장 경로
    },
    searcher: {
        path: "./data/searcher.exe",                                // C++ 등 외부 검색 엔진 실행 파일 경로
        livemp4_path: "./data/__livefe20e28dced625646.mp4",         // 현재 라이브 영상 조각의 경로
        lastquery_path: "./data/lastquery.json",                    // 가장 최근의 영상/에피소드 정보를 저장하는 파일
        youtube_url: "https://www.youtube.com/watch?v=SnVhT306gAg", // 트래킹할 유튜브 라이브 채널 주소
        commandLine: [                                              // 검색 엔진(searcher.exe)에 전달할 인자 배열
            "./data/__livefe20e28dced625646.mp4",                     // 입력영상 경로
            "./data/video-fingerprints.json",                         // DB파일 경로
            "30",                                                     // 처리시간(초) 등
            "./data/config.json",                                     // 설정파일 경로 (※주의: C++ searcher가 만약 json만 읽는다면 이 부분 변경이 필요할 수 있습니다)
            "16"                                                      // 프레임수 등
        ]
    },
    extraction: {
        fps: 2,          // 초당 추출할 프레임 수
        width: 64,       // 지문 추출용 썸네일 너비
        height: 64,      // 지문 추출용 썸네일 높이
        crop: {
            enabled: true, // 크롭 활성화 여부 (방송 로고 등을 제외하고 화면만 분석할 때 사용)
            x: 215,        // 크롭 시작 X 좌표
            y: 0,          // 크롭 시작 Y 좌표
            w: 1490,       // 크롭 너비
            h: 1080        // 크롭 높이
        },
        videoExtensions: [ // 분석 대상 동영상 확장자 목록
            ".mp4",
            ".avi",
            ".mkv",
            ".mov",
            ".wmv",
            ".flv",
            ".webm",
            ".ts"
        ]
    },
    phash: {
        resizeWidth: 64,  // pHash 계산을 위한 리사이즈 너비
        resizeHeight: 64, // pHash 계산을 위한 리사이즈 높이
        dctSize: 64,      // 영상 픽셀 분석용 DCT 크기
        lowFreqSize: 16,  // 압축/해시 대상 저주파수 크기
        hashBits: 256     // 생성할 해시 비트 수
    },
    matching: {
        hammingThreshold: 30, // 이미지 일치 판단을 위한 해밍 거리 최소 기준값 (낮을수록 더 똑같아야 일치로 판정)
        topN: 5,              // 일치하는 결과의 최대 반환 개수
        earlyExit: true       // 일치 조건 충족 시 완전 검색 없이 즉시 종료 활성화 여부
    },
    performance: {
        workerCount: 0,         // 멀티스레드/워커 타스크 개수 (0 = 시스템 코어 개수에 맞춤)
        batchSize: 100,         // 한 번에 처리할 배치 크기
        maxConcurrentVideos: 2  // 동시 분석할 최대 영상 개수
    },
    paths: {
        fingerprintDb: "./data/video-fingerprints.json", // 영상 DB(핑거프린트) 파일 데이터 저장/로드 경로
        tempDir: "./data/temp_frames"                    // 중간 이미지/프레임 저장용 임시 폴더 위치
    }
};
