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
const cfg = require('./data/config-youtube.js');

const spamGuard = new SpamGuard({
    windowSec: cfg.spam.spam_window_sec || 10,
    maxCount: cfg.spam.spam_max_count || 5,
    warnLimit: cfg.spam.spam_warn_limit || 3,
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

            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                if (msg.isChatOwner || msg.isModerator || !msg.text || !msg.channelId)
                    continue;
                const checkBan = spamGuard.confirm(msg.channelId);
                if (checkBan >= 2)
                    continue;
                const chkInput = { warn: 0, ban: checkBan };
                const resp = await handleCommand(1, msg.text, msg.displayName, chkInput);
                if (resp) {
                    const banned = await spamGuard.enforce(msg.channelId, msg.displayName);
                    if (banned) {
                        handleCommand(0);
                        continue;
                    }
                    typeof resp === 'string' ? sendChat(resp) : sendChat(resp.msg, resp.proc);
                    console.log('💬 [' + msg.displayName + '] ' + msg.text);
                }
                if (chkInput.warn > 0)
                    spamGuard.addPenalty(msg.channelId, msg.displayName, chkInput.warn);
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
