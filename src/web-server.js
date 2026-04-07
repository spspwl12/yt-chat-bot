const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const chatHistory = require('./chat-history.js');
const { banUser, blockUser } = require('./innertube.js');
const search_lib = require('./video-matcher/search.js');
const cfgYoutube = require('./data/config-youtube.js');

let spamGuardRef = null;
let getEpisodeInfoRef = null;
let clients = new Set();

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
    const payload = Buffer.from(text, 'utf8');
    const length = payload.length;
    let header;

    if (length <= 125) {
        header = Buffer.alloc(2);
        header[0] = 0x81;
        header[1] = length;
    } else if (length <= 65535) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
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

    if (opcode !== 0x1) {
        return { isControl: true, byteLength: offset + length }; // Non-text frame
    }

    return { data: data.toString('utf8'), byteLength: offset + length };
}

function broadcastSpam() {
    const spammers = [];
    if (spamGuardRef) {
        // 경고자 추가
        for (const [channelId, data] of spamGuardRef.tracker.entries()) {
            if (data.warns > 0 && !spamGuardRef.banned.has(channelId)) {
                spammers.push({
                    channelId,
                    count: data.warns,
                    name: '경고 누적 닉네임 불명',
                    block: false,
                    reason: '경고 누적'
                });
            }
        }
        // 밴된 유저 추가
        for (const [channelId, data] of spamGuardRef.banned.entries()) {
            spammers.push({
                channelId,
                count: spamGuardRef.warnLimit || 0,
                name: data.displayName || '이름 불명',
                block: true,
                reason: data.reason || '도배'
            });
        }
    }
    broadcastMsg({ action: 'spam_list', payload: spammers });
}

function processClientMessage(client, message) {
    try {
        const parsed = JSON.parse(message);
        handleAction(client, parsed);
    } catch(e) {
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

        if (epInfo && search_lib.videoInfo && search_lib.videoInfo[epInfo.index]) {
            totalTime = search_lib.videoInfo[epInfo.index]._streamDurationSec || 0;
        }

        sendWSFrame(client, JSON.stringify({ 
            action: 'state', 
            payload: { 
                episodeInfo: epInfo,
                totalEpisodes: totalEpisodes || totalEpCount,
                totalTime: totalTime,
                videoId: cfgYoutube.yt ? cfgYoutube.yt.video_id : null
            } 
        }));
    } 
    else if (action === 'getChat') {
        sendWSFrame(client, JSON.stringify({ action: 'chat_history', payload: chatHistory.getMessages() }));
    }
    else if (action === 'getSpam') {
        const spammers = [];
        if (spamGuardRef) {
            for (const [channelId, data] of spamGuardRef.tracker.entries()) {
                if (data.warns > 0 && !spamGuardRef.banned.has(channelId)) {
                    spammers.push({ channelId, count: data.warns, name: '경고 누적 닉네임 불명', block: false, reason: '경고 누적' });
                }
            }
            for (const [channelId, data] of spamGuardRef.banned.entries()) {
                spammers.push({ channelId, count: spamGuardRef.warnLimit || 0, name: data.displayName || '이름 불명', block: true, reason: data.reason || '도배' });
            }
        }
        sendWSFrame(client, JSON.stringify({ action: 'spam_list', payload: spammers }));
    }
    else if (action === 'ban') {
        const { channelId, displayName, contextMenuParams } = payload;
        
        console.log(`[WebAdmin🛠️] 유튜브 유저 차단 시도: ${displayName || channelId}`);
        if(contextMenuParams) {
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
        if(spamGuardRef) {
            spamGuardRef.manualBan(channelId, displayName, reason);
        }
        sendWSFrame(client, JSON.stringify({ action: 'spamAdd_result', payload: { success: true } }));
        broadcastSpam();
    }
    else if (action === 'spamDelete') {
        const { channelId } = payload;
        if(spamGuardRef) {
            spamGuardRef.removeBan(channelId);
        }
        sendWSFrame(client, JSON.stringify({ action: 'spamDelete_result', payload: { success: true } }));
        broadcastSpam();
    }
    else if (action === 'getConfig') {
        const cfgYoutubeText = fs.readFileSync(path.join(__dirname, 'data', 'config-youtube.js'), 'utf8');
        const cfgSearchText = fs.readFileSync(path.join(__dirname, 'data', 'config-search.js'), 'utf8');
        sendWSFrame(client, JSON.stringify({ action: 'config_data', payload: { youtube: cfgYoutubeText, search: cfgSearchText } }));
    }
    else if (action === 'saveConfig') {
        const { target, content } = payload;
        try {
            if(target === 'youtube') {
                fs.writeFileSync(path.join(__dirname, 'data', 'config-youtube.js'), content, 'utf8');
            } else if (target === 'search') {
                fs.writeFileSync(path.join(__dirname, 'data', 'config-search.js'), content, 'utf8');
            }
            sendWSFrame(client, JSON.stringify({ action: 'saveConfig_result', payload: { success: true } }));
        } catch(e) {
            sendWSFrame(client, JSON.stringify({ action: 'saveConfig_result', payload: { success: false, error: e.message } }));
        }
    }
}

function startServer(port, spamGuard, getEpisodeInfo) {
    spamGuardRef = spamGuard;
    getEpisodeInfoRef = getEpisodeInfo;

    const server = http.createServer((req, res) => {
        // 대시보드 정적 호스팅
        if (req.method === 'GET' && (req.url === '/' || req.url === '/dashboard.html')) {
            const htmlPath = path.join(__dirname, 'public', 'dashboard.html');
            fs.readFile(htmlPath, 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Dashboard HTML not found.');
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(data);
                }
            });
            return;
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
                while(true) {
                    const parsed = parseWSFrame(buffer);
                    if (!parsed) break;
                    
                    if (parsed.data) {
                        // 정상적인 텍스트 메시지
                        processClientMessage(socket, parsed.data);
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

module.exports = { startServer, broadcastChat, broadcastSpam };
