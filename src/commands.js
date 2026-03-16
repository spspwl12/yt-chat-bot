const search_lib = require('./video-matcher/search.js');
const TextSearchEngine = require('./video-matcher/textsearcher.js');
const greeting_lib = require('./greeting.js');
const schCfg = require('./data/config-search.js');
const subtitles = require('./data/video-sub.json');
const lastQuery = require(schCfg.searcher.lastquery_path);
const fs = require('fs');
const { sendChat } = require('./innertube.js');
const { insertSpaces, filterText, toUnicodeNumber, toUnicodeNumber2,
    toHHMMSS, fromHHMMSS, formatDate, getClockEmoji } = require('./func.js');

const profanitySet = require('./data/profanity-list.js');
const videoInfo = search_lib.videoInfo;
const searcher = new TextSearchEngine(subtitles);
const retryPattern = ["$1", "$1 ", " $1", "$1", "$1"];

// ─── 설정 로드 (data/config-youtube.json) ─────────────────────
const cfg = require('./data/config-youtube.js');
// ──────────────────────────────────────────────────────────

let delayChatTime = 0;                 // global 모드용
const delayChatTimeMap = new Map();    // per-command 모드용
const tempQuery = [];

// 명령어를 그룹으로 분류 (같은 그룹의 alias는 쿨타임 공유)
const COMMAND_GROUPS = {
    'greeting': ['!안녕', '!인사', '!하이', '!헬로', '!ㅎㅇ', '!gd', '!반가워'],
    'help': ['!도움', '!안내', '!소개', '!헬프', '!가이드', '!도움말', '!사용법', '!설명서', '!명령어'],
    'episode': ['!대사', '!몇회', '!몇화', '!몇편', '!편수', '!화차', '!지금몇화', '!지금몇회', '!회차'],
    'timetable': ['!시간표', '!편성표'],
    'next': ['!다음', '!다음화', '!다음회'],
    'last': ['!마지막', '!마지막화', '!마지막회'],
    'suggest': ['!건의'],
};

/**
 * 주어진 사용자 입력 명령어를 해당하는 명령어 그룹 식별자로 변환
 * @param {string} cmd - 사용자가 입력한 명령어 (예: '!안녕')
 * @returns {string} 명령어 그룹 식별자 (예: 'greeting') 또는 매칭되는 그룹이 없을 시 원본 명령어 반환
 */
function getCommandGroup(cmd) {
    for (const [group, cmds] of Object.entries(COMMAND_GROUPS)) {
        if (cmds.includes(cmd)) return group;
    }
    return cmd;
}

/**
 * 특정 명령어가 현재 쿨타임(사용 제한) 상태인지 확인
 * @param {string} cmd - 확인 대상 명령어
 * @returns {boolean} 쿨타임 중이면 true, 사용 가능하면 false 반환
 */
function isCooldown(cmd) {
    const cooldownMs = 1000 * 60 * cfg.cooldown.time_min;
    if (cfg.cooldown.mode === 'global') {
        return Date.now() - delayChatTime <= cooldownMs;
    }
    const group = getCommandGroup(cmd);
    const lastTime = delayChatTimeMap.get(group) || 0;
    return Date.now() - lastTime <= cooldownMs;
}

/**
 * 명령어 사용 직후 쿨타임을 설정 (다음 사용 가능 시간 갱신)
 * @param {string} cmd - 사용한 명령어
 * @param {number} offsetMs - 쿨타임 시간에 더하거나 뺄 밀리초 (예외/오류 시 실질 대기시간 경감을 위해 사용)
 */
function setCooldown(cmd, offsetMs = 0) {
    const now = Date.now() + offsetMs;
    if (cfg.cooldown.mode === 'global') {
        delayChatTime = now;
    } else {
        delayChatTimeMap.set(getCommandGroup(cmd), now);
    }
}

/**
 * 유튜브 채팅 명령어 메인 핸들러
 * 사용자가 입력한 메시지를 분석하여 명령어를 실행하고 응답 메시지를 생성
 * 
 * @param {number} type - 처리 유형 (0이면 쿨타임 강제 초기화, 1이면 일반 채팅 명령어 처리)
 * @param {string} text - 채팅 메시지 내용
 * @param {string} displayName - 채팅 작성자 닉네임
 * @param {object} _input - 스팸 가중치(warn) 등 함수 실행 후 상태를 참조 복사로 담을 객체
 * @returns {string|object|null} 전송할 채팅 텍스트 또는 {msg, proc} 객체 반환, 명령어 무시 시 null 반환
 */
