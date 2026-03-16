/**
 * YouTube InnerTube API 클라이언트 (HTTP/2 + Cookie Jar)
 *
 * ★ HTTP/2: 크롬과 동일한 프로토콜
 * ★ Cookie Jar: Set-Cookie 자동 반영 → PSIDTS 등 자동 갱신
 * ★ sendParams: protobuf 직접 생성 → 만료 없음
 */
const http2 = require('node:http2');
const crypto = require('crypto');
const fs = require('fs');
const path2 = require('./path.js');
const cookies = require('./data/session.json');
const cfg = require('./data/config-youtube.js');

const ORIGIN = 'https://www.youtube.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

var innertubeApiKey = null;
var clientVersion = null;
var visitorData = null;
var sendParams = null;
var currentVideoId = null;
var ownerChannelId = null;
var sendQueue = [];
var queueRunning = false;

// ═══════════════════════════════════════
//  Protobuf (sendParams 직접 생성)
// ═══════════════════════════════════════

function encodeVarint(n) {
    var bytes = [];
    n = BigInt(n);
    while (n > 0x7fn) {
        bytes.push(Number(n & 0x7fn) | 0x80);
        n >>= 7n;
    }
    bytes.push(Number(n));
    return Buffer.from(bytes);
}

function pbH(fid, wt) {
    return encodeVarint(BigInt(fid) << 3n | BigInt(wt));
}

function ld(fid, p) {
    var buf = typeof p === 'string' ? Buffer.from(p, 'utf-8') : Array.isArray(p) ? Buffer.concat(p) : p;
    return Buffer.concat([pbH(fid, 2), encodeVarint(buf.length), buf]);
}

function vt(fid, v) {
    return Buffer.concat([pbH(fid, 0), encodeVarint(v)]);
}

function buildSendParams(channelId, videoId) {
    var pb = Buffer.concat([ld(1, ld(5, [ld(1, channelId), ld(2, videoId)])), vt(2, 2), vt(3, 4)]);
    return Buffer.from(encodeURIComponent(pb.toString('base64')), 'utf-8').toString('base64');
}

// ═══════════════════════════════════════
//  Cookie Jar
// ═══════════════════════════════════════

var cookieJar = {};

function initCookieJar(cookieStr) {
    var pairs = cookieStr.split(';');
    for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].trim();
        var eq = pair.indexOf('=');
        if (eq < 1) continue;
        cookieJar[pair.substring(0, eq).trim()] = pair.substring(eq + 1).trim();
    }
    console.log('🍪 쿠키 로드 (' + Object.keys(cookieJar).length + '개)');
}

function updateCookiesFromHeaders(headers) {
    var sc = headers['set-cookie'];
    if (!sc) return;
    var arr = Array.isArray(sc) ? sc : [sc];
    var changed = false;

    for (var i = 0; i < arr.length; i++) {
        var parts = arr[i].split(';');
        var main = parts[0].trim();
        var eq = main.indexOf('=');
        if (eq < 1) continue;
        var name = main.substring(0, eq).trim();
        var value = main.substring(eq + 1).trim();

        var deleted = false;
        for (var j = 1; j < parts.length; j++) {
            if (parts[j].trim().toLowerCase() === 'max-age=0') {
                if (cookieJar[name]) { delete cookieJar[name]; changed = true; }
                deleted = true; break;
            }
        }
        if (!deleted && value !== '' && cookieJar[name] !== value) {
            cookieJar[name] = value;
            changed = true;
        }
    }

    if (changed) saveCookiesToConfig();
}

function saveCookiesToConfig() {
    try {
        const p = path2.findPath('./data/session.json');
        cookies.cookie = getCookieString();
        fs.writeFileSync(p, JSON.stringify(cookies, null, 4), 'utf-8');
    } catch (e) { /* 실패해도 메모리 쿠키 유지 */ }
}

function getCookieString() {
    var parts = [];
    var keys = Object.keys(cookieJar);
    for (var i = 0; i < keys.length; i++) parts.push(keys[i] + '=' + cookieJar[keys[i]]);
    return parts.join('; ');
}

// ═══════════════════════════════════════
//  인증
// ═══════════════════════════════════════

