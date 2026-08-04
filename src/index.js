const originalLog = console.log;

console.log = function (...args) {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    const timeStr = `[${hours}:${minutes}:${seconds}]`;
    originalLog(timeStr, ...args);
};

const { initSession, fetchChat, sendChat, getSendParams } = require('./innertube.js');
const { initCommand, handleCommand } = require('./commands.js');
const { SpamGuard } = require('./spam-guard.js');
const cfg = require('../data/config-youtube.js');
const { startServer, broadcastChat, broadcastSpam } = require('./web-server.js');
const chatHistory = require('./chat-history.js');
const { startSchedulePoster } = require('./schedule_poster.js');

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
    if (cfg.schedule_poster && cfg.schedule_poster.enable_poster) {
        startSchedulePoster();
    }
    let isFirstFetch = true;

    // 대시보드 웹 서버 백그라운드 시작 (getEpisodeInfo 전달)
    const { getEpisodeInfo } = require('./commands.js');
    const { startServer, broadcastSpam, isBotMuted } = require('./web-server.js');
    startServer(12345, spamGuard, getEpisodeInfo);

    const eventBus = require('./event-bus.js');
    eventBus.on('simulate_chat', async (text) => {
        console.log(`[디버그 채팅] 입력: ${text}`);
        const msg = {
            channelId: 'debug_channel_id',
            displayName: 'WebAdmin',
            text: text,
            isChatOwner: false,
            isModerator: false
        };
        const checkBan = spamGuard.confirm(msg.channelId);
        const chkInput = { warn: 0, ban: checkBan, channelId: msg.channelId, spamGuard };
        const resp = await handleCommand(1, msg.text, msg.displayName, chkInput);
        if (resp) {
            // 웹 디버깅 가상입력에서는 처음 출력을 실패하면 재시도 안함 (maxRetries = 1)
            const p = typeof resp === 'string' ? sendChat(resp, null, 1) : sendChat(resp.msg, resp.proc, 1);
            p.then(ok => {
                if (chkInput.logData) {
                    if (!ok) chkInput.logData.response = null;
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
        } else if (chkInput.logData) {
            chkInput.logData.response = null;
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
                await sleep(4000);
                continue;
            }

            const messages = result.messages || [];

            // 실시간 채팅을 대시보드 버퍼로 전송
            chatHistory.addMessages(messages);
            if (messages.length > 0) broadcastChat(messages);

            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                if (msg.isChatOwner || msg.isModerator || !msg.text || !msg.channelId)
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
                            if (!ok) chkInput.logData.response = null;
                            eventBus.emit('command_used', chkInput.logData);
                        }
                        if (ok && chkInput.onSuccess) {
                            chkInput.onSuccess();
                        }
                    });
                } else if (chkInput.logData) {
                    chkInput.logData.response = null;
                    eventBus.emit('command_used', chkInput.logData);
                }
                if (chkInput.warn > 0) {
                    spamGuard.addPenalty(msg.channelId, msg.displayName, chkInput.warn);
                    broadcastSpam();
                }
            }

            await sleep(4000);
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
    process.exit();
});

process.on('SIGTERM', function () {
    running = false;
});

main().catch(function (err) {
    console.error('💥 치명적 오류: ' + err.message);
    process.exit(1);
});