async function handleCommand(type, text, displayName, _input) {
    // 0. 쿨타임 강제 초기화 (type이 0인 경우 봇 재시작이나 관리자 트리거로 인식)
    if (type === 0) {
        delayChatTime = 0;
        delayChatTimeMap.clear();
        return null;
    }

    // 2. 메시지 기본 유효성 검증 (입력 텍스트 타입 확인 및 글자 수 제한)
    if (!text || typeof text !== "string" ||
        text.length < cfg.input.text_min_length || text.length > cfg.input.text_max_length)
        return null;

    // 3. 명령어 접두사('!') 여부 확인
    if (!text.startsWith('!'))
        return null;

    // 4. 공백을 기준으로 명령어(cmd)와 전달 인자(args) 문자열 파싱 분리
    const parts = text.trim().split(/ (.+)/);
    const cmd = parts[0];
    const args = parts.slice(1);

    // 5. 사용하려는 명령어가 현재 쿨타임(도배 방지 대기시간) 상태인지 체크
    if (isCooldown(cmd))
        return null;

    // 6. 유사어나 동의어(alias)를 통합 그룹 식별자(group)로 묶어 변환 처리
    const group = getCommandGroup(cmd);

    // 7. 시스템에 등록되지 않은 무효한 명령어 그룹이면 조기에 무시
    if (group === cmd)
        return null;

    // 8. 단순 봇 인사 명령어
    if (group === 'greeting') {
        setCooldown(cmd);
        return greeting_lib(displayName);
    }

    // 9. 봇 도움말/가이드 출력
    if (group === 'help') {
        setCooldown(cmd);
        return 'ℹ️ 명령어: !몇화, !다음화, !시간표, !건의, !마지막화' +
            'ℹ️ 이 프로그램은 비공식 봇이며, SBS와는 아무런 관련이 없습니다. ' +
            'ℹ️ 명령은 3분마다 가능합니다. (도배 방지) ';
    }

    // 10. 방영/회차/대사 정보 조회 명령어 (가장 복합적인 로직)
    if (group === 'episode') {
        const rtn = getEpisodeInfo();

        if (!rtn) {
            // 정보 로드 실패 시, 쿨타임 일부 환원 후 에러 메시지 반환
            setCooldown(cmd, -(1000 * 60 * cfg.cooldown.error_offset_min));
            return `⚠️ 잠시 후 다시 시도해 주세요.`;
        }

        // 10-1. 이전 회차가 끝나고 다음 회차가 시작되기 직전 과도기/경계 시간엔 
        // 부정확한 정보 방지를 위해 명령어 처리 일시 정지
        if (Math.abs(rtn.end - rtn.now) <= cfg.input.boundary_sec || rtn.now <= cfg.input.boundary_sec)
            return null;

        // 10-2. 별도 인자가 없으면(예: '!몇화') 현재 실시간으로 방영 중인 회차와 남은 시간 반환
        if (!args || args.length <= 0) {
            setCooldown(cmd);
            return printNowEpisode(rtn);
        }

        const numbers = args[0].match(/^(\d+)(\S)?/);
        const parseint = numbers ? parseInt(numbers[1], 10) : NaN;

        // 10-3. 숫자가 입력된 경우(예: '!몇화 200화') 해당 숫자의 에피소드 방영 예정 시간 계산 조회
        if (numbers && parseint >= cfg.episode.start && parseint <= cfg.episode.end &&
            (!numbers[2] || "화회".includes(numbers[2]))) {
            setCooldown(cmd);
            return printNumEpisode(rtn, parseint);
        }

        // 10-4. 숫자 형식이 아닌 일반 텍스트가 인자로 넘어왔다고 가정하여 
        // 내부 자막 데이터세트를 기반으로 '대사 검색' 알고리즘 수행
        if (args[0].length < cfg.input.search_min_length) {
            _input.warn = cfg.subtitle_score.warn_base; // 너무 짧은 악의적 검색어엔 페널티 부여
            setCooldown(cmd, -(1000 * 60 * cfg.cooldown.error_offset_min));
            return `⚠️ 대사를 ${cfg.input.search_min_length} 글자 이상 입력하세요. (쿨타임 3분)`;
        }

        // 10-5. 비속어 필터링: 검색어에 비속어가 포함되어 있으면 즉시 차단
        const searchText = filterText(args[0]);
        for (const word of profanitySet) {
            if (searchText.includes(word))
                return null;
        }

        if (_input.ban) {
            _input.warn = cfg.subtitle_score.warn_base;
            return null;
        }

        const searchInfo = searcher.search(args[0]);
        if (searchInfo.length <= 0) {
            _input.warn = cfg.subtitle_score.warn_base; // 결과 없음 페널티
            setCooldown(cmd, -(1000 * 60 * cfg.cooldown.error_offset_min));
            return `⚠️ 대사를 정확히 입력하세요. (쿨타임 3분)`;
        }

        if (searchInfo && searchInfo.length > 0) {
            const validResults = [];
            const removeDup = searchInfo.filter(
                (item, index, self) =>
                    index === self.findIndex(obj => obj.key === item.key)
            );

            for (const result of removeDup) {
                if (validResults.length >= 3) break;

                const matched = result.matchedIndices;
                if (!matched || matched.length === 0) continue;

                const score = result.score;
                // 매칭 점수가 내부 통과 기준을 넘었는지 확인
                if (score > cfg.subtitle_score.min_value) {
                    const key = result.key;
                    const pfSub = subtitles[key][matched[0] - 1]; // 추출된 자막 구간

                    if (pfSub) {
                        console.log("subtitle search ->", key, JSON.stringify(pfSub));

                        const subInfo = videoInfo.find(e => e.name === key);
                        if (!subInfo) continue;

                        const subTime = fromHHMMSS(pfSub.start);
                        const futureDate = search_lib.getFutureDate(subInfo, rtn, subTime);
                        // 에피소드가 짤린 부분(편집된 구간에 해당하는 자막인지 검증)
                        let outOfbounds = subInfo.disable;
                        if (!outOfbounds && subInfo._editParsed) {
                            for (const et of subInfo._editParsed) {
                                if (subTime >= et.s && subTime <= et.e) {
                                    outOfbounds = true;
                                    break;
                                }
                            }
                        }

                        const unicodenum = toUnicodeNumber(subInfo.alias);
                        const unicodescore = toUnicodeNumber('' + score);
                        const timestr = formatDate(futureDate);
                        const emoji = getClockEmoji(timestr);

                        validResults.push({
                            subInfo, outOfbounds, unicodenum, unicodescore, timestr, emoji, score
                        });
                    }
                }
            }

            if (validResults.length > 0) {
                // 부하/스팸 방지를 위해 1위 결과물의 점수에 역비례하게 페널티 차등 책정
                _input.warn = cfg.subtitle_score.warn_base +
                    parseInt((100 - validResults[0].score) / cfg.subtitle_score.warn_divisor);

                setCooldown(cmd);

                if (validResults[0].score >= 100) {
                    const firstResult = validResults[0];

                    // 1위 검색 결과 외에 다른 회차에서 비슷하게 잡힌 대안 후보군 산출
                    const subEpisodeKeys = searchInfo
                        .filter(e => searchInfo[0].key !== e.key && e.score >= firstResult.score)
                        .slice(0, cfg.subtitle_score.max_candidate_episodes)
                        .map(e => e.key);

                    const subEpisodeSet = new Set(subEpisodeKeys);

                    const subEpisodeMatching = videoInfo
                        .filter(e => subEpisodeSet.has(e.name))
                        .map(e => e.alias);

                    const message = (firstResult.outOfbounds ? `스트리밍에는 등장하지 않습니다.` :
                        `${firstResult.emoji} 등장 시간은 ${firstResult.timestr} 분 입니다. `) +
                        `${subEpisodeMatching.length > 0 ? `(후보: ${subEpisodeMatching})` : ''}`;

                    return {
                        msg: `📜 요청하신 대사는 "${firstResult.unicodenum}. ${insertSpaces(
                            firstResult.subInfo.title, retryPattern[0])}" 에 등장하며 ` +
                            `${message} 정확도: ${firstResult.unicodescore}% (쿨타임 3분)`,
                        proc: function (attempt) {
                            return `📜 요청하신 대사는 "${firstResult.unicodenum}. ${insertSpaces(
                                firstResult.subInfo.title, retryPattern[attempt])}" 에 등장하며 ` +
                                `${message} 정확도: ${firstResult.unicodescore}%  (쿨타임 3분)`;
                        }
                    };
                } else {
                    const makeMsg = (attempt) => {
                        const mapped = validResults.map((r, i) => {
                            const rankEmoji = toUnicodeNumber2((i + 1).toString());
                            const title = insertSpaces(r.subInfo.shorten, retryPattern[attempt]);
                            const timeMsg = r.outOfbounds ? `스트리밍X` : `${r.emoji} ${r.timestr}`;
                            return {
                                n: `${rankEmoji} ${r.unicodenum}화 ${title} (${timeMsg.replace(/ /g, '')}) 일치:${r.unicodescore}%`,
                                s: `${rankEmoji} ${r.unicodenum}화 (${timeMsg.replace(/ /g, '')}) 일치:${r.unicodescore}%`
                            };
                        });
                        const WrongMsg = "⚠️ 입력한 대사에 오탈자가 있어 결과가 정확하지 않음.";
                        return {
                            n: `${WrongMsg} ${mapped.map(e => e.n).join(' ')} (쿨타임 3분)`,
                            s: `${WrongMsg} ${mapped.map(e => e.s).join(' ')} (쿨타임 3분)`
                        };
                    };

                    return {
                        msg: makeMsg(0).n,
                        proc: function (attempt) {
                            if (attempt === 1)
                                return makeMsg(attempt).s;
                            else
                                return '⚠️ 출력에 실패했습니다. (쿨타임 3분)'
                        }
                    };
                }
            }
        }

        // 검색 알고리즘을 타기에는 조건이 부족하거나 매칭 실패 시
        _input.warn = cfg.subtitle_score.warn_base;
        setCooldown(cmd, -(1000 * 60 * cfg.cooldown.error_offset_min));
        return `⚠️ 대사를 정확히 입력하세요. (쿨타임 3분)`;
    }

    // 11. 곧 방영될 회차 리스트 목록 요약(시간표) 출력
    if (group === 'timetable') {
        setCooldown(cmd);
        return {
            msg: printTimeTable(retryPattern[0]),
            proc: function (attempt) {
                return printTimeTable(retryPattern[attempt]);
            }
        };
    }

    // 12. 다음 방영 예정 회차 정보 조회
    if (group === 'next') {
        const rtn = getEpisodeInfo();

        if (!rtn) {
            setCooldown(cmd, -(1000 * 60 * cfg.cooldown.error_offset_min));
            return `⚠️ 잠시 후 다시 시도해 주세요.`;
        }

        return printNextEpisode(cmd, rtn);
    }

    // 13. 전 대역 마지막 회차 방영 예정일 조회
    if (group === 'last') {
        const rtn = getEpisodeInfo();

        if (!rtn) {
            setCooldown(cmd, -(1000 * 60 * cfg.cooldown.error_offset_min));
            return `⚠️ 잠시 후 다시 시도해 주세요.`;
        }

        setCooldown(cmd);
        return printNumEpisode(rtn, cfg.episode.end);
    }

    // 14. 봇 건의 및 피드백 로깅
    if (group === 'suggest') {
        setCooldown(cmd);
        return `${displayName} 님, 접수되었습니다. 감사합니다. (쿨타임 3분)`;
    }

    return null;
}

