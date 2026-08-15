const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const vm = require('vm');


const chatHistory = require('./chat-history.js');
const { banUser, blockUser } = require('./innertube.js');
const search_lib = require('./video-matcher/search.js');
const { extractLatestSegmentFrame } = require('./video-matcher/live-downloader.js');
const cfgYoutube = require('../data/config-youtube.js');
const eventBus = require('./event-bus.js');
const commandsLib = require('./commands.js');
const statsTracker = require('./stats-db.js');

let spamGuardRef = null;
let getEpisodeInfoRef = null;
let clients = new Set();

const MUTE_FILE = path.join(__dirname, '../data', 'bot-mute.json');
let botMuted = false;
try {
    botMuted = JSON.parse(fs.readFileSync(MUTE_FILE, 'utf8')).muted === true;
} catch { }

function isBotMuted() {
    return botMuted;
}

function saveMuteState() {
    try { fs.writeFileSync(MUTE_FILE, JSON.stringify({ muted: botMuted }), 'utf8'); } catch { }
}

// ═══════════════════════════════════════
//  로그 버퍼 (최근 N개 메모리 보관)
// ═══════════════════════════════════════
const MAX_SEARCH_LOGS = 200;
const MAX_COMMAND_LOGS = 300;
const MAX_VIOLATION_LOGS = 100;
const MAX_LASTQUERY_HISTORY = 100000;
const searchLogs = [];
const commandLogs = [];
const violationLogs = [];
let lastqueryHistory = [];

