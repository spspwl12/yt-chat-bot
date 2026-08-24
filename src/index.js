const originalLog = console.log;

console.log = function (...args) {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    const timeStr = `[${hours}:${minutes}:${seconds}]`;
    originalLog(timeStr, ...args);
};

const { initSession, fetchChat, sendChat, getSendParams, hasPendingVerify } = require('./innertube.js');
const { initCommand, handleCommand, shutdown } = require('./commands.js');
const { SpamGuard } = require('./spam-guard.js');
const configManager = require('./config-manager.js');
const { cfg } = configManager;
const { startServer, broadcastChat, broadcastSpam } = require('./web-server.js');
const chatHistory = require('./chat-history.js');
const eventBus = require('./event-bus.js');

// ═══════════════════════════════════════
//  전역 예외 핸들러 (프로세스 다운 방지)
// ═══════════════════════════════════════
process.on('uncaughtException', function (err) {
    console.error('\n⚠️ [uncaughtException] 잡히지 않은 예외 — 프로세스 유지:', err && err.message ? err.message : String(err));
    if (err && err.stack) console.error(err.stack);
});

process.on('unhandledRejection', function (reason) {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('\n⚠️ [unhandledRejection] 처리되지 않은 Promise 거부 — 프로세스 유지:', msg);
    if (reason instanceof Error && reason.stack) console.error(reason.stack);
});

const spamGuard = new SpamGuard({
    windowSec: cfg.spam.spam_window_sec || 10,
    maxCount: cfg.spam.spam_max_count || 5,
    warnLimit: cfg.spam.spam_warn_limit || 3,
    penaltyDurationHrs: cfg.spam.penalty_duration_hrs !== undefined ? cfg.spam.penalty_duration_hrs : 12,
    penaltyAddSec: cfg.spam.penalty_add_sec || 0,
});

let running = true;
let retry = 0;