/**
 * C++ 서치 엔진에서 검색된 현재 라이브 영상 싱크 데이터를 
 * 파일과 메모리(lastQuery)에 저장하여 상태를 동기화합니다.
 * @param {object} obj - 새로 찾은 영상 매칭 정보 객체
 */
function copyQuery(obj) {
    ["index", "now", "requestTime"].forEach(key => {
        lastQuery[key] = obj[key];
    });
    tempQuery.length = 0;
    const json = JSON.stringify(lastQuery, null, 4);
    fs.writeFileSync(schCfg.searcher.lastquery_path, json, 'utf-8');
}

/**
 * 최신 동기화된 데이터를 바탕으로 현재 방송 중인 회차와 시점(초)을 계산해 반환
 * @returns {object|null} 진행 중인 에피소드 정보 및 경과 시간 객체
 */
function getEpisodeInfo() {
    if (!lastQuery.requestTime)
        return null;

    return search_lib.getAdjustedVideoTime(lastQuery.requestTime, lastQuery.now, lastQuery.index);
}

/**
 * 백그라운드 타이머에 의해 주기적으로 호출되며 라이브 스트림 영상과 
 * DB(핑거프린트)를 매칭하여 방영 시점에 대한 싱크를 보정합니다.
 */
function updateEpisodeInfo() {
    //return;
    // 1. 초기 상태이거나 마지막 동기화(requestTime) 이후 일정 시간(stale_min)이 경과했는지 검사
    if (!lastQuery.requestTime || Date.now() - lastQuery.requestTime >= 1000 * 60 * cfg.sync.stale_min) {

        // 2. 외부 C++ 서치 엔진(searcher.exe)을 비동기로 호출해서 영상 매칭 상태 분석
        search_lib.getTimeAsync(schCfg.searcher.youtube_url).then(rtn => {
            if (!rtn)
                return null;

            // 3. 서치 엔진 결과물(rtn) 누적. (동기화 신뢰도를 높이고자 여러 번 샘플링 수행)
            tempQuery.push(rtn);

            // 4. 샘플이 2개 이상 모였을 때 과반수/신뢰도 검증 로직 실행
            if (tempQuery.length > 1) {
                console.log("현재 영상 정보를 불러왔습니다. 객체: ");
                console.log(tempQuery);
                const freqMap = new Map();

                // 4-1. 각 샘플마다 영상 인덱스 번호(index)별로 등장 빈도와 경과 시간 기록
                for (const item of tempQuery) {
                    if (!freqMap.has(item.index)) {
                        freqMap.set(item.index, { count: 0, past: 0, obj: { ...item } });
                    }
                    const entry = freqMap.get(item.index);
                    entry.count++;
                    entry.past = entry.obj.now || 0;
                    entry.obj.now = item.now; // 가장 나중 최신 시간 보존
                    entry.obj.requestTime = item.requestTime;
                }

                // 4-2. 등장 빈도(count) 내림차순 정렬, 빈도가 같으면 진행 시간(now) 내림차순 정렬
                const sorted = [...freqMap.values()].sort((a, b) =>
                    b.count !== a.count ? b.count - a.count : b.obj.now - a.obj.now
                );

                // 4-3. 압도적 다수결이거나 1위와 2위의 득표 빈도 격차가 크다면(1 초과), 1위를 올바른 싱크로 확정
                if (!sorted[1] || Math.abs(sorted[0].count - sorted[1].count) > 1) {
                    console.log("이 객체의 정보가 정확한거 같습니다:");
                    console.log(sorted[0].obj);
                    copyQuery(sorted[0].obj); // 최종 확정된 객체를 파일 및 lastQuery 메모리에 갱신
                    return;
                }
            }

            // 5. 샘플이 1개이거나, 다수결 판별이 안 난 경우 현재 확정 기록된 getEpisodeInfo와 대조
            const cmp = getEpisodeInfo();
            // 싱크 오차 허용 범위(tolerance_sec) 안에서 기존 기록과 연속성이 있다면 갱신 허용
            if (cmp && tempQuery.length <= 1 && rtn.index === cmp.index && Math.abs(rtn.now - cmp.now) <= cfg.sync.tolerance_sec) {
                copyQuery(rtn);
                return;
            } else {
                console.log("현재 영상 정보와 싱크가 맞지 않습니다.");
            }
        });
    }
}