function extractSapisid() {
    return cookieJar['SAPISID'] || cookieJar['__Secure-3PAPISID'] || null;
}

function makeAuth() {
    var sapisid = extractSapisid();
    if (!sapisid) return '';
    var now = Math.floor(Date.now() / 1000);
    return 'SAPISIDHASH ' + now + '_' + crypto.createHash('sha1').update(now + ' ' + sapisid + ' ' + ORIGIN).digest('hex');
}

// ═══════════════════════════════════════
//  HTTP/2 클라이언트
// ═══════════════════════════════════════

function h2Post(urlPath, extraHeaders, bodyObj) {
    return new Promise(function (resolve, reject) {
        var payload = JSON.stringify(bodyObj);
        var client = http2.connect(ORIGIN);
        client.on('error', function (e) { client.close(); reject(e); });

        var headers = {
            ':method': 'POST',
            ':path': urlPath,
            ':authority': 'www.youtube.com',
            ':scheme': 'https',
            'content-type': 'application/json',
            'user-agent': UA,
            'accept': '*/*',
            'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            'origin': ORIGIN,
            'referer': ORIGIN + '/live_chat?v=' + (currentVideoId || ''),
            'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'same-origin',
            'sec-fetch-site': 'same-origin',
            'x-youtube-bootstrap-logged-in': 'true',
            'x-youtube-client-name': '1',
            'x-youtube-client-version': clientVersion || '2.20260213.01.00',
        };
        var keys = Object.keys(extraHeaders || {});
        for (var i = 0; i < keys.length; i++) headers[keys[i]] = extraHeaders[keys[i]];

        var req = client.request(headers);
        req.write(payload);
        req.end();

        var body = '';
        var respHeaders = {};
        req.on('response', function (h) { respHeaders = h; });
        req.on('data', function (c) { body += c; });
        req.on('end', function () {
            // ★ Set-Cookie 반영
            updateCookiesFromHeaders(respHeaders);
            client.close();
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error('응답 파싱 실패: ' + body.slice(0, 300))); }
        });
        req.on('error', function (e) { client.close(); reject(e); });
    });
}

function h2Get(urlPath, extraHeaders) {
    return new Promise(function (resolve, reject) {
        var client = http2.connect(ORIGIN);
        client.on('error', function (e) { client.close(); reject(e); });

        var headers = {
            ':method': 'GET',
            ':path': urlPath,
            ':authority': 'www.youtube.com',
            ':scheme': 'https',
            'user-agent': UA,
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'ko-KR,ko;q=0.9',
        };
        var keys = Object.keys(extraHeaders || {});
        for (var i = 0; i < keys.length; i++) headers[keys[i]] = extraHeaders[keys[i]];

        var req = client.request(headers);
        req.end();

        var body = '';
        var respHeaders = {};
        req.on('response', function (h) { respHeaders = h; });
        req.on('data', function (c) { body += c; });
        req.on('end', function () {
            updateCookiesFromHeaders(respHeaders);
            client.close();
            resolve(body);
        });
        req.on('error', function (e) { client.close(); reject(e); });
    });
}

/**
 * 완전 비인증 HTTP/2 POST (fetchChat 전용)
 * 인증 관련 헤더 없음, 쿠키 캡처 안 함
 */
