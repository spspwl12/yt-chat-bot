const search_lib = require('./video-matcher/search.js');
const { searchEpisodeByAI } = require('./ai.js');
const TextSearchEngine = require('./textsearcher.js');
const LiveDownloader = require('./video-matcher/live-downloader.js');
const LiveSearcher = require('./video-matcher/live-searcher.js');
const greeting_lib = require('./greeting.js');
const schCfg = require('../data/config-search.js');
const videoSubManager = require('./sub-manager.js');

let musics = {};
try { musics = require('../data/video-music.json'); }
catch (e) { console.warn('⚠️ [경고] video-music.json 파일이 없습니다. 음악 검색 기능이 비활성화됩니다.'); }
const lastQuery = require(schCfg.searcher.lastquery_path);
const fs = require('fs');
const eventBus = require('./event-bus.js');
const { sendChat } = require('./innertube.js');
const { insertSpaces, filterText, toUnicodeNumber, toUnicodeNumber2,
    toHHMMSS, fromHHMMSS, formatDate, roundUpTime, getClockEmoji, parseKoreanDate, hasProfanity, maskProfanity } = require('./func.js');

const videoInfo = search_lib.videoInfo;
let videoMetadata = [];
try { videoMetadata = require('../data/video-metadata.json'); }
catch (e) { console.warn('⚠️ [경고] video-metadata.json 파일이 없습니다. 방송 메타데이터 관련 기능이 비활성화됩니다.'); }

const videoMetaMap = new Map(videoMetadata.map(m => [m.name, m]));
const statsTracker = require('./stats-db.js');
const musicSearcher = new TextSearchEngine(musics);
const retryPattern = ["$1", "$1 ", " $1", "", ""];

// ─── 설정 로드 (data/config-youtube.json) ─────────────────────
const cfg = require('../data/config-youtube.js');

// ─── 봇 출력 메시지 로드 ─────────────────────────────────────
const msg = require('../data/config-messages.js');

// ─── JSON 파일 누락 시 연관 기능 강제 비활성화 ───
if (!videoSubManager.hasSubtitles() && cfg.input) {
    cfg.input.enable_search = false;
}
if (Object.keys(musics).length === 0 && cfg.music) {
    cfg.music.enable = false;
}

// ──────────────────────────────────────────────────────────

let delayChatTime = 0;                 // global 모드용
const delayChatTimeMap = new Map();    // per-command 모드용
const tempQuery = [];