const noticeIdx = { index: -1, sleep: 0 };

/**
 * 에피소드가 다음 화로 넘어갔을 때 이를 자가 판독/감지하여
 * 유튜브 채팅창에 안내 메시지 및 봇 사용법 팁을 랜덤 전송합니다.
 */
function noticeChangeEpisode() {
    const rtn = getEpisodeInfo();

    if (!rtn)
        return;

    // 1. 방영 중인 회차를 모니터링하다가 인덱스가 바뀐 경우를 탐지
    if (noticeIdx.index >= 0) {
        // 알림 중복 방지용 슬립(sleep) 카운터가 0 이하일 때만 알림 발생
        if (rtn.index !== noticeIdx.index && noticeIdx.sleep <= 0) {

            // 2. 알림 도배 방지를 위해 sleep_count만큼 쿨다운 세팅
            noticeIdx.sleep = cfg.notice.sleep_count;

            // 3. 방송 송출 딜레이와 사용자가 봇의 채팅을 자연스럽게 보게끔 랜덤 딜레이 적용
            const delay = cfg.notice.delay_base_ms + Math.random() * cfg.notice.delay_random_ms;

            setTimeout(() => {
                const info = videoInfo[rtn.index];
                const unicodenum = toUnicodeNumber(info.alias);

                // 4. 채팅방에 '현재 방영 회차' 기본 안내 메시지 발송
                sendChat(`📢 현재 회차는 "${unicodenum}. ${insertSpaces(info.title, retryPattern[0])}" 입니다.`,
                    function (attempt) {
                        return `📢 현재 회차는 "${unicodenum}. ${insertSpaces(info.title, retryPattern[attempt])}" 입니다.`;
                    });

                // 5. 확률(tip_chance)에 맞춰 사용자 가이드(꿀팁) 중 한 가지 랜덤 추가 발송
                if (Math.random() < cfg.notice.tip_chance) {
                    const messages = [  // w: weight, t: text
                        { w: 2, t: `📍"!몇화" 를 입력하면 현재 회차를 확인할 수 있습니다.` },
                        { w: 1, t: `📍"!다음화" 를 입력하면 다음 회차를 확인할 수 있습니다.` },
                        { w: 1, t: `📍"!마지막화" 를 입력하면 마지막 회차를 확인할 수 있습니다.` },
                        { w: 1, t: `📍"!명령어" 를 입력하면 봇 명령어 목록을 볼 수 있습니다.` },
                        { w: 1, t: `📍"!시간표" 를 입력하면 다음 회차부터 일정을 확인할 수 있습니다.` },
                        { w: 1, t: `📍"!몇화 <대사>"를 입력하면 해당 대사의 등장 시간을 확인할 수 있습니다. (예: !몇화 괜히똥만쌌네)` },
                        { w: 1, t: `📍"!몇화 <숫자>" 입력하면 해당 회차의 시작 시간을 확인할 수 있습니다. (예: !몇화 124)` },
                        { w: 1, t: `📍"!건의 <할말>" 을 입력하면 개발자에게 건의할 수 있습니다. (회차정보 오류나 기타 등등)` },
                        { w: 1, t: `❗대사 검색 명령어는 SBS 공식 사이트에서 제공되는 자막 파일을 다운로드하여 활용합니다.` },
                        { w: 3, t: `❗대사 검색 명령어는 다른 명령어에 비해 개별 쿨타임 가중치가 높게 적용됩니다. (오·남용 방지)` },
                        { w: 2, t: `❗에피소드 시작 후 20초 및 종료 20초 전에는 봇 명령어가 처리되지 않습니다.` },
                        { w: 1, t: `❗자동 회차 알림은 실시간 스트리밍의 특성상 알림이 지연되거나 빠르게 전달될 수 있습니다.` },
                        { w: 1, t: `❗에피소드 제목은 처음 접하는 사람과 기존 시청자가 모두 쉽게 알 수 있도록 작성되었습니다.` },
                        { w: 2, t: `❗3분 쿨타임은 봇의 잦은 채팅으로 인해 채팅방이 지나치게 혼잡해지는 것을 방지하기 위해 설정되었습니다.` }
                    ];

                    const selectedMessage = (function (msg) { // 가중치 기반 랜덤 선택
                        let r = Math.random() * msg.reduce((s, m) => s + m.w, 0);
                        return msg.find(m => (r -= m.w) < 0).t;
                    })(messages);

                    sendChat(selectedMessage);
                }
            }, delay);
        }
    }

    // 6. 감지 상태 갱신 (인덱스 유지, 슬립 감소)
    noticeIdx.index = rtn.index;
    --noticeIdx.sleep;
}

