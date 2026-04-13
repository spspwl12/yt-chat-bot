# 🤖 YouTube 실시간 채팅 봇 (웬만해선 그들을 막을 수 없다)

YouTube 라이브 스트리밍 채팅방에서 **회차 안내**, **대사 검색**, **시간표 조회** 등 다양한 명령어에 자동 응답하는 봇입니다.  
pHash (Perceptual Hash) 기반 영상 핑거프린팅으로 **현재 방영 중인 회차를 자동 인식**하고, 편집(컷) 구간을 반영한 **정확한 시간 계산**을 수행합니다.

> **npm install 없이** 순수 Node.js으로 동작하며, PM2로 관리됩니다.

---

## ✨ 주요 기능

### 🎬 실시간 스트리밍 & 회차 인식
- **단일 파이프라인 다운로드:** `yt-dlp`와 `ffmpeg`를 파이프 통신으로 연결해 수시로 프로세스를 띄우는 오버헤드를 없애고 20초 단위 세그먼트를 매끄럽게 추출
- **데몬 모드 검색 엔진:** C언어로 작성된 pHash 엔진(`searcher.exe`)이 백그라운드 데몬으로 상주하며 로드된 DB를 캐싱해 빛의 속도로 파일 매칭 수행
- 현재 방영 중인 회차와 시점(초 단위)을 자동 인식 및 과반수(다수결) 검증
- `edit_time`(편집된 구간) 반영으로 실제 스트리밍 재생 시간에 맞추어 정확도 보정

### 📜 자막 기반 대사 검색 ( 선택 )
- SBS 공식 사이트의 자막 데이터를 활용한 대사 검색
- **9종 한국어 오타/구어체 자동 정규화** (경음↔평음, 격음↔평음, ㅐ↔ㅔ, ㅗ↔ㅜ, ㅘ↔ㅝ 등)
- 오타 허용 및 유사도 기반 랭킹 (Jamo 분해 + 발음 정규화 + relaxed 비교 4중 레이어)
- 자모/발음/relaxed 사전 캐싱으로 검색 속도 최적화
- 검색된 대사의 등장 예정 시간 계산

### 🛡️ 도배 방지 & 자동 차단
- 슬라이딩 윈도우 기반 도배 감지 (기본: 5분 / 1회 초과 시 경고)
- 누적 경고 20회 도달 시 YouTube 채팅 자동 차단 (InnerTube API)
- 비속어 필터링
- 대사 검색 오·남용 시 가중 페널티 부여

### 🖥️ 웹 대시보드 (컨트롤 패널)
- `http://localhost:12345` 에 접속해 봇 상태 실시간 모니터링
- **실시간 채팅 스트리밍** 및 사용자 원클릭 밴/차단
- 대사 검색 로그 및 명령어 사용 내역 실시간 확인
- 스팸(도배) 경고 목록 관리 및 봇 챗봇 응답 음소거(Mute) 기능 지원
- 서버 설정 즉시 변경 (config-youtube.js 실시간 반영)

### 🔐 InnerTube HTTP/2 API
- YouTube InnerTube API 직접 호출 (**API 할당량 제한 없음**)
- HTTP/2 프로토콜 사용 (Chrome과 동일)
- SAPISIDHASH 인증 + Cookie Jar 자동 갱신
- Protobuf sendParams 직접 생성 (만료 없음)
- 메시지 전송 큐 + 재시도 + fetchChat 검증 (쉐도우 필터링 대응)

---

## 📋 사전 준비

