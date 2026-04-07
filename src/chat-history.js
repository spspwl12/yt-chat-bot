/**
 * 최근 유튜브 실시간 채팅 내역을 메모리에 저장하여
 * 웹 대시보드에서 불러가고, 밴/차단 기능을 수행할 수 있도록 돕는 캐시 모듈.
 */

const MAX_HISTORY = 100;
const messages = [];

function addMessages(newMessages) {
    if (!newMessages || newMessages.length === 0) return;

    for (const msg of newMessages) {
        // 내부 처리용 타임스탬프 추가
        msg.timestamp = Date.now();
        messages.push(msg);
    }

    // 오래된 메시지는 버림
    while (messages.length > MAX_HISTORY) {
        messages.shift();
    }
}

function getMessages() {
    return messages;
}

module.exports = {
    addMessages,
    getMessages
};