/**
 * !다음화 명령어를 처리. 다음에 방영될 에피소드 이름과 예정 시간을 안내.
 * @param {string} cmd - 파싱된 사용자의 원본 명령어 이름
 * @param {object} rtn - 계산 기준이 될 현재 에피소드 진행 데이터
 */
function printNextEpisode(cmd, rtn) {
    const n = videoInfo.length;
    let currentIdx = (rtn.index + 1) % n;
    let info = null;

    // 1. 현재 인덱스 이후부터 재생 리스트를 순회하며 활성화(disable !== true)된 첫 번째 에피소드 색인
    for (let i = 0; i < n; i++) {
        const e = videoInfo[currentIdx];
        if (!e.disable) {
            info = e;
            break;
        }
        currentIdx = (currentIdx + 1) % n; // 플레이리스트 루프 반복
    }

    if (info === null) {
        setCooldown(cmd, -(1000 * 60 * cfg.cooldown.error_offset_min));
        return `⚠️ 다음 회차 정보를 확인할 수 없습니다.`;
    }

    // 2. 찾은 다음 에피소드가 방영될 미래의 예정 시각 계산
    const futureDate = search_lib.getFutureDate(info, rtn, 0);
    const unicodenum = toUnicodeNumber(info.alias);
    const timestr = formatDate(futureDate);
    const emoji = getClockEmoji(timestr);

    setCooldown(cmd);
    return {
        msg: `👉🏻 다음 회차는 "${unicodenum}. ${insertSpaces(info.title, retryPattern[0])}" 이고 ` +
            `${emoji} 예정 시간은 ${timestr} 분 입니다. (쿨타임 3분)`,
        proc: function (attempt) {
            return `👉🏻 다음 회차는 "${unicodenum}. ${insertSpaces(info.title, retryPattern[attempt])}" 이고 ` +
                `${emoji} 예정 시간은 ${timestr} 분 입니다. (쿨타임 3분)`;
        }
    };
}