const HISTORY_FILE = path.join(__dirname, '../data', 'lastquery-history.json');
try {
    if (fs.existsSync(HISTORY_FILE)) {
        lastqueryHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
} catch (e) {
    console.error("Failed to load lastquery history", e);
}

function saveHistoryFile() {
    fs.writeFile(HISTORY_FILE, JSON.stringify(lastqueryHistory), (err) => {
        if(err) console.error("Failed to save lastquery history", err);
    });
}

// 이벤트 버스 리스너
eventBus.on('search_result', (data) => {
    const entry = { time: Date.now(), ...data };
    searchLogs.push(entry);
    while (searchLogs.length > MAX_SEARCH_LOGS) searchLogs.shift();
    broadcastMsg({ action: 'search_push', payload: entry });
});

eventBus.on('segment_violation', (data) => {
    const entry = { time: Date.now(), ...data };
    violationLogs.push(entry);
    while (violationLogs.length > MAX_VIOLATION_LOGS) violationLogs.shift();
    broadcastMsg({ action: 'violation_push', payload: entry });
});

eventBus.on('command_used', (data) => {
    commandLogs.push(data);
    while (commandLogs.length > MAX_COMMAND_LOGS) commandLogs.shift();
    broadcastMsg({ action: 'command_push', payload: data });
});

eventBus.on('lastquery_update', (data) => {
    const entry = { ...data, recordedAt: Date.now() };
    lastqueryHistory.push(entry);
    while (lastqueryHistory.length > MAX_LASTQUERY_HISTORY) lastqueryHistory.shift();
    saveHistoryFile();
    broadcastMsg({ action: 'lastquery_history_push', payload: { total: lastqueryHistory.length } });
});

function generateScheduleFromEpInfo(epInfo) {
    if (!epInfo || !search_lib.videoInfo) return [];
    const n = search_lib.videoInfo.length;
    const schedule = [];
    let currentIdx = epInfo.index % n;
    let count = 0;
    let cIdx = currentIdx;
    while (count < n && schedule.length < 150) {
        const e = search_lib.videoInfo[cIdx];
        if (!e.disable) {
            const fdate = search_lib.getFutureDate(e, epInfo, 0);
            schedule.push({
                alias: e.alias,
                title: e.title || e.shorten || e.name,
                date: fdate.getTime(),
                isCurrent: count === 0
            });
        }
        cIdx = (cIdx + 1) % n;
        count++;
    }
    return schedule;
}

function broadcastMsg(data) {
    const msg = JSON.stringify(data);
    for (const client of clients) {
        if (!client.destroyed) {
            sendWSFrame(client, msg);
        }
    }
}

// WS 데이터 전송 헬퍼 (초경량 프레이밍)
function sendWSFrame(socket, text) {
    const payload = zlib.deflateSync(Buffer.from(text, 'utf8'));
    const length = payload.length;
    let header;

    if (length <= 125) {
        header = Buffer.alloc(2);
        header[0] = 0x82;
        header[1] = length;
    } else if (length <= 65535) {
        header = Buffer.alloc(4);
        header[0] = 0x82;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x82;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }

    socket.write(Buffer.concat([header, payload]));
}

// WS 메시지 파싱 헬퍼
function parseWSFrame(buffer) {
    if (buffer.length < 2) return null;
    const isMasked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7F;
    let offset = 2;

    if (length === 126) {
        if (buffer.length < 4) return null;
        length = buffer.readUInt16BE(2);
        offset = 4;
    } else if (length === 127) {
        if (buffer.length < 10) return null;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
    }

    if (!isMasked || buffer.length < offset + 4 + length) return null;

    const opcode = buffer[0] & 0x0F;
    if (opcode === 0x8) return { isControl: true, byteLength: offset + length }; // Close
    if (opcode === 0x9 || opcode === 0xA) return { isControl: true, byteLength: offset + length }; // Ping or Pong

    const masks = buffer.slice(offset, offset + 4);
    offset += 4;
    const data = Buffer.from(buffer.slice(offset, offset + length)); // Create a copy of payload

    if (isMasked) {
        for (let i = 0; i < data.length; i++) {
            data[i] ^= masks[i % 4];
        }
    }

    if (opcode !== 0x1 && opcode !== 0x2) {
        return { isControl: true, byteLength: offset + length }; // Non-text frame
    }

    if (opcode === 0x2) {
        return { isBinary: true, data: data, byteLength: offset + length };
    }

    return { data: data.toString('utf8'), byteLength: offset + length };
}

function broadcastSpam() {
    const spammers = [];
    if (spamGuardRef) {
        const now = Date.now();
        // 명령어 사용자 추가 (commandHistory 기준 penaltyDuration 이내)
        for (const [channelId, data] of spamGuardRef.tracker.entries()) {
            if (spamGuardRef.banned.has(channelId)) continue;
            const info = spamGuardRef.getTrackerInfo(channelId);
            if (!info || (info.commandCount <= 0 && data.warns <= 0 && !data.searchBanned)) continue;
            spammers.push({
                channelId,
                count: data.warns,
                warnLimit: spamGuardRef.warnLimit,
                name: (info && info.displayName) || data.displayName || '이름 불명',
                block: false,
                reason: data.searchBanned ? '검색 차단됨' : (data.warns > 0 ? '경고 누적' : '명령어 사용'),
                remainingMs: info.remainingMs,
                commandCount: info.commandCount,
                searchBanned: data.searchBanned
            });
        }
        // 밴된 유저 추가
        for (const [channelId, data] of spamGuardRef.banned.entries()) {
            spammers.push({
                channelId,
                count: spamGuardRef.warnLimit || 0,
                name: data.displayName || '이름 불명',
                block: true,
                reason: data.reason || '도배',
                bannedAt: data.bannedAt || null
            });
        }
    }
    broadcastMsg({ action: 'spam_list', payload: spammers });
}

function processClientMessage(client, message) {
    try {
        const parsed = JSON.parse(message);
        handleAction(client, parsed);
    } catch (e) {
        console.error("WS Parse error", e);
    }
}

async function handleAction(client, req) {
    const { action, payload } = req;

    if (action === 'getState') {
        const epInfo = getEpisodeInfoRef ? getEpisodeInfoRef() : null;
        let totalEpisodes = cfgYoutube.episode ? cfgYoutube.episode.end : 0;
        let totalTime = 0;
        let totalEpCount = search_lib.videoInfo ? search_lib.videoInfo.length : 0;

        let episodeAlias = null;
        if (epInfo && search_lib.videoInfo && search_lib.videoInfo[epInfo.index]) {
            const epEntry = search_lib.videoInfo[epInfo.index];
            totalTime = epEntry._streamDurationSec || 0;
            episodeAlias = epEntry.alias || epEntry.title || epEntry.shorten || epEntry.name || null;
        }

        sendWSFrame(client, JSON.stringify({
            action: 'state',
            payload: {
                episodeInfo: epInfo,
                totalEpisodes: totalEpisodes || totalEpCount,
                totalTime: totalTime,
                episodeAlias: episodeAlias,
                videoId: cfgYoutube.yt ? cfgYoutube.yt.video_id : null,
                botMuted: botMuted,
                cooldownState: commandsLib.getCooldownState()
            }
        }));
    }
    else if (action === 'setMute') {
        botMuted = payload;
        saveMuteState();
        broadcastMsg({ action: 'mute_state', payload: botMuted });
    }
    else if (action === 'getChat') {
        sendWSFrame(client, JSON.stringify({ action: 'chat_history', payload: chatHistory.getMessages() }));
    }
    else if (action === 'getSpam') {
        const spammers = [];
        if (spamGuardRef) {
            for (const [channelId, data] of spamGuardRef.tracker.entries()) {
                if (spamGuardRef.banned.has(channelId)) continue;
                const info = spamGuardRef.getTrackerInfo(channelId);
                if (!info || (info.commandCount <= 0 && data.warns <= 0 && !data.searchBanned)) continue;
                spammers.push({
                    channelId,
                    count: data.warns,
                    warnLimit: spamGuardRef.warnLimit,
                    name: (info && info.displayName) || data.displayName || '이름 불명',
                    block: false,
                    reason: data.searchBanned ? '검색 차단됨' : (data.warns > 0 ? '경고 누적' : '명령어 사용'),
                    remainingMs: info.remainingMs,
                    commandCount: info.commandCount,
                    searchBanned: data.searchBanned
                });
            }
            for (const [channelId, data] of spamGuardRef.banned.entries()) {
                spammers.push({ channelId, count: spamGuardRef.warnLimit || 0, name: data.displayName || '이름 불명', block: true, reason: data.reason || '도배', bannedAt: data.bannedAt || null });
            }
        }
        sendWSFrame(client, JSON.stringify({ action: 'spam_list', payload: spammers }));
    }
    else if (action === 'ban') {
        const { channelId, displayName, contextMenuParams } = payload;

        console.log(`[WebAdmin🛠️] 유튜브 유저 차단 시도: ${displayName || channelId}`);
        if (contextMenuParams) {
            // 실패하더라도 스팸가드에는 무조건 등록하기 위해 return 받지 않음
            blockUser(contextMenuParams).catch(e => console.error("blockUser 오류:", e));
        }

        if (spamGuardRef) {
            spamGuardRef.manualBan(channelId, displayName, '대시보드 수동 차단');
        }

        sendWSFrame(client, JSON.stringify({ action: 'ban_result', payload: { success: true } }));
        broadcastSpam();
    }
    else if (action === 'spamAdd') {
        const { channelId, displayName, reason } = payload;
        if (spamGuardRef) {
            spamGuardRef.manualBan(channelId, displayName, reason);
        }
        sendWSFrame(client, JSON.stringify({ action: 'spamAdd_result', payload: { success: true } }));
        broadcastSpam();
    }
    else if (action === 'banSearch') {
        const { channelId, displayName } = payload;
        if (spamGuardRef) spamGuardRef.banSearch(channelId, displayName);
        sendWSFrame(client, JSON.stringify({ action: 'banSearch_result', payload: { success: true } }));
        broadcastSpam();
    }
    else if (action === 'allowSearch') {
        const { channelId } = payload;
        if (spamGuardRef) spamGuardRef.allowSearch(channelId);
        sendWSFrame(client, JSON.stringify({ action: 'allowSearch_result', payload: { success: true } }));
        broadcastSpam();
    }
    else if (action === 'adjustWarn') {
        const { channelId, delta } = payload;
        if (spamGuardRef) {
            const r = spamGuardRef.tracker.get(channelId);
            if (r) {
                r.warns = Math.max(0, (r.warns || 0) + delta);
                spamGuardRef._refreshExpiry(r);
                spamGuardRef._saveTrackerDebounced();
                sendWSFrame(client, JSON.stringify({ action: 'warnAdjust_result', payload: { success: true, newCount: r.warns } }));
                broadcastSpam();
            } else {
                sendWSFrame(client, JSON.stringify({ action: 'warnAdjust_result', payload: { success: false, error: '트래커에 없는 유저' } }));
            }
        }
    }
    else if (action === 'adjustUsage') {
        const { channelId, delta } = payload;
        if (spamGuardRef) {
            const r = spamGuardRef.tracker.get(channelId);
            if (r) {
                if (!r.commandHistory) r.commandHistory = [];
                const now = Date.now();
                // 유효한 이력만 보존
                r.commandHistory = r.commandHistory.filter(t => now - t < spamGuardRef.penaltyDurationMs);
                if (delta > 0) {
                    for (let i = 0; i < delta; i++) r.commandHistory.push(now);
                } else if (delta < 0) {
                    // 가장 오래된 것부터 제거
                    const removeCount = Math.min(-delta, r.commandHistory.length);
                    r.commandHistory.splice(0, removeCount);
                }
                spamGuardRef._refreshExpiry(r);
                spamGuardRef._saveTrackerDebounced();
                sendWSFrame(client, JSON.stringify({ action: 'usageAdjust_result', payload: { success: true, newCount: r.commandHistory.length } }));
                broadcastSpam();
            } else {
                sendWSFrame(client, JSON.stringify({ action: 'usageAdjust_result', payload: { success: false, error: '트래커에 없는 유저' } }));
            }
        }
    }
    else if (action === 'getUserDetail') {
        const { channelId } = payload;
        if (spamGuardRef) {
            const r = spamGuardRef.tracker.get(channelId);
            if (r) {
                const now = Date.now();
                const history = (r.commandHistory || []).filter(t => now - t < spamGuardRef.penaltyDurationMs);
                const searchHistory = r.searchHistory || [];
                sendWSFrame(client, JSON.stringify({
                    action: 'userDetail',
                    payload: {
                        channelId,
                        displayName: r.displayName || null,
                        warns: r.warns || 0,
                        penaltyExpiresAt: r.penaltyExpiresAt || 0,
                        lastWarnedAt: r.lastWarnedAt || 0,
                        commandHistory: history,
                        searchHistory: searchHistory
                    }
                }));
            } else {
                sendWSFrame(client, JSON.stringify({ action: 'userDetail', payload: null }));
            }
        }
    }
    else if (action === 'spamDelete') {
        const { channelId } = payload;
        if (spamGuardRef) {
            spamGuardRef.removeBan(channelId);
        }
        sendWSFrame(client, JSON.stringify({ action: 'spamDelete_result', payload: { success: true } }));
        broadcastSpam();
    }
    else if (action === 'getConfig') {
        const cfgYoutubeText = fs.readFileSync(path.join(__dirname, '../data', 'config-youtube.js'), 'utf8');
        const cfgSearchText = fs.readFileSync(path.join(__dirname, '../data', 'config-search.js'), 'utf8');
        sendWSFrame(client, JSON.stringify({ action: 'config_data', payload: { youtube: cfgYoutubeText, search: cfgSearchText } }));
    }
    else if (action === 'saveConfig') {
        const { target, content } = payload;
        try {
            if (target === 'youtube') {
                fs.writeFileSync(path.join(__dirname, '../data', 'config-youtube.js'), content, 'utf8');
            } else if (target === 'search') {
                fs.writeFileSync(path.join(__dirname, '../data', 'config-search.js'), content, 'utf8');
            }
            sendWSFrame(client, JSON.stringify({ action: 'saveConfig_result', payload: { success: true } }));
        } catch (e) {
            sendWSFrame(client, JSON.stringify({ action: 'saveConfig_result', payload: { success: false, error: e.message } }));
        }
    }
    else if (action === 'getLiveFrame') {
        const result = await extractLatestSegmentFrame();
        sendWSFrame(client, JSON.stringify({ action: 'liveFrame_result', payload: result }));
    }
    // ── 새 기능: video-info.json 편집 ──
    else if (action === 'getVideoInfo') {
        try {
            const viText = fs.readFileSync(path.join(__dirname, '../data', 'video-info.json'), 'utf8')
                .replace(/^\uFEFF/, '').trim(); // BOM 및 앞뒤 공백 제거
            sendWSFrame(client, JSON.stringify({ action: 'videoInfo_data', payload: viText }));
        } catch (e) {
            sendWSFrame(client, JSON.stringify({ action: 'videoInfo_data', payload: '[]' }));
        }
    }
    else if (action === 'saveVideoInfo') {
        const { content } = payload;
        try {
            // BOM, \r, 앞뒤 공백 제거 후 JSON 유효성 검증
            const cleanContent = content.replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
            JSON.parse(cleanContent);
            fs.writeFileSync(path.join(__dirname, '../data', 'video-info.json'), cleanContent, 'utf8');
            // 재부팅 없이 즉시 메모리에 반영
            const reloaded = search_lib.reloadVideoInfo();
            sendWSFrame(client, JSON.stringify({ action: 'saveVideoInfo_result', payload: { success: true, reloaded } }));
        } catch (e) {
            sendWSFrame(client, JSON.stringify({ action: 'saveVideoInfo_result', payload: { success: false, error: e.message } }));
        }
    }
    // ── config-messages.js 조회 및 즉시 반영 편집 ──
    else if (action === 'getConfigMessages') {
        try {
            const msgText = fs.readFileSync(path.join(__dirname, '../data', 'config-messages.js'), 'utf8')
                .replace(/^\uFEFF/, '').trim();
            sendWSFrame(client, JSON.stringify({ action: 'configMessages_data', payload: msgText }));
        } catch (e) {
            sendWSFrame(client, JSON.stringify({ action: 'configMessages_data', payload: 'module.exports = {};' }));
        }
    }
    else if (action === 'saveConfigMessages') {
        const { content } = payload;
        try {
            const cleanContent = (content || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();

            // 1. JS 문법 및 module.exports 유효성 검사 (샌드박스 VM)
            const script = new vm.Script(cleanContent, { filename: 'config-messages.js' });
            const sandbox = { module: { exports: {} }, exports: {} };
            vm.createContext(sandbox);
            script.runInContext(sandbox);

            if (!sandbox.module.exports || typeof sandbox.module.exports !== 'object') {
                throw new Error('module.exports 가 올바른 객체 형식이 아닙니다.');
            }

            // 2. 파일 저장
            fs.writeFileSync(path.join(__dirname, '../data', 'config-messages.js'), cleanContent, 'utf8');

            // 3. 재부팅 없이 메모리 핫리로드
            commandsLib.reloadMessages();

            sendWSFrame(client, JSON.stringify({ action: 'saveConfigMessages_result', payload: { success: true } }));
        } catch (e) {
            sendWSFrame(client, JSON.stringify({ action: 'saveConfigMessages_result', payload: { success: false, error: e.message } }));
        }
    }
    // ── 새 기능: video-sub.json 리로드 ──
    else if (action === 'reloadVideoSub') {
        const videoSubManager = require('./sub-manager.js');
        const success = videoSubManager.reloadVideoSub();
        sendWSFrame(client, JSON.stringify({ action: 'reloadVideoSub_result', payload: { success } }));
    }
    // ── 새 기능: 봇 재부팅 (설정 리로드) ──
    else if (action === 'reboot_bot') {
        console.log("🔄 관리자 웹에서 재부팅 요청을 받았습니다. 프로세스를 종료합니다...");
        sendWSFrame(client, JSON.stringify({ action: 'notification', payload: 'Rebooting...' }));
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    }
    // ── 새 기능: 대시보드에서 가상 채팅 보내기 (디버깅) ──
    else if (action === 'simulate_chat') {
        eventBus.emit('simulate_chat', payload);
        sendWSFrame(client, JSON.stringify({ action: 'simulate_chat_result', payload: { success: true } }));
    }
    // ── 새 기능: 검색 로그 ──
    else if (action === 'getSearchLogs') {
        sendWSFrame(client, JSON.stringify({ action: 'search_logs', payload: searchLogs }));
        sendWSFrame(client, JSON.stringify({ action: 'violation_logs', payload: violationLogs }));
    }
    // ── 새 기능: 명령어 로그 ──
    else if (action === 'getCommandLogs') {
        sendWSFrame(client, JSON.stringify({ action: 'command_logs', payload: commandLogs }));
    }
    // ── 신 기능: 편성표 ──
    else if (action === 'getSchedule') {
        const epInfo = getEpisodeInfoRef ? getEpisodeInfoRef() : null;
        sendWSFrame(client, JSON.stringify({ action: 'schedule_data', payload: generateScheduleFromEpInfo(epInfo) }));
    }
    // ── 새 기능: lastquery 이력 조회 ──
    else if (action === 'getLastqueryHistory') {
        let currentQuery = null;
        try {
            currentQuery = JSON.parse(fs.readFileSync(path.join(__dirname, '../data', 'lastquery.json'), 'utf8'));
        } catch(e) {}
        sendWSFrame(client, JSON.stringify({
            action: 'lastquery_history_data',
            payload: {
                history: lastqueryHistory,
                current: currentQuery,
                total: lastqueryHistory.length
            }
        }));
    }
    // ── 새 기능: lastquery 이력 삭제 ──
    else if (action === 'clearLastqueryHistory') {
        lastqueryHistory = [];
        saveHistoryFile();
        sendWSFrame(client, JSON.stringify({ action: 'lastquery_history_data', payload: { history: [], current: null, total: 0 } }));
        broadcastMsg({ action: 'lastquery_history_push', payload: { total: 0 } });
    }
    // ── 새 기능: 특정 시점 lastquery로 조정된 상태 조회 ──
    else if (action === 'getStateAtHistory') {
        const { historyIndex } = payload; // lastqueryHistory 배열 인덱스 (-1 = 현재)
        let targetQuery = null;
        if (historyIndex === -1) {
            try {
                targetQuery = JSON.parse(fs.readFileSync(path.join(__dirname, '../data', 'lastquery.json'), 'utf8'));
            } catch(e) {}
        } else if (historyIndex >= 0 && historyIndex < lastqueryHistory.length) {
            targetQuery = lastqueryHistory[historyIndex];
        }
        if (!targetQuery) {
            sendWSFrame(client, JSON.stringify({ action: 'stateAtHistory_data', payload: null }));
            return;
        }
        // 해당 시점의 에피소드 정보 계산
        const epInfo = search_lib.getAdjustedVideoTime(targetQuery.requestTime, targetQuery.now, targetQuery.index);
        let totalEpisodes = cfgYoutube.episode ? cfgYoutube.episode.end : 0;
        let totalTime = 0;
        let episodeAlias = null;
        let totalEpCount = search_lib.videoInfo ? search_lib.videoInfo.length : 0;
        if (epInfo && search_lib.videoInfo && search_lib.videoInfo[epInfo.index]) {
            const epEntry = search_lib.videoInfo[epInfo.index];
            totalTime = epEntry._streamDurationSec || 0;
            episodeAlias = epEntry.alias || epEntry.title || epEntry.shorten || epEntry.name || null;
        }
        // 현재 lastquery.json도 getAdjustedVideoTime으로 현재 시각 기준 video time 계산
        let currentQuery = null;
        try {
            currentQuery = JSON.parse(fs.readFileSync(path.join(__dirname, '../data', 'lastquery.json'), 'utf8'));
        } catch(e) {}
        // 양쪽 다 getAdjustedVideoTime으로 현재 시각 기준으로 보정한 video time의 차이
        let diffSec = 0;
        if (currentQuery) {
            const currentEpInfo = search_lib.getAdjustedVideoTime(currentQuery.requestTime, currentQuery.now, currentQuery.index);
            if (currentEpInfo && epInfo) {
                diffSec = currentEpInfo.now - epInfo.now;
            }
        }
        sendWSFrame(client, JSON.stringify({
            action: 'stateAtHistory_data',
            payload: {
                episodeInfo: epInfo,
                totalEpisodes: totalEpisodes || totalEpCount,
                totalTime: totalTime,
                episodeAlias: episodeAlias,
                query: targetQuery,
                diffSec: diffSec,
                historyIndex: historyIndex,
                total: lastqueryHistory.length,
                schedule: generateScheduleFromEpInfo(epInfo)
            }
        }));
    }
    // ── 새 기능: 유저 통계 개요 조회 ──
    else if (action === 'getUserStatsOverview') {
        const overview = statsTracker ? statsTracker.getGlobalOverview() : null;
        sendWSFrame(client, JSON.stringify({ action: 'userStatsOverview_data', payload: overview }));
    }
    // ── 새 기능: 유저 통계 검색 및 랭킹 정렬 ──
    else if (action === 'searchUserStats') {
        const { query, sortBy, sortOrder, limit, offset } = payload || {};
        const result = statsTracker ? statsTracker.searchUsers({ query, sortBy, sortOrder, limit: limit || 50, offset: offset || 0 }) : { users: [], total: 0 };
        sendWSFrame(client, JSON.stringify({ action: 'userStatsSearch_data', payload: result }));
    }
    // ── 새 기능: 유저 통계 상세 및 일자별 히스토리 ──
    else if (action === 'getUserStatsDetail') {
        const { channelId } = payload || {};
        const detail = statsTracker ? statsTracker.getUserDetail(channelId) : null;
        sendWSFrame(client, JSON.stringify({ action: 'userStatsDetail_data', payload: detail }));
    }
}

function startServer(port, spamGuard, getEpisodeInfo) {
    spamGuardRef = spamGuard;
    getEpisodeInfoRef = getEpisodeInfo;

    const server = http.createServer((req, res) => {
        // 대시보드 정적 호스팅
        if (req.method === 'GET') {
            const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            let pathname = parsedUrl.pathname;
            if (pathname === '/') pathname = '/index.html';

            let filePath = path.join(__dirname, 'public', pathname);
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'application/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8'
            };

            if (mimeTypes[ext]) {
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Not Found');
                    } else {
                        res.writeHead(200, {
                            'Content-Type': mimeTypes[ext],
                            'Cache-Control': 'no-cache, no-store, must-revalidate'
                        });
                        res.end(data);
                    }
                });
                return;
            }
        }

        res.writeHead(404);
        res.end('Not Found');
    });

    // WebSocket 핸드쉐이크 직접 처리 (의존성 최소화)
    server.on('upgrade', (req, socket, head) => {
        const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
        if (pathname === '/ws') {
            const key = req.headers['sec-websocket-key'];
            const hash = crypto.createHash('sha1')
                .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                .digest('base64');

            socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${hash}\r\n\r\n`);

            clientConnected(socket);

            let buffer = Buffer.alloc(0);
            socket.on('data', chunk => {
                buffer = Buffer.concat([buffer, chunk]);
                // 프레임들을 처리
                while (true) {
                    const parsed = parseWSFrame(buffer);
                    if (!parsed) break;

                    if (parsed.data) {
                        try {
                            if (parsed.isBinary) {
                                const decompressed = zlib.inflateSync(parsed.data).toString('utf8');
                                processClientMessage(socket, decompressed);
                            } else {
                                // 정상적인 텍스트 메시지
                                processClientMessage(socket, parsed.data);
                            }
                        } catch (e) {
                            console.error("WS Decompress error", e);
                        }
                    }
                    buffer = buffer.slice(parsed.byteLength);
                }
            });

            socket.on('error', () => clientDisconnected(socket));
            socket.on('close', () => clientDisconnected(socket));
        } else {
            socket.destroy();
        }
    });

    function clientConnected(socket) {
        socket.readyState = 'OPEN';
        clients.add(socket);
    }

    function clientDisconnected(socket) {
        socket.readyState = 'CLOSED';
        clients.delete(socket);
    }

    server.listen(port, () => {
        console.log(`\n🌐 웹 관리자 대시보드 열림: http://localhost:${port}`);
    });
}

function broadcastChat(chatObj) {
    // chatObj: 단일 채팅 객체 혹은 여러개
    broadcastMsg({ action: 'chat_push', payload: Array.isArray(chatObj) ? chatObj : [chatObj] });
}

module.exports = { startServer, broadcastChat, broadcastSpam, isBotMuted };