function h2PostAnon(urlPath, bodyObj) {
    var payload = JSON.stringify(bodyObj);
    return new Promise(function (resolve, reject) {
        var client = http2.connect(ORIGIN);
        client.on('error', function (e) {
            client.close();
            reject(e);
        });

        var req = client.request({
            ':method': 'POST',
            ':path': urlPath,
            ':authority': 'www.youtube.com',
            ':scheme': 'https',
            'content-type': 'application/json',
            'user-agent': UA,
            'accept': '*/*',
            'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        });
        req.write(payload);
        req.end();

        var body = '';
        req.on('data', function (c) {
            body += c;
        });
        req.on('end', function () {
            client.close();
            try {
                resolve(JSON.parse(body));
            }
            catch (e) {
                reject(new Error('응답 파싱 실패: ' + body.slice(0, 300)));
            }
        });
        req.on('error', function (e) {
            client.close();
            reject(e);
        });
    });
}

function authHeaders() {
    return {
        'cookie': getCookieString(),
        'authorization': makeAuth(),
        'x-goog-authuser': '0',
        'x-origin': ORIGIN,
    };
}

function makeContext() {
    var ctx = { client: { clientName: 'WEB', clientVersion: clientVersion || '2.20260213.01.00' } };
    if (visitorData) ctx.client.visitorData = visitorData;
    return ctx;
}

// ═══════════════════════════════════════
//  Public API
// ═══════════════════════════════════════

async function initSession(videoId, chatMode) {
    // chatMode: 'top' = 주요 채팅 (기본), 'live' = 실시간 채팅
    chatMode = chatMode || 'top';
    var chatModeIndex = chatMode === 'live' ? 1 : 0;
    var chatModeLabel = chatMode === 'live' ? '실시간 채팅' : '주요 채팅';

    currentVideoId = videoId;
    initCookieJar(cookies.cookie);

    // 1. player API로 방송 주인 채널 ID
    console.log('📡 채널 정보 가져오는 중...');
    var apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

    var playerData = await h2Post('/youtubei/v1/player?key=' + apiKey + '&prettyPrint=false', {}, {
        context: { client: { clientName: 'WEB', clientVersion: '2.20260213.01.00' } },
        videoId: videoId
    });

    if (playerData.videoDetails) {
        ownerChannelId = playerData.videoDetails.channelId;
        console.log('✅ 채널: ' + (playerData.videoDetails.author || ownerChannelId));
    } else {
        throw new Error('비디오 정보를 가져올 수 없습니다. video_id를 확인하세요.');
    }

    // 2. live_chat 페이지 (비인증) — continuation 가져오기
    var publicHtml = await h2Get('/live_chat?v=' + videoId, {});

    var publicCont = null;

    var initDataMatch = publicHtml.match(/var\s+ytInitialData\s*=\s*({.+?});\s*<\/script>/s)
        || publicHtml.match(/window\["ytInitialData"\]\s*=\s*({.+?});\s*<\/script>/s);

    if (initDataMatch) {
        try {
            var initData = JSON.parse(initDataMatch[1]);
            var header = initData.contents
                && initData.contents.liveChatRenderer
                && initData.contents.liveChatRenderer.header
                && initData.contents.liveChatRenderer.header.liveChatHeaderRenderer;
            var subItems = header
                && header.viewSelector
                && header.viewSelector.sortFilterSubMenuRenderer
                && header.viewSelector.sortFilterSubMenuRenderer.subMenuItems;
            if (subItems && subItems.length > chatModeIndex) {
                publicCont = subItems[chatModeIndex].continuation
                    && subItems[chatModeIndex].continuation.reloadContinuationData
                    && subItems[chatModeIndex].continuation.reloadContinuationData.continuation;
                if (publicCont) {
                    console.log('✅ ' + chatModeLabel + ' continuation 획득');
                }
            }
        } catch (e) {
            console.warn('⚠️  ytInitialData 파싱 실패, regex 폴백 사용');
        }
    }

    // 폴백: 첫 번째 continuation (구조 분석 실패 시)
    if (!publicCont) {
        var contMatch = publicHtml.match(/"continuation"\s*:\s*"([^"]+)"/);
        if (contMatch) {
            publicCont = contMatch[1];
            console.log('✅ 공개 continuation 획득 (regex 폴백)');
        } else {
            throw new Error('continuation 토큰 없음 — 라이브 방송 중인지 확인');
        }
    }

    // 3. live_chat 페이지 (인증) — API 설정 + 쿠키 갱신
    var chatHtml = await h2Get('/live_chat?v=' + videoId, { 'cookie': getCookieString() });

    if (chatHtml.length < 1000) {
        throw new Error('라이브 채팅 페이지를 불러올 수 없습니다.');
    }

    var keyMatch = chatHtml.match(/"innertubeApiKey"\s*:\s*"([^"]+)"/);
    if (keyMatch) innertubeApiKey = keyMatch[1];
    else innertubeApiKey = apiKey;

    var verMatch = chatHtml.match(/"clientVersion"\s*:\s*"([^"]+)"/);
    if (verMatch) clientVersion = verMatch[1];

    var visMatch = chatHtml.match(/"visitorData"\s*:\s*"([^"]+)"/);
    if (visMatch) visitorData = visMatch[1];

    // 4. sendParams (protobuf — 만료 없음)
    sendParams = buildSendParams(ownerChannelId, videoId);
    console.log('✅ sendParams 생성 완료 (protobuf)');

    console.log('✅ 세션 초기화 완료 (HTTP/2)');
    return { continuation: publicCont };
}