/**
 * !시간표 명령어를 처리. 현재 시점 이후 연달아 방영될 회차들의 
 * 제목과 예상 시작 시각을 연속된 문자열로 이어붙여 요약 생성
 * @param {string} change - 동일 문구 스팸 차단 방어막용 특수 공백 패딩 문자열
 * @param {number} limitLength - 유튜브 채팅 길이 제한 상한
 */
function printTimeTable(change, limitLength = cfg.timetable.default_limit) {
    const rtn = getEpisodeInfo();
    const n = videoInfo.length;
    let str = "";
    let pdate; // 이전 회차 날짜(일자 변경 표시용)

    // 1. 현재 방송 중인 인덱스의 바로 다음 인덱스부터 탐색 시작
    let currentIdx = (rtn.index) % n;

    // 2. 전체 재생 리스트를 한 바퀴 돌면서 활성화된 에피소드 문자열 조립
    for (let i = 0; i < n; i++) {
        const e = videoInfo[currentIdx];
        if (!e.disable) {
            if (i === 0) {
                str = `(${toUnicodeNumber(e.alias)} 화)`;
                currentIdx = (currentIdx + 1) % n;
                continue;
            }
            // 해당 에피소드의 방송 시작 예정 일시 계산
            const fdate = search_lib.getFutureDate(e, rtn, 0);
            if (!pdate)
                pdate = fdate;

            // 출력 포맷 가공: '[23:45] 혹은 [내일00:15]' 형식으로 시간표 헤더 작성
            const hdr = `[${formatDate(fdate, pdate)}]`.replace(/ /g, '');
            // 에피소드 이름과 결합 ('→[23:45]에피소드명')
            const candidate = insertSpaces((str ? "→" : "") + hdr + e.shorten, change);

            // 3. 누적된 시간표 문자열의 총 길이가 채팅 제한치(limitLength)를 넘으면 그만 붙이고 즉시 반환
            if (str.length + candidate.length >= limitLength)
                return str;

            str += candidate;
            pdate = fdate;
        }
        currentIdx = (currentIdx + 1) % n;
    }

    return str || null;
}