// 명령어를 그룹으로 분류 (같은 그룹의 alias는 쿨타임 공유)
const COMMAND_GROUPS = {
    'greeting': ['!안녕', '!인사', '!하이', '!헬로', '!ㅎㅇ', '!gd', '!반가워', '!방가'],
    'help': ['!도움', '!안내', '!소개', '!헬프', '!가이드', '!도움말', '!사용법', '!설명서', '!명령어', '!commands', '!command'],
    'episode': ['!대사', '!몇회', '!몇화', '!몆화', '!몆회', '!몇편', '!편수', '!화차', '!지금몇화', '!지금몇회', '!지금몇편', '!회차', '!ㅁㅎ'],
    'music': ['!음악', '!노래', '!브금', '!곡', '!사운드', '!bgm'],
    'timetable': ['!시간표', '!편성표', '!방영표', '!방송표', '!상영표'],
    'next': ['!다음', '!다음화', '!다음회', '!다음편', '!다음회차'],
    'nextnext': ['!다다음', '!다다음화', '!다다음회', '!다다음편', '!다다음회차'],
    'first': ['!첫화', '!첫회', '!처음화', '!처음회', '!처음편', '!첫편'],
    'last': ['!마지막', '!마지막화', '!마지막회', '!마지막편', '!최종화', '!최종회', '!최종편', '!막화', '!막회'],
    'date': ['!날짜'],
    'time': ['!시간', '!타임', '!남은시간'],
    'stats': ['!스탯', '!스텟', '!내정보', '!내스탯', '!내스텟', '!stats', '!stat']
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

function getCooldownConfig(group) {
    if (cfg.cooldown.group_times) {
        for (const [keys, time] of Object.entries(cfg.cooldown.group_times)) {
            const groupList = keys.split(',').map(k => k.trim());
            if (groupList.includes(group)) {
                return { key: keys, time: time };
            }
        }
    }
    return { key: group, time: cfg.cooldown.time_min };
}

function returnWarning(msg, cmd, _input) {
    if (_input) {
        setCooldown(cmd, -(1000 * 60 * (cfg.cooldown.error_offset_min || 0)), _input);
    }
    return `${msg} ${getCooldownMsg(cmd)}`;
}

function getCooldownMsg(cmd) {
    if (!cmd) return "";
    if (cfg.cooldown.mode === 'global') {
        return msg.cooldown.suffix(cfg.cooldown.time_min);
    } else {
        const group = getCommandGroup(cmd);
        const config = getCooldownConfig(group);
        return msg.cooldown.suffix(config.time);
    }
}

function getWarnsValue(group) {
    if (cfg.spam && cfg.spam.group_warns) {
        for (const [keys, value] of Object.entries(cfg.spam.group_warns)) {
            const groupList = keys.split(',').map(k => k.trim());
            if (groupList.includes(group)) {
                return value;
            }
        }
    }
    return null;
}

/**
 * 특정 명령어가 현재 쿨타임(사용 제한) 상태인지 확인
 * @param {string} cmd - 확인 대상 명령어
 * @returns {boolean} 쿨타임 중이면 true, 사용 가능하면 false 반환
 */
function isCooldown(cmd) {
    if (cfg.cooldown.mode === 'global') {
        const globalCooldownMs = 1000 * 60 * cfg.cooldown.time_min;
        return Date.now() - delayChatTime <= globalCooldownMs;
    }

    const group = getCommandGroup(cmd);
    const config = getCooldownConfig(group);
    const cooldownMs = 1000 * 60 * config.time;

    const lastTime = delayChatTimeMap.get(config.key) || 0;
    return Date.now() - lastTime <= cooldownMs;
}

/**
 * 명령어 사용 직후 쿨타임을 설정 (다음 사용 가능 시간 갱신)
 * @param {string} cmd - 사용한 명령어
 * @param {number} offsetMs - 쿨타임 시간에 더하거나 뺄 밀리초 (예외/오류 시 실질 대기시간 경감을 위해 사용)
 */
function setCooldown(cmd, offsetMs = 0, _input = null) {
    if (_input) {
        _input.triggerCooldown = () => {
            const now = Date.now() + offsetMs;
            if (cfg.cooldown.mode === 'global') {
                delayChatTime = now;
            } else {
                const group = getCommandGroup(cmd);
                const config = getCooldownConfig(group);
                delayChatTimeMap.set(config.key, now);
            }
        };
        return;
    }

    const now = Date.now() + offsetMs;
    if (cfg.cooldown.mode === 'global') {
        delayChatTime = now;
    } else {
        const group = getCommandGroup(cmd);
        const config = getCooldownConfig(group);
        delayChatTimeMap.set(config.key, now);
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
    // 쿨타임 강제 초기화 (type이 0인 경우 봇 재시작이나 관리자 트리거로 인식)
    if (type === 0) {
        delayChatTime = 0;
        delayChatTimeMap.clear();
        return null;
    }

    // 메시지 기본 유효성 검증 (입력 텍스트 타입 확인)
    if (!text || typeof text !== "string")
        return null;

    // 명령어가 최소 글자 길이를 충족하지 않는 경우 
    if (text.length < cfg.input.text_min_length)
        return null;

    // 2. 명령어 접두사 확인
    text = text.replace(/^\s*!\s*/, '!');
    if (!text.startsWith('!'))
        return null;

    // 3. 파싱 및 그룹 매핑
    const parts = text.trim().split(/ (.+)/);
    const cmd = parts[0];
    const args = parts.slice(1);
    const group = getCommandGroup(cmd);

    // 4. 무효한 명령어면 조기 반환
    if (group === cmd)
        return null;

    // 5. 사용하려는 명령어가 현재 쿨타임(도배 방지 대기시간) 상태인지 체크
    if (isCooldown(cmd))
        return null;

    // 6. 유효한 명령어이며 쿨타임이 아닌 상태에서 밴/경고 유저 차단 (index.js가 패널티를 갱신할 수 있도록 flag 설정)
    if (_input && _input.ban) {
        _input.blockedCommand = true;
        return null;
    }

    // 7. 경고(Warns) 수치 기본 할당
    const customWarn = getWarnsValue(group);
    if (_input) {
        _input.warn = customWarn !== null ? customWarn : 1;
    }

    const rtn = getEpisodeInfo();

    // 정보 로드 실패 시, 무시
    if (!rtn) {
        return null;
    }

    // 이전 회차가 끝나고 다음 회차가 시작되기 직전 과도기/경계 시간엔 부정확한 정보 방지를 위해 명령어 처리 무시
    if (Math.abs(rtn.end - rtn.now) <= cfg.input.boundary_sec || rtn.now <= cfg.input.boundary_sec) {
        if (_input) _input.warn = 0;
        return null;
    }

    // ★ 명령어 사용 로그 메타데이터 저장 (index.js에서 실제 전송 후 이벤트 발행)
    const _emitLog = (response) => {
        _input.logData = {
            time: Date.now(),
            user: displayName,
            cmd: cmd,
            group: group,
            args: args.length > 0 ? args[0] : null,
            response: typeof response === 'string' ? response :
                (response && response.msg ? response.msg : null),
        };
        return response;
    };

    if (text.length > cfg.input.text_max_length) {
        return _emitLog(returnWarning(
            msg.error.text_too_long(cfg.input.text_max_length), cmd, _input));
    }

    // 단순 봇 인사 명령어
    if (group === 'greeting') {
        if (!cfg.input.enable_greeting) {
            return null;
        }
        setCooldown(cmd, 0, _input);
        return _emitLog(greeting_lib(maskProfanity(displayName)));
    }

    // 봇 도움말/가이드 출력
    if (group === 'help') {
        setCooldown(cmd, 0, _input);
        return _emitLog(msg.help.main);
    }

    // 방영/회차/대사 정보 조회 명령어 (가장 복합적인 로직)
    if (group === 'episode') {
        return _emitLog(await handleEpisodeCommand(rtn, cmd, args, _input));
    }

    // 음악/노래 검색 명령어
    if (group === 'music') {
        return _emitLog(await handleMusicCommand(rtn, cmd, args, _input));
    }

    // 곧 방영될 회차 리스트 목록 요약(시간표) 출력
    if (group === 'timetable') {
        setCooldown(cmd, 0, _input);
        return _emitLog({
            msg: printTimeTable(rtn, retryPattern[0], cmd),
            proc: function (attempt) {
                return printTimeTable(rtn, retryPattern[attempt], cmd);
            }
        });
    }

    // 다음 방영 예정 회차 정보 조회
    if (group === 'next') {
        return _emitLog(printFutureEpisode(rtn, cmd, 1, '다음', _input));
    }

    // 다다음 방영 예정 회차 정보 조회
    if (group === 'nextnext') {
        return _emitLog(printFutureEpisode(rtn, cmd, 2, '다다음', _input));
    }

    // 현재 에피소드 및 남은 시간 단축 출력 (!시간)
    if (group === 'time') {
        setCooldown(cmd, 0, _input);
        const info = videoInfo[rtn.index];
        const unicodenum = toUnicodeNumber(info.alias);
        const timestr = toHHMMSS(rtn.end - rtn.now);

        return _emitLog({
            msg: msg.time.remaining(unicodenum, insertSpaces(info.shorten, retryPattern[0]), timestr, getCooldownMsg(cmd)),
            proc: function (attempt) {
                return msg.time.remaining(unicodenum, insertSpaces(info.shorten, retryPattern[attempt]), timestr, getCooldownMsg(cmd));
            }
        });
    }

    // 전 대역 첫 회차 방영 예정일 조회
    if (group === 'first') {
        setCooldown(cmd, 0, _input);
        return _emitLog(printNumEpisode(rtn, cfg.episode.start, cmd));
    }

    // 전 대역 마지막 회차 방영 예정일 조회
    if (group === 'last') {
        setCooldown(cmd, 0, _input);
        return _emitLog(printNumEpisode(rtn, cfg.episode.end, cmd));
    }

    // 날짜 지정 회차 조회
    if (group === 'date') {
        return _emitLog(handleDateCommand(rtn, cmd, args, _input));
    }

    // 유저 스탯/시청시간/출석 조회
    if (group === 'stats') {
        return _emitLog(handleStatsCommand(cmd, displayName, _input));
    }

    return null;
}

function handleStatsCommand(cmd, displayName, _input) {
    if (cfg.stats && !cfg.stats.enable) {
        return returnWarning(msg.error.stats_disabled, cmd, _input);
    }

    const channelId = _input && _input.channelId;
    if (!channelId) {
        return returnWarning(msg.error.stats_not_found, cmd, _input);
    }

    const stats = statsTracker.getUserStats(channelId, displayName);
    if (!stats) {
        return returnWarning(msg.error.stats_not_found, cmd, _input);
    }

    setCooldown(cmd, 0, _input);

    const cleanName = maskProfanity(stats.name);

    const makeMsg = (attempt) => {
        const spaces = " ".repeat(attempt);
        const builtMsg = msg.stats.user_stats(
            cleanName,
            stats.totalMsgs,
            stats.totalRank,
            stats.daysCount,
            stats.todayMsgs,
            stats.todayRank,
            stats.todayWatchStr,
            stats.todayWatchRank,
            stats.totalWatchStr,
            stats.totalWatchRank,
            getCooldownMsg(cmd)
        );
        return `${builtMsg}${spaces}`;
    };

    return {
        msg: makeMsg(0),
        proc: (attempt) => makeMsg(attempt)
    };
}

const subtt = videoSubManager.getSubtitles();

async function handleEpisodeCommand(rtn, cmd, args, _input) {
    // 별도 인자가 없으면(예: '!몇화') 현재 실시간으로 방영 중인 회차와 남은 시간 반환
    if (!args || args.length <= 0) {
        setCooldown(cmd, 0, _input);
        return printNowEpisode(rtn, cmd);
    }

    const query = args[0];

    // ─── 복수 에피소드 번호 감지 ──────────────────────────────
    // "1 29 30 50 66 77" 또는 "1화 10화 30화 44화 55화" 형태 감지
    const multiTokens = query.trim().split(/[\s,]+/);
    if (multiTokens.length >= 2) {
        const parsedNums = [];
        let allInRange = true;

        for (const token of multiTokens) {
            const m = token.match(/^(\d+)(화|회)?$/);
            if (!m) {
                allInRange = false;
                break;
            }
            const num = parseInt(m[1], 10);
            if (num < cfg.episode.start || num > cfg.episode.end) {
                allInRange = false;
                break;
            }
            parsedNums.push(num);
        }

        if (allInRange && parsedNums.length >= 2) {
            setCooldown(cmd, 0, _input);
            return printMultiEpisodeTimetable(rtn, parsedNums, cmd);
        }
        // 범위 밖의 숫자가 있으면 대사 검색으로 fall-through
    }

    const numbers = query.match(/^(\d+)(\S)?/);
    const parseChapter = numbers ? parseInt(numbers[1], 10) : NaN;
    const isChapter = numbers && parseChapter >= cfg.episode.start && parseChapter <= cfg.episode.end &&
        (!numbers[2] || "화회".includes(numbers[2]));

    // 24시간(혹은 설정 시간) 이내 동일 검색어 체크 및 강력한 패널티 부과
    if (cfg.input.duplicate_history_hours > 0 && _input.spamGuard) {
        const normalizedQuery = isChapter ? parseChapter.toString() : filterText(query);

        const now = Date.now();
        const expiry = now - (cfg.input.duplicate_history_hours * 60 * 60 * 1000);

        // 기한이 지난 오래된 기록 정리
        const history = _input.spamGuard.getSearchHistory(_input.channelId).filter(item => item.time >= expiry);
        const duplicateFound = history.some(item => item.query === normalizedQuery);

        if (duplicateFound) {
            _input.warn = cfg.input.duplicate_history_penalty || 1;
            _input.spamGuard.setSearchHistory(_input.channelId, history); // 정리된 이력 저장
            return null;
        }

        _input.onSuccess = () => {
            if (cfg.input.duplicate_history_hours > 0) {
                history.push({ query: normalizedQuery, time: Date.now() });
                _input.spamGuard.setSearchHistory(_input.channelId, history);
            }
        };
    }

    // 숫자가 입력된 경우(예: '!몇화 200화') 해당 숫자의 에피소드 방영 예정 시간 계산 조회
    if (isChapter) {
        setCooldown(cmd, 0, _input);
        return printNumEpisode(rtn, parseChapter, cmd);
    }

    // 입력된 텍스트가 특정 회차의 제목(title)이나 요약(shorten)의 일부분이라도 공백 무시 일치할 경우, 대사 검색 대신 해당 회차 방영 정보 안내
    if (query) {
        const reqStr = query.replace(/\s+/g, '');
        // 지나치게 짧은 검색어(예: 1글자)로 인해 모든 제목이 매칭되는 것을 방지
        if (reqStr.length >= cfg.input.search_min_length) {
            const lowerQuery = reqStr.toLowerCase();
            const titleMatched = videoInfo.find(info =>
                (info.title && info.title.replace(/\s+/g, '').toLowerCase().includes(lowerQuery)) ||
                (info.shorten && info.shorten.replace(/\s+/g, '').toLowerCase().includes(lowerQuery))
            );

            if (titleMatched) {
                setCooldown(cmd, 0, _input);
                return printNumEpisode(rtn, titleMatched.alias, cmd);
            }
        }
    }

    // 숫자 형식이 아닌 일반 텍스트가 인자로 넘어왔다고 가정하여 
    // 내부 자막 데이터세트를 기반으로 '대사 검색' 알고리즘 수행
    if (cfg.input.enable_search === false) {
        return returnWarning(msg.error.search_disabled, cmd, _input);
    }

    const trackerInfo = _input.spamGuard && _input.spamGuard.tracker.get(_input.channelId);
    if (trackerInfo && trackerInfo.searchBanned) {
        return null;
    }

    if (query.length < cfg.input.search_min_length) {
        return returnWarning(msg.error.search_min_length(cfg.input.search_min_length), cmd, _input);
    }

    // 비속어 필터링: 검색어에 비속어가 포함되어 있으면 즉시 차단
    const searchText = filterText(query);
    if (hasProfanity(searchText)) {
        return returnWarning(msg.error.search_profanity, cmd, _input);
    }

    const baseWarn = cfg.subtitle_score.warn_base || 10;
    const { validResults, searchInfo } = videoSubManager.searchAndFormat(query, rtn);
    if (validResults && validResults.length > 0) {
        // 부하/스팸 방지를 위해 1위 결과물의 점수에 역비례하게 페널티 차등 책정
        _input.warn = baseWarn +
            parseInt((100 - validResults[0].score) / cfg.subtitle_score.warn_divisor);

        setCooldown(cmd, 0, _input);

        searchInfo
            .slice(0, cfg.subtitle_score.max_candidate_episodes)
            .forEach(e => {
                console.log(JSON.stringify({
                    key: e.key, score: e.score, sub: subtt[e.key][e.matchedIndices[0] - 1].text
                }));
            });

        const isDefinitive = validResults[0].score >= 100 ||
            validResults.length === 1 ||
            (validResults[0].score - validResults[1].score >= 10);

        if (isDefinitive) {
            const firstResult = validResults[0];

            if (firstResult.subSt === 0 && firstResult.subEd === 0) {
                _input.warn = 0;
                setCooldown(cmd, 0, _input);
                return printNumEpisode(rtn, firstResult.subInfo.alias, cmd);
            }

            // 1위 검색 결과 외에 다른 회차에서 비슷하게 잡힌 대안 후보군 산출
            const subEpisodeKeys = searchInfo
                .filter(e => searchInfo[0].key !== e.key && e.score >= firstResult.score)
                .slice(0, cfg.subtitle_score.max_candidate_episodes)
                .map(e => e.key);

            const subEpisodeSet = new Set(subEpisodeKeys);

            const subEpisodeMatching = videoInfo
                .filter(e => subEpisodeSet.has(e.name))
                .map(e => e.alias);

            const message = (firstResult.outOfbounds ? msg.subtitle.not_in_stream :
                msg.subtitle.found_time(firstResult.emoji, firstResult.timestr)) +
                `${subEpisodeMatching.length > 0 ? msg.subtitle.candidates(subEpisodeMatching) : ''}`;

            const prefixEmoji = firstResult.score < 100 ? "⚠️ 📜" : "📜";

            return {
                msg: msg.subtitle.found_definitive(prefixEmoji, firstResult.unicodenum,
                    insertSpaces(firstResult.subInfo.title, retryPattern[0]),
                    message, firstResult.unicodescore, getCooldownMsg(cmd)),
                proc: function (attempt) {
                    return msg.subtitle.found_definitive(prefixEmoji, firstResult.unicodenum,
                        insertSpaces(firstResult.subInfo.title, retryPattern[attempt]),
                        message, firstResult.unicodescore, getCooldownMsg(cmd));
                }
            };
        } else {
            const makeMsg = (attempt) => {
                const mapped = validResults.map((r, i) => {
                    const rankEmoji = toUnicodeNumber2((i + 1).toString());
                    const title = insertSpaces(r.subInfo.shorten, retryPattern[attempt]);
                    const timeMsg = r.outOfbounds ?
                        msg.subtitle.not_in_stream_short :
                        `${r.emoji} ${r.timestr.replace(/\((월|화|수|목|금|토|일)\)/g, "")}`;

                    return {
                        n: `${rankEmoji}${r.unicodenum})${title}${timeMsg.replace(/ /g, '')}`,
                        s: `${rankEmoji}${r.unicodenum}화${timeMsg.replace(/ /g, '')}`
                    };
                });
                const WrongMsg = msg.subtitle.ambiguous_warning;
                return {
                    n: `${WrongMsg} ${mapped.map(e => e.n).join('')} ${getCooldownMsg(cmd)}`,
                    s: `${WrongMsg} ${mapped.map(e => e.s).join('')} ${getCooldownMsg(cmd)}`
                };
            };

            return {
                msg: makeMsg(0).n,
                proc: function (attempt) {
                    if (attempt === 1)
                        return makeMsg(attempt).s;
                    else
                        return returnWarning(msg.error.search_output_failed, cmd, _input);
                }
            };
        }
    }

    // 검색 알고리즘을 타기에는 조건이 부족하거나 매칭 실패 시 → AI 폴백 시도
    if (cfg.ai && cfg.ai.enable) {
        sendChat(msg.error.search_ai_pending);

        searchEpisodeByAI(query, cfg.ai, cfg.episode.start, cfg.episode.end)
            .then(episodeNum2 => {
                if (episodeNum2 !== null) {
                    console.log(`🤖 AI: "${query}" → ${episodeNum2}화`);
                    setCooldown(cmd, 0, _input);
                    const result = printNumEpisode(rtn, episodeNum2, cmd);
                    if (result) {
                        if (typeof result === 'string')
                            return sendChat(`🤖 ${result}`);
                        return sendChat(`🤖 ${result.msg}`);
                    }
                }

                sendChat(returnWarning(msg.error.search_failed, cmd, _input));
            })
            .catch(err => {
                console.error('AI 검색 중 오류 발생:', err);
            });

        _input.warn = baseWarn * 5;
        return null;
    }

    _input.warn = baseWarn;
    return returnWarning(msg.error.search_not_found, cmd, _input);
}

function handleDateCommand(rtn, cmd, args, _input) {
    if (!args || args.length === 0) {
        return returnWarning(msg.error.date_missing, cmd, _input);
    }

    const dtStr = args.join(' ');
    const dtParsed = parseKoreanDate(dtStr);
    if (!dtParsed) {
        return returnWarning(msg.error.date_invalid_format, cmd, _input);
    }

    const nowTime = Date.now();
    const limitFutureTime = nowTime + (1000 * 60 * 60 * 24 * 90); // 약 3개월(90일)

    if (dtParsed.endDate.getTime() < nowTime) {
        return returnWarning(msg.error.date_past, cmd, _input);
    }

    if (dtParsed.startDate.getTime() > limitFutureTime) {
        return returnWarning(msg.error.date_too_far, cmd, _input);
    }

    const makeDateMsg = (attempt) => {
        const yyyy = dtParsed.startDate.getFullYear();
        const mm = String(dtParsed.startDate.getMonth() + 1).padStart(2, '0');
        const dd = String(dtParsed.startDate.getDate()).padStart(2, '0');
        const hh = String(dtParsed.startDate.getHours()).padStart(2, '0');
        const min = String(dtParsed.startDate.getMinutes()).padStart(2, '0');

        const reqDateStr = dtParsed.hasTime ?
            `${yyyy}-${mm}-${dd} ${hh}:${min}` :
            `${yyyy}-${mm}-${dd}`;

        if (dtParsed.hasDate && !dtParsed.hasTime) {
            const stEp = search_lib.getEpAtDate(dtParsed.startDate, rtn);
            const edEp = search_lib.getEpAtDate(dtParsed.endDate, rtn);

            const numSt = toUnicodeNumber(stEp.info.alias);
            const numEd = toUnicodeNumber(edEp.info.alias);

            if (stEp.idx === edEp.idx) {
                return msg.date.full_repeat(reqDateStr, getCooldownMsg(cmd));
            } else {
                return msg.date.range_episodes(reqDateStr, numSt, numEd, getCooldownMsg(cmd));
            }
        } else {
            const tEp = search_lib.getEpAtDate(dtParsed.startDate, rtn);
            const info = tEp.info;
            const threshold = cfg.input.boundary_sec;

            const numStr = toUnicodeNumber(info.alias);
            let overlaps = [];
            let mainTxt = `"${numStr}. ${insertSpaces(info.title, retryPattern[attempt])}"`;

            const epRemainSec = info._streamDurationSec - tEp.streamPos;
            const timestr = toHHMMSS(epRemainSec);

            if (tEp.streamPos < threshold) {
                let pIdx = (tEp.idx - 1 + videoInfo.length) % videoInfo.length;
                while (videoInfo[pIdx].disable) pIdx = (pIdx - 1 + videoInfo.length) % videoInfo.length;
                const pInfo = videoInfo[pIdx];
                overlaps.push(`"${toUnicodeNumber(pInfo.alias)}. ${insertSpaces(pInfo.title, retryPattern[attempt])}"`);
                overlaps.push(mainTxt);
            } else if (info._streamDurationSec - tEp.streamPos < threshold) {
                overlaps.push(mainTxt);
                let nIdx = (tEp.idx + 1) % videoInfo.length;
                while (videoInfo[nIdx].disable) nIdx = (nIdx + 1) % videoInfo.length;
                const nInfo = videoInfo[nIdx];
                overlaps.push(`"${toUnicodeNumber(nInfo.alias)}. ${insertSpaces(nInfo.title, retryPattern[attempt])}"`);
            } else {
                overlaps.push(mainTxt);
            }

            const overlapStr = overlaps.join(" 및 ");
            setCooldown(cmd, 0, _input);
            return msg.date.exact_episode(reqDateStr, overlapStr, timestr, getCooldownMsg(cmd));
        }
    };

    setCooldown(cmd, 0, _input);
    return {
        msg: makeDateMsg(0),
        proc: function (att) {
            return makeDateMsg(att);
        }
    };
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
    // lastquery 이력 이벤트 발생
    eventBus.emit('lastquery_update', { index: lastQuery.index, now: lastQuery.now, requestTime: lastQuery.requestTime, retry: lastQuery.retry });
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
 * 라이브 매칭 결과를 수신하여 방영 시점 싱크를 보정합니다.
 * LiveSearcher의 'match' 이벤트 핸들러.
 *
 * @param {object} rtn - processSearchResult 결과 (getLiveVideoTime 반환값)
 */
function onMatchResult(rtn) {
    if (!rtn)
        return;

    const minConsecutive = cfg.sync.min_consecutive || 4;

    // 서치 엔진 결과물(rtn) 누적 (동기화 신뢰도를 높이고자 여러 번 샘플링)
    tempQuery.push(rtn);

    // 샘플이 min_consecutive개 이상 모였을 때 연속성 검증 로직 실행
    if (tempQuery.length >= minConsecutive) {
        // 최근 minConsecutive개가 모두 연속적으로 일치하는지 확인
        let consecutiveCount = 1;
        let adopted = tempQuery[0];

        for (let i = 1; i < tempQuery.length; i++) {
            const prev = tempQuery[i - 1];
            const curr = tempQuery[i];

            if (curr.index === prev.index &&
                Math.abs(curr.now - prev.now) <= cfg.sync.tolerance_sec) {
                consecutiveCount++;
                adopted = curr;
            } else {
                consecutiveCount = 1;
                adopted = curr;
            }
        }

        // 연속 일치 수가 min_consecutive 이상이면 확정
        if (adopted && consecutiveCount >= minConsecutive) {
            copyQuery(adopted);
            return;
        }
    }

    // 샘플 수 미달이거나 연속성 불일치 시 기존 기록과 대조
    const cmp = getEpisodeInfo();
    if (cmp &&
        tempQuery.length < minConsecutive &&
        rtn.index === cmp.index &&
        Math.abs(rtn.now - cmp.now) <= cfg.sync.tolerance_sec) {
        copyQuery(rtn);
        return;
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

    // 방영 중인 회차를 모니터링하다가 인덱스가 바뀐 경우를 탐지
    if (noticeIdx.index >= 0) {
        // 알림 중복 방지용 슬립(sleep) 카운터가 0 이하일 때만 알림 발생
        if (rtn.index !== noticeIdx.index && noticeIdx.sleep <= 0) {

            // 알림 도배 방지를 위해 sleep_count만큼 쿨다운 세팅
            noticeIdx.sleep = cfg.notice.sleep_count;

            // 방송 송출 딜레이와 사용자가 봇의 채팅을 자연스럽게 보게끔 랜덤 딜레이 적용
            const delay = cfg.notice.delay_base_ms + Math.random() * cfg.notice.delay_random_ms;

            setTimeout(() => {
                const info = videoInfo[rtn.index];
                const unicodenum = toUnicodeNumber(info.alias);

                // 채팅방에 '현재 방영 회차' 기본 안내 메시지 발송
                const meta = videoMetaMap.get(info.name);
                const rankSuffix = meta
                    ? msg.notice.rank_suffix(toUnicodeNumber(meta.views_rank), toUnicodeNumber(meta.funny_rank))
                    : '';
                sendChat(msg.notice.now_episode(unicodenum, insertSpaces(info.title, retryPattern[0]), rankSuffix),
                    function (attempt) {
                        return msg.notice.now_episode(unicodenum, insertSpaces(info.title, retryPattern[attempt]), rankSuffix);
                    });

                // 확률(tip_chance)에 맞춰 사용자 가이드(꿀팁) 중 한 가지 랜덤 추가 발송
                if (Math.random() < cfg.notice.tip_chance) {
                    // const messages = [  // w: weight, t: text
                    //     { w: 2, t: `📍"!몇화" 를 입력하면 현재 회차를 확인할 수 있습니다.` },
                    //     { w: 1, t: `📍"!다음화" 를 입력하면 다음 회차를 확인할 수 있습니다.` },
                    //     { w: 1, t: `📍"!마지막화" 를 입력하면 마지막 회차를 확인할 수 있습니다.` },
                    //     { w: 1, t: `📍"!명령어" 를 입력하면 봇 명령어 목록을 볼 수 있습니다.` },
                    //     { w: 1, t: `📍"!시간표" 를 입력하면 다음 회차부터 일정을 확인할 수 있습니다.` },
                    //     { w: 1, t: `📍"!날짜" 를 입력하면 해당 날짜의 에피소드 회차를 확인할 수 있습니다.` },
                    //     { w: 1, t: `📍"!몇화 <대사>"를 입력하면 해당 대사의 등장 시간을 확인할 수 있습니다. (예: !몇화 괜히똥만쌌네)` },
                    //     { w: 1, t: `📍"!몇화 <숫자>" 입력하면 해당 회차의 시작 시간을 확인할 수 있습니다. (예: !몇화 124)` },
                    //     { w: 1, t: `📍"!건의 <할말>" 을 입력하면 개발자에게 건의할 수 있습니다. (회차정보 오류나 기타 등등)` }
                    // ];

                    // const selectedMessage = (function (msg) { // 가중치 기반 랜덤 선택
                    //     let r = Math.random() * msg.reduce((s, m) => s + m.w, 0);
                    //     return msg.find(m => (r -= m.w) < 0).t;
                    // })(messages);

                    // sendChat(selectedMessage);
                }
            }, delay);
        }
    }

    // 감지 상태 갱신 (인덱스 유지, 슬립 감소)
    noticeIdx.index = rtn.index;
    --noticeIdx.sleep;
}

/**
 * !다음화, !다다음화 등 미래 에피소드 예정 시간을 안내.
 * @param {string} cmd - 파싱된 사용자의 원본 명령어 이름
 * @param {object} rtn - 계산 기준이 될 현재 에피소드 진행 데이터
 * @param {number} skipCount - 건너뛸 에피소드 수 (1=다음, 2=다다음)
 * @param {string} label - 출력될 텍스트 라벨 (예: "다음", "다다음")
 * @param {object} _input - 로깅 및 쿨타임 트리거 콜백 객체
 */
function printFutureEpisode(rtn, cmd, skipCount, label, _input) {
    const n = videoInfo.length;
    let currentIdx = (rtn.index + 1) % n;
    let info = null;
    let foundCount = 0;

    // 현재 인덱스 이후부터 재생 리스트를 순회하며 활성화(disable !== true)된 목표 에피소드 색인
    for (let i = 0; i < n; i++) {
        const e = videoInfo[currentIdx];
        if (!e.disable) {
            foundCount++;
            if (foundCount === skipCount) {
                info = e;
                break;
            }
        }
        currentIdx = (currentIdx + 1) % n; // 플레이리스트 루프 반복
    }

    if (info === null) {
        return returnWarning(msg.error.next_episode_not_found(label), cmd, _input);
    }

    // 찾은 에피소드가 방영될 미래의 예정 시각 계산
    const futureDate = roundUpTime(search_lib.getFutureDate(info, rtn, 0));
    const unicodenum = toUnicodeNumber(info.alias);
    const timestr = formatDate(futureDate);
    const emoji = getClockEmoji(timestr);

    setCooldown(cmd, 0, _input);
    return {
        msg: msg.episode.future(label, unicodenum, insertSpaces(info.title, retryPattern[0]), emoji, timestr, getCooldownMsg(cmd)),
        proc: function (attempt) {
            return msg.episode.future(label, unicodenum, insertSpaces(info.title, retryPattern[attempt]), emoji, timestr, getCooldownMsg(cmd));
        }
    };
}

/**
 * !시간표 명령어를 처리. 현재 시점 이후 연달아 방영될 회차들의 
 * 제목과 예상 시작 시각을 연속된 문자열로 이어붙여 요약 생성
 * @param {string} change - 동일 문구 스팸 차단 방어막용 특수 공백 패딩 문자열
 * @param {string} cmd - 실행된 명령어 이름
 * @param {number} limitLength - 유튜브 채팅 길이 제한 상한
 */
function printTimeTable(rtn, change, cmd, limitLength = cfg.timetable.default_limit) {
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
                str = insertSpaces(`${toUnicodeNumber(e.alias)}화)${e.shorten}`, change);
                currentIdx = (currentIdx + 1) % n;
                continue;
            }
            // 해당 에피소드의 방송 시작 예정 일시 계산
            const fdate = roundUpTime(search_lib.getFutureDate(e, rtn, 0));
            if (!pdate)
                pdate = fdate;

            // 출력 포맷 가공: '23:45)' 혹은 '12일00:15)' 형식으로 시간표 헤더 작성
            const hdr = `${formatDate(fdate, pdate, true)})`.replace(/ /g, '');
            // 에피소드 이름과 결합 ('→23:45)에피소드명')
            const candidate = insertSpaces((str ? "→" : "") + hdr + e.shorten, change);

            // 누적된 시간표 문자열의 총 길이가 채팅 제한치(limitLength)를 넘으면 그만 붙이고 즉시 반환
            if (str.length + candidate.length >= limitLength) {
                // if (Math.random() < 0.5)
                //     str += " (프로필에서 전체 시간표 확인이 가능합니다.)";
                return str + " " + getCooldownMsg(cmd);
            }

            str += candidate;
            pdate = fdate;
        }
        currentIdx = (currentIdx + 1) % n;
    }

    return str ? str + " " + getCooldownMsg(cmd) : null;
}

/**
 * 복수 에피소드 번호를 시간표 형식으로 출력
 * 입력: [1, 29, 30, 50] → "(현재회차)→[20일13:53]𝟷화→[20일14:55]𝟸𝟿화→..."
 * 동일 회차 반복 시 → 이번/다음/다다음 사이클의 방영 시각을 순차 표시
 * 가장 가까운 방영 순서대로 정렬, cfg.timetable.default_limit 글자 제한 적용
 * @param {object} rtn - 현재 에피소드 진행 데이터
 * @param {number[]} episodeNums - 요청된 에피소드 번호 배열
 * @param {string} cmd - 요청된 커맨드
 */
function printMultiEpisodeTimetable(rtn, episodeNums, cmd) {
    const limitLength = cfg.timetable.default_limit;
    const currentInfo = videoInfo[rtn.index];

    // 전체 사이클 시간(ms) 계산: 활성 에피소드들의 총 스트리밍 길이
    let totalCycleMs = 0;
    for (const ep of videoInfo) {
        if (!ep.disable) totalCycleMs += (ep._streamDurationSec || ep._durationSec || 0);
    }
    totalCycleMs *= 1000;

    // 동일 회차 반복 카운트 (같은 번호가 N번째 등장하면 (N-1)번째 사이클의 시각)
    const seenCount = {};

    // 각 요청 에피소드의 방영 예정 시각 계산
    const entries = [];
    for (const num of episodeNums) {
        const info = videoInfo.find(e => e.alias == num);
        if (!info) continue;

        // 이 회차가 몇 번째 등장인지 카운트
        seenCount[num] = (seenCount[num] || 0);
        const cycleOffset = seenCount[num];
        seenCount[num]++;

        // 기본 방영 시각 + 사이클 오프셋
        const baseFutureDate = roundUpTime(search_lib.getFutureDate(info, rtn, 0));
        const futureDate = new Date(baseFutureDate.getTime() + cycleOffset * totalCycleMs);

        entries.push({
            alias: info.alias,
            futureDate: futureDate,
        });
    }

    if (entries.length === 0) return null;

    // 가장 가까운 순서대로 정렬
    entries.sort((a, b) => a.futureDate.getTime() - b.futureDate.getTime());

    const makeMsg = (change) => {
        // 현재 회차를 무조건 맨 앞에 앵커로 표시
        const currentAlias = toUnicodeNumber(currentInfo.alias);
        let str = `${currentAlias}화`;
        let pdate = null;

        // 요청된 회차들을 시간순으로 출력
        for (const entry of entries) {
            const hdr = `${formatDate(entry.futureDate, pdate, true)})`.replace(/ /g, '');
            const unicodeAlias = toUnicodeNumber(entry.alias);
            const candidate = insertSpaces(`→${hdr}${unicodeAlias}화`, change);
            if (str.length + candidate.length >= limitLength) break;
            str += candidate;
            pdate = entry.futureDate;
        }

        return str + " " + getCooldownMsg(cmd);
    };

    return {
        msg: makeMsg(retryPattern[0]),
        proc: function (attempt) {
            return makeMsg(retryPattern[attempt]);
        }
    };
}

/**
 * !몇화 명령어 등 기본 정보 조회 시, 현재 스트리밍 중인 에피소드명과 끝날 때까지의 잔여 시간 안내
 * @param {object} rtn - 현재 에피소드 진행 데이터 
 * @param {string} cmd - 커맨드 명령어 문자열
 */
function printNowEpisode(rtn, cmd) {
    // 현재 방송 데이터 안에서 재생 중인 영상 메타 데이터를 추출
    const info = videoInfo[rtn.index];
    const unicodenum = toUnicodeNumber(info.alias);

    // 현재 방영 중인 에피소드가 끝나기까지 남은 시간(잔여 초수) 계산
    const timestr = toHHMMSS(rtn.end - rtn.now);

    return {
        // 응답 텍스트 포맷 (재시도 회차에 맞춘 스팸 회피용 공백 치환 포함)
        msg: msg.episode.now_playing(unicodenum, insertSpaces(info.title, retryPattern[0]), timestr, getCooldownMsg(cmd)),
        proc: function (attempt) {
            return msg.episode.now_playing(unicodenum, insertSpaces(info.title, retryPattern[attempt]), timestr, getCooldownMsg(cmd));
        }
    };
};

/**
 * 특정 숫자의 에피소드를 지정 조회(!몇화 N)할 경우 
 * 그 에피소드가 언제 방영될지, 미래의 방영 예정 시간(분)을 계산하여 안내
 * @param {object} rtn - 현재 에피소드 진행 데이터
 * @param {string} num - 검색하려는 대상 에피소드의 고유 번호(alias)
 * @param {string} cmd - 커맨드 명령어 문자열
 */
function printNumEpisode(rtn, num, cmd) {
    // 지정된 숫자 번호로 플레이리스트(영상 DB)에서 대상 에피소드 정보 조회
    const info = videoInfo.find(e => e.alias == num);

    if (!info)
        return null;

    // 요청한 회차가 현재 지금 이미 방영 중이면 별도 로직으로 현재 진행 상태 안내
    if (videoInfo[rtn.index] === info)
        return printNowEpisode(rtn, cmd);

    // 해당 회차가 방영될 상대적/절대적 미래 예상 날짜 도출
    const futureDate = info.disable ? null : roundUpTime(search_lib.getFutureDate(info, rtn, 0));
    const unicodenum = toUnicodeNumber(info.alias);
    const timestr = futureDate ? formatDate(futureDate) : null;
    const emoji = timestr ? getClockEmoji(timestr) : '';

    return {
        // 예정 시각 및 에피소드 제목 안내 텍스트 반환
        msg: msg.episode.scheduled(unicodenum, insertSpaces(info.title, retryPattern[0]),
            info.disable ? msg.episode.scheduled_no_stream : msg.episode.scheduled_time(emoji, timestr),
            getCooldownMsg(cmd)),
        proc: function (attempt) {
            return msg.episode.scheduled(unicodenum, insertSpaces(info.title, retryPattern[attempt]),
                info.disable ? msg.episode.scheduled_no_stream : msg.episode.scheduled_time(emoji, timestr),
                getCooldownMsg(cmd));
        }
    };
}

/**
 * 봇 기동 시 최초 1회만 실행.
 * LiveDownloader + LiveSearcher를 시작하고 이벤트 핸들러를 등록.
 * 에피소드 전환 안내 타이머도 활성화.
 */
function initCommand() {
    // 단축 평가 검사: 이미 초기화가 된 상태라면 중복 스케줄링이 되지 않도록 종료
    if (initCommand.__init)
        return;
    initCommand.__init = true;

    // LiveDownloader 초기화 (실시간 20초 세그먼트 연속 다운로드)
    const downloader = new LiveDownloader(schCfg, cfg.sync);

    // LiveSearcher 초기화 (searcher.exe 데몬 상시 구동)
    const searcher = new LiveSearcher(schCfg, cfg.sync);

    // 이벤트 연결: 세그먼트 다운로드 완료 → searcher 큐에 추가
    downloader.on('segment', (segmentInfo) => {
        searcher.enqueue(segmentInfo);
    });

    // 이벤트 연결: 매칭 결과 수신 → 싱크 보정
    searcher.on('match', ({ result, segment }) => {
        const cmp = getEpisodeInfo();
        const rtn = search_lib.processSearchResult(result, segment, cmp);
        onMatchResult(rtn);
    });

    // 에러 로깅
    downloader.on('error', (err) => {
        console.error('📥 다운로더 에러:', err.message);
    });

    // 초기 지연 후 시작
    setTimeout(() => {
        searcher.start();    // 데몬 먼저 시작 (DB 로드 시간 필요)
        setTimeout(() => {
            downloader.start(); // 데몬 준비 후 다운로더 시작
        }, cfg.sync.init_delay_ms);
    }, 1000);

    // 에피소드 전환 안내 메시지를 체크하는 타이머 활성화
    setInterval(noticeChangeEpisode, cfg.notice.check_interval_ms);

    // 프로세스 종료 시 정리
    const cleanup = () => {
        downloader.stop();
        searcher.stop();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);
}

let musicFreq = null;
function getMusicFreq() {
    if (musicFreq) return musicFreq;
    musicFreq = new Map();
    for (const epKey in musics) {
        const uniqueSongs = new Set();
        for (const m of musics[epKey]) {
            if (m && m.text) uniqueSongs.add(m.text);
        }
        for (const text of uniqueSongs) {
            musicFreq.set(text, (musicFreq.get(text) || 0) + 1);
        }
    }
    return musicFreq;
}

async function handleMusicCommand(rtn, cmd, args, _input) {
    if (cfg.music && !cfg.music.enable) {
        return returnWarning(msg.error.music_disabled, cmd, _input);
    }

    if (!args || args.length === 0) {
        setCooldown(cmd, 0, _input);
        if (!rtn || rtn.index === undefined) {
            return null;
        }
        const epInfo = videoInfo[rtn.index];
        const epKey = epInfo.name;
        const epMusics = musics[epKey] || [];

        const foundList = [];
        const historySec = (cfg.music && cfg.music.history_sec !== undefined) ? cfg.music.history_sec : 180;
        const historyMin = Math.floor(historySec / 60);

        // 현재 에피소드의 음악 스캔
        for (let i = epMusics.length - 1; i >= 0; i--) {
            const m = epMusics[i];
            const startSec = fromHHMMSS(m.start);
            const endSec = fromHHMMSS(m.end);

            if (rtn.now >= startSec && rtn.now <= endSec) {
                foundList.push({ diff: 0, text: m.text });
            } else if (endSec < rtn.now && rtn.now - endSec <= historySec) {
                let d = Math.floor((rtn.now - endSec) / 60);
                if (d === 0) d = 1;
                foundList.push({ diff: d, text: m.text });
            }
        }

        // 이전 에피소드의 음악도 스캔 (history_sec 범위가 현재 에피소드 시작 이전까지 확장될 때)
        let remainingHistory = historySec - rtn.now;
        if (remainingHistory > 0) {
            let elapsedFromCurrent = rtn.now; // 현재 에피소드에서 경과한 시간
            let prevIdx = (rtn.index - 1 + videoInfo.length) % videoInfo.length;

            while (remainingHistory > 0 && prevIdx !== rtn.index) {
                const prevEp = videoInfo[prevIdx];
                if (!prevEp.disable) {
                    const prevKey = prevEp.name;
                    const prevMusics = musics[prevKey] || [];
                    const prevEnd = prevEp._effectiveEndSec;

                    for (let i = prevMusics.length - 1; i >= 0; i--) {
                        const m = prevMusics[i];
                        const startSec = fromHHMMSS(m.start);
                        const endSec = fromHHMMSS(m.end);

                        // 곡의 끝 시점이 이전 에피소드 유효 종료 범위 내에 있는지 확인
                        if (endSec > prevEnd) continue;

                        // 이전 에피소드의 끝(prevEnd)에서 곡 종료까지의 거리
                        const distFromPrevEnd = prevEnd - endSec;

                        if (distFromPrevEnd > remainingHistory) continue;

                        // 현재 시점으로부터의 총 경과 시간 (분)
                        const totalDiffSec = elapsedFromCurrent + distFromPrevEnd;
                        let d = Math.floor(totalDiffSec / 60);
                        if (d === 0) d = 1;
                        foundList.push({ diff: d, text: m.text });
                    }

                    elapsedFromCurrent += prevEnd;
                    remainingHistory -= prevEnd;
                }
                prevIdx = (prevIdx - 1 + videoInfo.length) % videoInfo.length;
            }
        }

        if (foundList.length > 0) {
            const enablePenalty = cfg.music && cfg.music.frequent_penalty_enable !== false;
            const freqThreshold = (cfg.music && cfg.music.frequent_threshold) ? cfg.music.frequent_threshold : 20;
            const freqMap = enablePenalty ? getMusicFreq() : null;

            foundList.forEach(item => {
                item.penalty = 0;
                if (enablePenalty && (freqMap.get(item.text) || 0) >= freqThreshold) {
                    item.penalty = Infinity;
                }
            });

            // 우선순위에 따라 정렬 (페널티 없으면 앞, 최근 곡일수록 앞)
            foundList.sort((a, b) => {
                if (a.penalty !== b.penalty) return a.penalty - b.penalty;
                return a.diff - b.diff;
            });

            // max_length 초과 시 우선순위가 낮은(배열의 뒤쪽) 곡부터 제거
            if (cfg.music && cfg.music.max_length) {
                while (foundList.length > 1) {
                    let tempStr = foundList.map(item => item.diff === 0 ? msg.music.currently_playing(item.text) : msg.music.played_ago(item.diff, item.text)).join(' ');
                    if (tempStr.length <= cfg.music.max_length) break;
                    foundList.pop();
                }
            }

            // 출력할 살아남은 곡들을 다시 최신순(현재 -> 1분 전 -> 3분 전)으로 정렬
            foundList.sort((a, b) => a.diff - b.diff);

            let msg_str = foundList.map(item => {
                if (item.diff === 0) return msg.music.currently_playing(item.text);
                return msg.music.played_ago(item.diff, item.text);
            }).join(' ');

            if (cfg.music && cfg.music.max_length && msg_str.length > cfg.music.max_length) {
                msg_str = msg_str.substring(0, cfg.music.max_length);
            }

            return {
                msg: `${msg_str} ${getCooldownMsg(cmd)}`,
                proc: () => `${msg_str} ${getCooldownMsg(cmd)}`
            };
        } else {
            return {
                msg: returnWarning(msg.error.music_none_playing(historyMin), cmd, _input),
                proc: () => `${msg.error.music_none_playing(historyMin)} ${getCooldownMsg(cmd)}`
            };
        }
    }

    const query = args.join(' ');

    const searchInfo = musicSearcher.search(query);
    if (searchInfo && searchInfo.length > 0) {
        searchInfo.sort((a, b) => b.score - a.score);

        const validResults = [];
        const removeDup = searchInfo.filter(
            (item, index, self) => index === self.findIndex(obj => obj.key === item.key)
        );

        const minScore = (cfg.music && cfg.music.min_score !== undefined) ? cfg.music.min_score : cfg.subtitle_score.min_value;

        for (const result of removeDup) {
            const matched = result.matchedIndices;
            if (!matched || matched.length === 0) continue;

            if (result.score > minScore) {
                const key = result.key;
                const subInfo = videoInfo.find(e => e.name === key);
                if (!subInfo) continue;

                // matched에 여러 인덱스가 올 수 있으므로 (결합 매칭)
                // 편집 구간에 걸리지 않는 곡을 우선 선택
                let bestMObj = null;
                let bestOutOfbounds = true;
                for (const idx of matched) {
                    const candidate = musics[key][idx - 1];
                    if (!candidate) continue;
                    const t = fromHHMMSS(candidate.start);
                    let oob = !!subInfo.disable;
                    if (!oob && subInfo._editParsed) {
                        for (const et of subInfo._editParsed) {
                            if (t >= et.s && t <= et.e) {
                                oob = true;
                                break;
                            }
                        }
                    }
                    if (!oob) {
                        bestMObj = candidate;
                        bestOutOfbounds = false;
                        break;
                    }
                    if (!bestMObj) {
                        bestMObj = candidate;
                    }
                }

                if (bestMObj && subInfo) {
                    const subTime = fromHHMMSS(bestMObj.start);

                    const unicodenum = toUnicodeNumber(subInfo.alias);
                    const rawHwa = `${unicodenum}화`;

                    const futureDate = roundUpTime(search_lib.getFutureDate(subInfo, rtn, subTime));
                    const timestr = formatDate(futureDate);
                    const emoji = getClockEmoji(timestr);

                    const timeMsg = bestOutOfbounds ?
                        msg.subtitle.not_in_stream_short :
                        `${emoji} ${timestr.replace(/\((월|화|수|목|금|토|일)\)/g, "")}`;

                    validResults.push({
                        aliasInt: parseInt(subInfo.alias, 10) || 0,
                        rawHwa,
                        timeMsg: timeMsg.replace(/ /g, '')
                    });
                }
            }
        }

        if (validResults.length > 0) {
            setCooldown(cmd, 0, _input);
            _input.warn = _input.warn; // 이미 handleCommand에서 할당된 warn값 유지

            validResults.sort((a, b) => a.aliasInt - b.aliasInt);
            const detailsList = validResults.map(r => `${r.rawHwa}(${r.timeMsg})`);

            let detailsStr = detailsList.join(', ');
            if (cfg.music && cfg.music.max_length) {
                let testMsg = msg.music.found_episodes(detailsStr);
                if (testMsg.length > cfg.music.max_length && detailsList.length > 1) {
                    while (detailsList.length > 1) {
                        detailsList.pop();
                        detailsStr = detailsList.join(', ') + '...';
                        testMsg = msg.music.found_episodes(detailsStr);
                        if (testMsg.length <= cfg.music.max_length) break;
                    }
                }
                // If even 1 item is too long, we just substring
                if (testMsg.length > cfg.music.max_length) {
                    detailsStr = detailsStr.substring(0, cfg.music.max_length - 20) + '...';
                }
            }

            const makeMsg = (attempt) => {
                const spaces = " ".repeat(attempt);
                const builtMsg = msg.music.found_episodes(detailsStr);
                return `${builtMsg}${spaces} ${getCooldownMsg(cmd)}`;
            };

            return {
                msg: makeMsg(0),
                proc: (attempt) => makeMsg(attempt)
            };
        }
    }

    return {
        msg: returnWarning(msg.error.music_not_found, cmd, _input),
        proc: () => `${msg.error.music_not_found} ${getCooldownMsg(cmd)}`
    };
}

function getCooldownState() {
    const now = Date.now();
    const globalCooldownMs = 1000 * 60 * cfg.cooldown.time_min;

    const state = {
        mode: cfg.cooldown.mode,
        global: {
            lastTime: delayChatTime,
            cooldownMs: globalCooldownMs,
            remainingMs: Math.max(0, globalCooldownMs - (now - delayChatTime))
        },
        groups: {}
    };

    if (cfg.cooldown.mode === 'per-command') {
        for (const group of Object.keys(COMMAND_GROUPS)) {
            const config = getCooldownConfig(group);

            const cooldownMs = 1000 * 60 * config.time;
            const lastTime = delayChatTimeMap.get(config.key) || 0;
            state.groups[group] = {
                cooldownMs: cooldownMs,
                lastTime: lastTime,
                remainingMs: Math.max(0, cooldownMs - (now - lastTime))
            };
        }
    }
    return state;
}

module.exports = { initCommand, handleCommand, getEpisodeInfo, getCooldownState };