async function fetchChat(continuation) {
    var url = '/youtubei/v1/live_chat/get_live_chat?key=' + innertubeApiKey + '&prettyPrint=false';

    // ★ 완전 비인증 조회 — 별도 HTTP/2 세션, 인증 헤더 없음
    var data = await h2PostAnon(url, {
        context: { client: { clientName: 'WEB', clientVersion: clientVersion || '2.20260213.01.00' } },
        continuation: continuation,
    });

    var liveChatCont = data.continuationContents && data.continuationContents.liveChatContinuation;
    if (!liveChatCont) return { messages: [], continuation: null };

    // 다음 continuation
    var nextCont = null;
    var conts = liveChatCont.continuations;
    if (conts) {
        for (var i = 0; i < conts.length; i++) {
            var c = conts[i];
            nextCont = (c.timedContinuationData && c.timedContinuationData.continuation)
                || (c.invalidationContinuationData && c.invalidationContinuationData.continuation)
                || null;
            if (nextCont) break;
        }
    }

    // 메시지 파싱
    var actions = liveChatCont.actions || [];

    // ★ 확인 큐 체크 (sendChat에서 보낸 메시지 ID 검증)
    _checkVerifyQueue(actions);

    var messages = [];

    for (var i = 0; i < actions.length; i++) {
        var item = actions[i].addChatItemAction && actions[i].addChatItemAction.item;
        if (!item) continue;

        var renderer = item.liveChatTextMessageRenderer;
        if (!renderer) continue;

        var runs = (renderer.message && renderer.message.runs) || [];
        var text = '';
        for (var j = 0; j < runs.length; j++) {
            text += runs[j].text || (runs[j].emoji && runs[j].emoji.emojiId) || '';
        }

        var badges = renderer.authorBadges || [];
        var isChatOwner = false, isModerator = false;
        for (var j = 0; j < badges.length; j++) {
            var iconType = badges[j].liveChatAuthorBadgeRenderer
                && badges[j].liveChatAuthorBadgeRenderer.icon
                && badges[j].liveChatAuthorBadgeRenderer.icon.iconType;
            if (iconType === 'OWNER') isChatOwner = true;
            if (iconType === 'MODERATOR') isModerator = true;
        }

        messages.push({
            text: text,
            displayName: (renderer.authorName && renderer.authorName.simpleText) || '',
            channelId: renderer.authorExternalChannelId || '',
            isChatOwner: isChatOwner,
            isModerator: isModerator,
            contextMenu: (renderer.contextMenuEndpoint
                && renderer.contextMenuEndpoint.liveChatItemContextMenuEndpoint
                && renderer.contextMenuEndpoint.liveChatItemContextMenuEndpoint.params) || null,
        });
    }

    return { messages: messages, continuation: nextCont };
}

function getSendParams() { return sendParams; }

// ═══════════════════════════════════════
//  메시지 전송 큐 + 재시도
// ═══════════════════════════════════════

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * 확인 큐: fetchChat이 매 폴링마다 여기서 ID를 찾아 resolve 해준다
 * { id: string, resolve: function, timer: timeout }
 */
var verifyQueue = [];

/**
 * fetchChat 결과에서 확인 큐의 메시지 ID를 체크 (fetchChat 내부에서 호출)
 */