| 항목 | 설명 |
|------|------|
| [Node.js](https://nodejs.org/) | v20 이상 |
| [PM2](https://pm2.keymetrics.io/) | `npm install -g pm2` |
| [FFmpeg / FFprobe](https://ffmpeg.org/) | 영상 다운로드 및 분석 (사전 빌드된 exe 파일 포함) |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 라이브 스트림 클립 다운로드 (사전 빌드된 exe 파일 포함) |
| C 컴파일러 | 검색 엔진 빌드 시 필요 (사전 빌드된 exe 파일 포함) |

---

## 🚀 사용법

### 설정
※ 이 설정은 웬만해선 그들을 막을 수 없다 라이브 방송을 예로 합니다.
1. `src/data/session.json`에 YouTube 계정 쿠키 설정 ( 유튜브 로그인 후 F12 눌러서 Cookie: 값을 설정 )
2. `src/data/config-youtube.js`에서 `video_id` 및 기타 설정 조정
3. `src/data/config-search.js`에서 검색 엔진 경로 및 핑거프린트 DB 경로 설정

### 봇 실행

```bash
# PM2로 실행
pm2 start ecosystem.config.cjs

# 로그 확인
pm2 logs yt-chat-bot

# 중지 / 재시작
pm2 stop yt-chat-bot
pm2 restart yt-chat-bot
```

### 직접 실행

```bash
node src/index.js
```

---

## 💬 채팅 명령어

> **명령어 접두사 `!`는 앞뒤 공백을 허용합니다.**  
> `!몇화`, `! 몇화`, ` ! 몇화` 모두 동일하게 인식됩니다.

### 회차 정보

| 명령어 | 설명 | 출력 |
|--------|------|------|
| `!몇화` | 현재 방영 중인 회차 + 남은 시간 | `🎬 현재 회차는 "𝟸𝟻𝟾. ..." 이고 🕐 남은 시간은 00:09:08 초 입니다.` |
| `!몇화 <숫자>` | 특정 회차의 방영 예정 시간 | `🔜 예정 회차는 "𝟸𝟻𝟾. ..." 이고 🕐 예정 시간은 21:23 분 입니다.` | 
| `!몇화 <대사>` | 대사가 등장하는 회차 + 예정 시간 | `📜 요청하신 대사는 "𝟸𝟻𝟾. ..." 에 등장하며 🕐 등장 시간은 21:23 분 입니다.` |
| `!다음화` | 다음 방영 예정 회차 | `👉🏻 다음 회차는 " ... " 이고 🕐 예정 시간은 21:23 분 입니다.` |
| `!마지막화` | 마지막 회차 방영 예정 시간 | `🔜 예정 회차는 "𝟸𝟻𝟾. ..." 이고 🕐 예정 시간은 21:23 분 입니다.` |
| `!시간표` | 다음 회차부터의 방영 일정 | [09:08]회차제목1/회차제목2->[10:35]회차제목1/회차제목2 ... |

> **별칭:** `!몇회`, `!몇편`, `!화차`, `!지금몇화` 등 다양한 동의어 지원

### 기타

| 명령어 | 설명 |
|--------|------|
| `!안녕` / `!인사` / `!하이` | 인사 응답 |
| `!도움` / `!명령어` | 명령어 목록 안내 |
| `!건의 <내용>` | 개발자에게 피드백 전달 |

---

## ⚙️ 설정

### config-youtube.js

```js
{
    yt: { video_id, send_delay, max_retries, verify_timeout },
    spam: { spam_window_sec, spam_max_count, spam_warn_limit },
    cooldown: { mode, time_min, error_offset_min },
    input: { text_min_length, text_max_length, search_min_length, boundary_sec },
    subtitle_score: { base, length_weight, min_threshold, ... },
    episode: { start, end },
    sync: { stale_min, tolerance_sec, init_delay_ms, interval_ms },
    notice: { check_interval_ms, sleep_count, delay_base_ms, ... },
    timetable: { chat_limit, default_limit }
}
```

| 카테고리 | 주요 설정 | 기본값 | 설명 |
|----------|-----------|--------|------|
| **쿨타임** | `cooldown.time_min` | `3` | 명령어 사용 간격 (분) |
| **쿨타임** | `cooldown.mode` | `"global"` | `"global"` 또는 `"per-command"` |
| **스팸** | `spam.spam_warn_limit` | `20` | 경고 누적 후 자동 차단 |
| **동기화** | `sync.interval_ms` | `60000` | 영상 핑거프린트 동기화 주기 |
| **에피소드** | `episode.end` | `293` | 마지막 회차 번호 |
| **경계** | `input.boundary_sec` | `20` | 에피소드 시작/종료 20초 전후 명령어 무시 |

### config-search.js

```js
{
    ffmpeg: { ffmpegPath, ffprobePath, inputOptions },
    ytdlp: { path, output },
    searcher: { path, livemp4_path, lastquery_path, youtube_url, commandLine },
    extraction: { fps, width, height, crop: { enabled, x, y, w, h }, videoExtensions },
    phash: { resizeWidth, resizeHeight, dctSize, lowFreqSize, hashBits },
    matching: { hammingThreshold, topN, earlyExit },
    performance: { workerCount, batchSize, maxConcurrentVideos },
    paths: { fingerprintDb, tempDir }
}
```

| 카테고리 | 주요 설정 | 기본값 | 설명 |
|----------|-----------|--------|------|
| **추출** | `extraction.fps` | `2` | 초당 추출 프레임 수 |
| **추출** | `extraction.crop.enabled` | `true` | 방송 로고 등 제외용 크롭 활성화 |
| **pHash** | `phash.lowFreqSize` | `16` | DCT 저주파 영역 크기 (해시 비트 수 결정) |
| **매칭** | `matching.hammingThreshold` | `30` | Hamming 거리 임계값 (낮을수록 엄격) |
| **매칭** | `matching.topN` | `5` | 매칭 결과 최대 반환 개수 |
| **성능** | `performance.workerCount` | `0` | 워커 수 (0 = CPU 코어 수 자동) |
| **경로** | `paths.fingerprintDb` | `"./data/video-fingerprints.json"` | 핑거프린트 DB 경로 |

---

## 🔧 아키텍처

### 시스템 흐름

```
[비디오 파이프라인]
라이브 스트림 → yt-dlp (stdout) → FFmpeg (stdin) → 20초 세그먼트(.mp4) 생성
                                                            ↓
[검색 데몬]                                             searcher.exe (상시구동 데몬)
                                                            ↓ 매칭 결과 JSON
[데이터 흐름]                                            search.js (회차 분석)
YouTube InnerTube API ← commands.js (명령어)  ←-----------┘
       ↕                        ↕                                   |
  채팅 읽기/쓰기          spam-guard.js (도배 차단)                event-bus.js
       ↓                                                            ↓
chat-history.js  ←-----------  웹 대시보드 (web-server.js)  <--------
```

### 핵심 모듈

| 파일 | 역할 |
|------|------|
| `src/index.js` | 메인 폴링 루프 + PM2 라이프사이클 + 서비스 시작점 |
| `src/innertube.js` | InnerTube HTTP/2 API (인증, 채팅 수신/발신, 차단) |
| `src/commands.js` | 명령어 파싱, 쿨타임, 에피소드 알림, 대사 검색 |
| `src/video-matcher/search.js` | 매칭 결과 처리, 편집 시간(edit_time) 보정 통합 모듈 |
| `src/video-matcher/live-downloader.js` | yt-dlp + ffmpeg 단일 파이프라인 (20초 스트림 분할) |
| `src/video-matcher/live-searcher.js` | searcher.exe 데몬 매니저 (큐 기반 연속 검색 처리) |
| `src/video-matcher/textsearcher.js` | 자막 유사도 검색 엔진 (Jamo 기반, 9종 오타 정규화, 사전 캐싱 최적화) |
| `src/video-indexer/indexer.js` | 영상 디렉토리 → 핑거프린트 DB 생성 |
| `src/video-indexer/searcher.js` | Node.js 기반 핑거프린트 검색기 (단일/멀티스레드) |
| `src/spam-guard.js` | 슬라이딩 윈도우 도배 감지 + 자동 차단 |
| `src/web-server.js` | 웹 대시보드 백엔드 (SSE 실시간 로그, 밴/차단/설정 관리) |
| `src/chat-history.js` | 대시보드용 최근 유튜브 채팅 버퍼 캐시 |
| `src/event-bus.js` | 모듈 간 의존성을 낮추는 전역 이벤트 큐 (검색/명령어 로그 전송) |
| `src/greeting.js` | 인사 응답 생성 |
| `src/func.js` | 유틸리티 함수 (시간 변환, 텍스트 포맷팅 등) |
| `csource/searcher/` | C언어 pHash 검색 엔진 소스 |

### 데이터 파일

| 파일 | 설명 |
|------|------|
| `video-info.json` | 전 회차 메타데이터 (제목, 시간, edit_time 등) |
| `video-fingerprints.json` | 전 회차 pHash 핑거프린트 DB (~80MB), `indexer.js`로 생성 |
| `video-sub.json` | 전 회차 자막 데이터 (~13MB) |
| `lastquery.json` | 마지막 영상 매칭 결과 (동기화 상태 유지) |
| `session.json` | YouTube 인증 쿠키 |
| `youtube-banned.json` | 차단된 사용자 목록 |
| `profanity-list.js` | 비속어 필터링 목록 (대사 검색 시 사용) |

---

## 📁 디렉토리 구조

```
youtube-chat-bot/
├── csource/
│   └── searcher/             # C언어 pHash 검색 엔진
│       ├── searcher.c
│       ├── phash.c / phash.h
│       └── stb_image.h
├── src/
│   ├── index.js              # 메인 진입점
│   ├── innertube.js          # InnerTube HTTP/2 API
│   ├── commands.js           # 명령어 핸들러
│   ├── greeting.js           # 인사 응답
│   ├── spam-guard.js         # 도배 방지
│   ├── web-server.js         # 웹 대시보드 서버
│   ├── chat-history.js       # 실시간 채팅 버퍼 
│   ├── event-bus.js          # 전역 이벤트 중계
│   ├── func.js               # 유틸리티 함수
│   ├── path.js               # 경로 헬퍼
│   ├── public/               # 웹 대시보드 프론트엔드 (HTML/CSS/JS)
│   ├── video-matcher/        # 영상 매칭 모듈
│   │   ├── search.js         #   시간 계산, 전체 파이프라인 총괄
│   │   ├── live-downloader.js#   yt-dlp + ffmpeg 다운로드 파이프라인
│   │   ├── live-searcher.js  #   searcher.exe 데몬 매니저
│   │   └── textsearcher.js   #   자막 검색 엔진
│   ├── video-indexer/        # 핑거프린트 생성 도구
│   │   ├── indexer.js        #   영상 → 핑거프린트 변환
│   │   ├── extractor.js      #   프레임 추출
│   │   ├── phash.js          #   Node.js pHash 계산
│   │   ├── searcher.js       #   Node.js 기반 핑거프린트 검색기
│   │   ├── search-worker.js  #   워커 스레드 검색 (대규모 DB용)
│   │   ├── worker.js         #   pHash 계산 워커
│   │   └── test-phash.js     #   pHash 테스트
│   └── data/                 # 설정 + 데이터
│       ├── config-youtube.js #   봇 설정
│       ├── config-search.js  #   검색 엔진 설정
│       ├── profanity-list.js #   비속어 필터링 목록
│       ├── video-info.json   #   회차 메타데이터
│       ├── video-fingerprints.json # 핑거프린트 DB
│       ├── video-sub.json    #   자막 DB
│       ├── lastquery.json    #   마지막 매칭 결과
│       ├── youtube-banned.json #  차단 사용자 목록
│       ├── session.json      #   YouTube 인증 쿠키
│       ├── searcher.exe      #   pHash 검색 바이너리
│       ├── ffmpeg.exe        #   FFmpeg
│       ├── ffprobe.exe       #   FFprobe
│       └── yt-dlp.exe        #   yt-dlp
├── ecosystem.config.cjs      # PM2 설정
├── package.json              # 의존성 0개
└── README.md
```

---

## 📜 video-info.json 스키마

각 회차의 메타데이터를 정의합니다.

```json
{
    "alias": "258",
    "name": "258",
    "start_time": "00:00:00",
    "end_time": "00:24:08",
    "edit_time": "[{\"s\":\"00:23:00\",\"e\":\"00:24:08\"}]",
    "duration": 1448.123,
    "title": "에피소드 제목 전체",
    "shorten": "축약제목"
}
```

| 필드 | 설명 |
|------|------|
| `alias` | 회차 번호 (표시용) |
| `name` | 영상 파일명 (핑거프린트 DB 키) |
| `start_time` / `end_time` | 영상 시작/종료 시간 |
| `edit_time` | 편집(컷)된 구간 목록 (JSON 문자열) |
| `duration` | 원본 영상 길이 (초) |
| `title` / `shorten` | 에피소드 제목 (전체/축약) |
| `disable` | `true`면 스킵 (선택) |

### edit_time 처리

`edit_time`은 스트리밍에서 잘린(컷) 구간을 정의합니다.

- **끝 편집**: `edit_time`의 끝이 `end_time`에 닿으면 유효 콘텐츠 종료 시점(`_effectiveEndSec`)이 앞당겨짐
- **시간 계산**: 편집 구간을 제외한 실제 스트리밍 재생 시간(`_streamDurationSec`)을 산출하여 남은 시간 및 예정 시간 계산에 반영

---

## 📜 video-fingerprints.json 스키마

`indexer.js`가 영상 디렉토리를 스캔하여 생성하는 pHash 핑거프린트 데이터베이스입니다.  
`searcher.exe`(C 검색 엔진) 및 `searcher.js`(Node.js 검색기)가 이 파일을 읽어 라이브 클립과 매칭합니다.

```json
{
    "version": 1,
    "config": {
        "fps": 2,
        "resizeWidth": 64,
        "resizeHeight": 64,
        "lowFreqSize": 16
    },
    "createdAt": "2025-01-01T00:00:00.000Z",
    "videos": [
        {
            "filename": "258.mp4",
            "frameCount": 2896,
            "hashes": [
                {
                    "timestamp": 0.5,
                    "hash": "a1b2c3d4..."
                }
            ]
        }
    ]
}
```

| 필드 | 설명 |
|------|------|
| `version` | DB 포맷 버전 |
| `config.fps` | 프레임 추출 시 사용한 초당 프레임 수 |
| `config.resizeWidth` / `resizeHeight` | pHash 계산 시 리사이즈한 해상도 |
| `config.lowFreqSize` | DCT 저주파 영역 크기 (해시 비트 수 = lowFreqSize² - 1) |
| `createdAt` | DB 생성 일시 (ISO 8601) |
| `videos[].filename` | 원본 영상 파일명 (`video-info.json`의 `name`과 매칭) |
| `videos[].frameCount` | 해당 영상에서 추출된 유효 프레임(해시) 수 |
| `videos[].hashes[].timestamp` | 해당 프레임의 영상 내 위치 (초) |
| `videos[].hashes[].hash` | pHash 값 (hex 문자열, 기본 256bit = 64자) |

### 매칭 원리

1. 라이브 스트림에서 20초 클립을 다운로드 → FFmpeg로 프레임 추출 → 각 프레임의 pHash 계산
2. DB의 모든 영상 해시와 **Hamming Distance** 비교 (임계값 이하면 매칭)
3. 매칭 수(match_count)가 가장 많은 영상이 현재 방영 중인 회차로 판정
4. 매칭된 프레임의 `timestamp`(DB)와 클립 내 프레임 위치로 현재 시점(초) 산출

---

## 📜 video-sub.json 스키마

SBS 공식 사이트에서 수집한 전 회차 자막 데이터입니다.  
회차별(`name` 키)로 자막 배열을 가지며, 대사 검색(`textsearcher.js`)에 사용됩니다.

```json
{
    "258": [
        {
            "start": "00:01:23",
            "end": "00:01:26",
            "text": "자막 텍스트"
        }
    ]
}
```

| 필드 | 설명 |
|------|------|
| 키 (예: `"258"`) | 회차 번호 (`video-info.json`의 `name`과 매칭) |
| `start` / `end` | 자막 표시 시작/종료 시간 (`HH:MM:SS`) |
| `text` | 자막 텍스트 (대사 내용) |

---

## 📜 lastquery.json 스키마

마지막 pHash 매칭 결과를 저장하여, 봇이 재시작되어도 현재 방영 상태를 유지합니다.

```json
{
    "retry": 0,
    "index": 135,
    "now": 859.5,
    "requestTime": 1773625075993
}
```

| 필드 | 설명 |
|------|------|
| `retry` | 재시도 횟수 |
| `index` | 현재 방영 중인 회차의 `videoInfo` 배열 인덱스 |
| `now` | 해당 회차 내 현재 재생 위치 (초) |
| `requestTime` | 매칭 요청 시각 (Unix ms) — 경과 시간 계산의 기준점 |

---

## ⚠️ 주의 사항

- InnerTube API는 비공식 API이며 YouTube 정책 변경에 영향을 받을 수 있습니다.
- yt-dlp 역시 YouTube 정책 변경에 의해 영향을 받을 수 있습니다. ([여기](https://github.com/yt-dlp/yt-dlp)로 들어가서 최신 yt-dlp를 다운받으세요.)
---

## 📄 라이선스

[MIT License](LICENSE)