async function main() {
    console.log('\n═══════════════════════════════════════');
    console.log('   🤖 YouTube 실시간 채팅 봇 (InnerTube)');
    console.log('   📌 API 할당량 제한 없음');
    console.log('═══════════════════════════════════════\n');

    process.chdir(__dirname);

    console.log('🎬 비디오: ' + cfg.yt.video_id);
    const session = await initSession(cfg.yt.video_id);
    let continuation = session.continuation;

    const canSend = !!getSendParams();

    if (!canSend) {
        console.log('⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️ 메시지 전송 불가 ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️');
        return;
    }

    initCommand();
    let isFirstFetch = true;

    // 대시보드 웹 서버 백그라운드 시작 (getEpisodeInfo 전달)
    const { getEpisodeInfo } = require('./commands.js');
    startServer(12345, spamGuard, getEpisodeInfo);

    eventBus.on('simulate_chat', async (text) => {
        console.log(`[디버그 채팅] 입력: ${text}`);
        const msg = {
            channelId: 'debug_channel_id',
            displayName: 'WebAdmin',
            text: text,
            isChatOwner: false,
            isModerator: false,
            timestamp: Date.now()
        };
        eventBus.emit('chat', msg);
        const checkBan = spamGuard.confirm(msg.channelId);
        const chkInput = { warn: 0, ban: checkBan, channelId: msg.channelId, spamGuard };
        const resp = await handleCommand(1, msg.text, msg.displayName, chkInput);
        if (resp) {
            // 웹 디버깅 가상입력에서는 처음 출력을 실패하면 재시도 안함 (maxRetries = 1)
            const p = typeof resp === 'string' ? sendChat(resp, null, 1) : sendChat(resp.msg, resp.proc, 1);
            p.then(ok => {
                if (chkInput.logData) {
                    if (!ok && chkInput.logData.response) {
                        chkInput.logData.response = `[전송실패] ${chkInput.logData.response}`;
                    }
                    eventBus.emit('command_used', chkInput.logData);
                }
                if (ok && chkInput.onSuccess) chkInput.onSuccess();
            });
        } else if (chkInput.blockedCommand) {
            const banned = await spamGuard.enforce(msg.channelId, msg.displayName);
            if (banned) {
                broadcastSpam();
                spamGuard.checkAndSendUserCooldownWarning(msg.channelId, msg.displayName);
            }
            if (chkInput.logData) {
                chkInput.logData.response = '[명령어 차단됨]';
                eventBus.emit('command_used', chkInput.logData);
            }
        } else if (chkInput.logData) {
            if (!chkInput.logData.response) {
                chkInput.logData.response = '[응답 없음 / 쿨타임 또는 무시]';
            }
            eventBus.emit('command_used', chkInput.logData);
        }
    });

    while (running) {
        try {
            const result = await fetchChat(continuation);

            if (result.continuation) {
                continuation = result.continuation;
            } else if (retry < 5) {
                console.error('❌ continuation 없음.');
                retry++;
                await sleep(4000);
                continue;
            } else if (retry > 5) {
                process.exit(1);
            }

            retry = 0;

            if (isFirstFetch) {
                isFirstFetch = false;
                console.log('📨 기존 메시지 스킵 — 대기 중...\n');
                await sleep(result.timeoutMs || 2000);
                continue;
            }

            const messages = result.messages || [];

            // 실시간 채팅을 대시보드 버퍼로 전송
            chatHistory.addMessages(messages);
            if (messages.length > 0) broadcastChat(messages);

            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                if (!msg.text || !msg.channelId)
                    continue;

                // 독립 모듈들에 실시간 채팅 이벤트 전달
                eventBus.emit('chat', msg);

                if (msg.isChatOwner || msg.isModerator)
                    continue;
                const checkBan = spamGuard.confirm(msg.channelId);
                if (checkBan >= 2)
                    continue;
                const chkInput = { warn: 0, ban: checkBan, channelId: msg.channelId, spamGuard };
                const resp = await handleCommand(1, msg.text, msg.displayName, chkInput);
                if (resp || chkInput.blockedCommand) {
                    const banned = await spamGuard.enforce(msg.channelId, msg.displayName);
                    if (banned) {
                        broadcastSpam();
                        if (chkInput.blockedCommand) {
                            spamGuard.checkAndSendUserCooldownWarning(msg.channelId, msg.displayName);
                        }
                        continue;
                    }
                    
                    if (!resp) continue; // blockedCommand 였지만 혹시 모를 통과 상황 방어

                    if (chkInput.triggerCooldown) {
                        chkInput.triggerCooldown();
                    }
                    const p = typeof resp === 'string' ? sendChat(resp) : sendChat(resp.msg, resp.proc);
                    p.then(ok => {
                        if (chkInput.logData) {
                            if (!ok && chkInput.logData.response) {
                                chkInput.logData.response = `[전송실패] ${chkInput.logData.response}`;
                            }
                            eventBus.emit('command_used', chkInput.logData);
                        }
                        if (ok && chkInput.onSuccess) {
                            chkInput.onSuccess();
                        }
                    });
                } else if (chkInput.logData) {
                    if (!chkInput.logData.response) {
                        chkInput.logData.response = '[응답 없음 / 쿨타임 또는 무시]';
                    }
                    eventBus.emit('command_used', chkInput.logData);
                }
                if (chkInput.warn > 0) {
                    spamGuard.addPenalty(msg.channelId, msg.displayName, chkInput.warn);
                    broadcastSpam();
                }
            }

            // 대기 시간: 유튜브가 권장하는 timeoutMs 기반, 검증 큐가 대기 중이면 1초 내로 빠르게 폴링
            let delayMs = (result && result.timeoutMs) || 2000;
            if (hasPendingVerify && hasPendingVerify()) {
                delayMs = Math.min(delayMs, 1000);
            }
            delayMs = Math.max(800, Math.min(delayMs, 3000));
            await sleep(delayMs);
        } catch (err) {
            if (!running)
                break;
            console.error('\n❌ 오류: ' + err.message);
            await sleep(5000);
        }
    }
    originalLog('\n👋 봇 종료.');
}

function sleep(ms) {
    return new Promise(function (r) {
        setTimeout(r, ms);
    });
}

process.on('SIGINT', function () {
    originalLog('\n⏹️  종료...');
    running = false;
    try { shutdown(); } catch {}
    process.exit();
});

process.on('SIGTERM', function () {
    running = false;
    try { shutdown(); } catch {}
});

main().catch(function (err) {
    console.error('💥 치명적 오류: ' + err.message);
    process.exit(1);
});