function _checkVerifyQueue(actions) {
    if (verifyQueue.length === 0) return;

    actions = actions || [];

    for (var j = verifyQueue.length - 1; j >= 0; j--) {
        const obj = actions.find(e => {
            const str = JSON.stringify(e);
            return str.includes(verifyQueue[j].id) &&
                (str.includes('"message"') || str.includes("'message'"));
        });

        if (obj) {
            clearTimeout(verifyQueue[j].timer);
            verifyQueue[j].resolve(true);
            verifyQueue.splice(j, 1);
        }
    }
}

/**
 * 확인 큐에 메시지 ID 등록. fetchChat이 해당 ID를 발견하면 resolve(true).
 * 타임아웃 시 resolve(false).
 */
function _waitForVerify(messageId) {
    return new Promise(function (resolve) {
        var entry = {
            id: messageId,
            resolve: resolve,
            timer: setTimeout(function () {
                // 타임아웃 → 큐에서 제거하고 false 반환
                for (var i = 0; i < verifyQueue.length; i++) {
                    if (verifyQueue[i] === entry) {
                        verifyQueue.splice(i, 1);
                        break;
                    }
                }
                resolve(false);
            }, cfg.yt.verify_timeout),
        };
        verifyQueue.push(entry);
    });
}

/**
 * 큐에 메시지 추가. 순서대로 딜레이를 두고 전송.
 *
 * @param {string} message - 전송할 메시지
 * @param {function} [retryProc] - 재시도 시 대체 메시지 생성 함수.
 *   retryProc(attempt) → string|null. attempt는 1부터 시작.
 *   null 반환 시 재시도 중단. 생략 시 동일 메시지로 재시도.
 */
function sendChat(message, retryProc) {
    return new Promise(function (resolve) {
        sendQueue.push({
            message: message,
            retryProc: retryProc || null,
            resolve: resolve
        });
        if (!queueRunning)
            _processQueue();
    });
}

async function _processQueue() {
    queueRunning = true;
    while (sendQueue.length > 0) {
        var item = sendQueue.shift();
        var ok = await _sendWithRetry(item.message, item.retryProc, cfg.yt.max_retries);
        item.resolve(ok);
        if (sendQueue.length > 0)
            await sleep(cfg.yt.send_delay);
    }
    queueRunning = false;
}

/**
 * 메시지 전송 + fetchChat 확인 큐로 검증 + 재시도
 */
async function _sendWithRetry(message, retryProc, retries) {
    for (var attempt = 0; attempt < retries; attempt++) {
        var text = attempt === 0 ? message : (retryProc ? retryProc(attempt) : message);
        if (text == null) {
            console.warn('⚠️  프로시저가 null 반환 — 전송 중단');
            return false;
        }

        var result = await _trySend(text);

        if (result === 'error') {
            console.error('❌ 전송 실패 (시도 ' + (attempt + 1) + '/' + retries + ')');
            if (attempt < retries - 1) {
                await sleep(2000 * (attempt + 1));
                continue;
            }
            return false;
        }

        if (result.id) {
            var verified = await _waitForVerify(result.id);
            if (verified) {
                console.log('💬 [봇] ' + text);
                return true;
            }

            if (!retryProc)
                return false;

            // 미확인 → 쉐도우 필터링된 메시지 삭제
            console.warn('⚠️  메시지 미확인 (시도 ' + (attempt + 1) + '/' + retries + ') — 삭제 시도');
            if (result.deleteParams)
                await _deleteMessage(result.deleteParams);
            if (attempt < retries - 1)
                await sleep(2000 * (attempt + 1));
            continue;
        }

        // ID를 못 뽑았지만 에러도 아님 → 성공 간주
        console.log('💬 [봇] ' + text);
        return true;
    }
    console.error('❌ 메시지 전송 최종 실패');
    return false;
}

/**
 * 실제 send_message 호출.
 * 성공 시 { id, deleteParams } 반환, 에러 시 'error'
 */