/**
 * !몇화 명령어 등 기본 정보 조회 시, 현재 스트리밍 중인 에피소드명과 끝날 때까지의 잔여 시간 안내
 * @param {object} rtn - 현재 에피소드 진행 데이터 
 */
function printNowEpisode(rtn) {
    // 1. 현재 방송 데이터 안에서 재생 중인 영상 메타 데이터를 추출
    const info = videoInfo[rtn.index];
    const unicodenum = toUnicodeNumber(info.alias);

    // 2. 현재 방영 중인 에피소드가 끝나기까지 남은 시간(잔여 초수) 계산
    const timestr = toHHMMSS(rtn.end - rtn.now);

    return {
        // 3. 응답 텍스트 포맷 (재시도 회차에 맞춘 스팸 회피용 공백 치환 포함)
        msg: `🎬 현재 회차는 "${unicodenum}. ${insertSpaces(info.title, retryPattern[0])}" 이고 ` +
            `🕐 남은 시간은 ${timestr} 초 입니다. (쿨타임 3분)`,
        proc: function (attempt) {
            return `🎬 현재 회차는 "${unicodenum}. ${insertSpaces(info.title, retryPattern[attempt])}" 이고 ` +
                `🕐 남은 시간은 ${timestr} 초 입니다. (쿨타임 3분)`;
        }
    };
};