async function _trySend(message) {
    if (!sendParams) { console.error('❌ sendParams 없음'); return 'error'; }

    var url = '/youtubei/v1/live_chat/send_message?key=' + innertubeApiKey + '&prettyPrint=false';

    try {
        var result = await h2Post(url, authHeaders(), {
            context: makeContext(),
            params: sendParams,
            richMessage: { textSegments: [{ text: message }] },
        });

        if (result.error) {
            console.error('❌ YouTube 에러: ' + (result.error.message || JSON.stringify(result.error)));
            return 'error';
        }

        if (result.actions) {
            for (var i = 0; i < result.actions.length; i++) {
                var act = result.actions[i];
                var addItem = act.addChatItemAction && act.addChatItemAction.item;
                if (addItem && addItem.liveChatTextMessageRenderer) {
                    var r = addItem.liveChatTextMessageRenderer;
                    var msgId = r.id || null;
                    // 삭제용 params 추출
                    var delParams = null;
                    var ctxMenu = r.contextMenuEndpoint
                        && r.contextMenuEndpoint.liveChatItemContextMenuEndpoint
                        && r.contextMenuEndpoint.liveChatItemContextMenuEndpoint.params;
                    if (ctxMenu) delParams = ctxMenu;
                    if (msgId) return { id: msgId, deleteParams: delParams };
                }
            }
        }
        return { id: null, deleteParams: null };
    } catch (err) {
        console.error('❌ 전송 예외: ' + err.message);
        return 'error';
    }
}

/**
 * 메시지 삭제 (컨텍스트 메뉴에서 삭제 액션 찾아서 실행)
 */
async function _deleteMessage(contextMenuParams) {
    try {
        var menuData = await h2Post(
            '/youtubei/v1/live_chat/get_item_context_menu?key=' + innertubeApiKey + '&prettyPrint=false',
            authHeaders(),
            { context: makeContext(), params: contextMenuParams }
        );

        var menuRenderer = menuData.liveChatItemContextMenuSupportedRenderers
            && menuData.liveChatItemContextMenuSupportedRenderers.menuRenderer;
        var items = (menuRenderer && menuRenderer.items) || [];

        var deleteParams = null;
        for (var i = 0; i < items.length; i++) {
            var ep = items[i].menuServiceItemRenderer
                && items[i].menuServiceItemRenderer.serviceEndpoint;
            if (ep && ep.moderateLiveChatEndpoint) {
                // 첫 번째 moderate 액션이 보통 삭제
                deleteParams = ep.moderateLiveChatEndpoint.params;
                break;
            }
        }

        if (!deleteParams) {
            console.warn('⚠️  삭제 메뉴 없음');
            return false;
        }

        await h2Post(
            '/youtubei/v1/live_chat/moderate?key=' + innertubeApiKey + '&prettyPrint=false',
            authHeaders(),
            { context: makeContext(), params: deleteParams }
        );
        console.log('🗑️  필터링된 메시지 삭제 완료');
        return true;
    } catch (e) {
        console.warn('⚠️  삭제 실패: ' + e.message);
        return false;
    }
}

async function banUser(contextMenuParams) {
    if (!contextMenuParams) return false;

    try {
        var menuData = await h2Post(
            '/youtubei/v1/live_chat/get_item_context_menu?key=' + innertubeApiKey + '&prettyPrint=false',
            authHeaders(),
            { context: makeContext(), params: contextMenuParams }
        );

        var menuRenderer = menuData.liveChatItemContextMenuSupportedRenderers
            && menuData.liveChatItemContextMenuSupportedRenderers.menuRenderer;
        var menuItems = (menuRenderer && menuRenderer.items) || [];

        var banParams = null;
        for (var i = 0; i < menuItems.length; i++) {
            var ep = menuItems[i].menuServiceItemRenderer
                && menuItems[i].menuServiceItemRenderer.serviceEndpoint;
            if (ep && ep.moderateLiveChatEndpoint) {
                banParams = ep.moderateLiveChatEndpoint.params;
                break;
            }
        }

        if (!banParams) {
            console.error('❌ 차단 메뉴 없음');
            return false;
        }

        await h2Post(
            '/youtubei/v1/live_chat/moderate?key=' + innertubeApiKey + '&prettyPrint=false',
            authHeaders(),
            { context: makeContext(), params: banParams }
        );

        console.log('🔨 차단 완료');
        return true;
    } catch (err) {
        console.error('❌ 차단 실패: ' + err.message);
        return false;
    }
}

module.exports = { initSession, fetchChat, getSendParams, sendChat, banUser };