/**
 * 특정 숫자의 에피소드를 지정 조회(!몇화 N)할 경우 
 * 그 에피소드가 언제 방영될지, 미래의 방영 예정 시간(분)을 계산하여 안내
 * @param {object} rtn - 현재 에피소드 진행 데이터
 * @param {string} num - 검색하려는 대상 에피소드의 고유 번호(alias)
 */
function printNumEpisode(rtn, num) {
    // 1. 지정된 숫자 번호로 플레이리스트(영상 DB)에서 대상 에피소드 정보 조회
    const info = videoInfo.find(e => e.alias == num);

    if (!info)
        return null;

    // 2. 요청한 회차가 현재 지금 이미 방영 중이면 별도 로직으로 현재 진행 상태 안내
    if (videoInfo[rtn.index] === info)
        return printNowEpisode(rtn);

    // 3. 해당 회차가 방영될 상대적/절대적 미래 예상 날짜 도출
    const futureDate = search_lib.getFutureDate(info, rtn, 0);
    const unicodenum = toUnicodeNumber(info.alias);
    const timestr = formatDate(futureDate);
    const emoji = getClockEmoji(timestr);

    return {
        // 4. 예정 시각 및 에피소드 제목 안내 텍스트 반환
        msg: `🔜 예정 회차는 "${unicodenum}. ${insertSpaces(info.title, retryPattern[0])}" 이고 ` +
            `${emoji} 예정 시간은 ${timestr} 분 입니다. (쿨타임 3분)`,
        proc: function (attempt) {
            return `🔜 예정 회차는 "${unicodenum}. ${insertSpaces(info.title, retryPattern[attempt])}" 이고 ` +
                `${emoji} 예정 시간은 ${timestr} 분 입니다. (쿨타임 3분)`;
        }
    };
}

/**
 * 봇 기동 시 최초 1회만 실행. 
 * 백그라운드에서 동작할 동기화 루틴과 에피소드 알림을 타이머(setInterval)에 등록.
 */
function initCommand() {
    // 1. 단축 평가 검사: 이미 초기화가 된 상태라면 중복 스케줄링이 되지 않도록 종료
    if (initCommand.__init)
        return;
    initCommand.__init = true;

    // 2. 초기 기동 시점 대기 후 첫 라이브 영상 스트림 동기화 시도
    setTimeout(updateEpisodeInfo, cfg.sync.init_delay_ms);
    // 3. 주기적(interval_ms마다)으로 백그라운드 영상 동기화 보정 타이머 활성화
    setInterval(updateEpisodeInfo, cfg.sync.interval_ms);
    // 4. 에피소드 전환 안내 메시지를 체크하는 타이머 활성화
    setInterval(noticeChangeEpisode, cfg.notice.check_interval_ms);
}

module.exports = { initCommand, handleCommand };
