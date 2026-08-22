/**
 * yt-chat-bot 명령어 및 실시간 방송 트래커 브릿지 모듈
 * 모듈화된 명령어 시스템(commands/index.js)과 방송 매처 엔진(tracker.js)을 연결하여
 * 기존 참조와의 100% 하위 호환성을 보장합니다.
 */

const {
    commandManager,
    handleCommand,
    reloadCommands,
    getCooldownState
} = require('./commands/index.js');

const {
    initCommand,
    getEpisodeInfo,
    isYtdlpRunning,
    setYtdlpRunning,
    onMatchResult,
    copyQuery
} = require('./tracker.js');

const configManager = require('./config-manager.js');

module.exports = {
    initCommand,
    handleCommand,
    getEpisodeInfo,
    getCooldownState,
    isYtdlpRunning,
    setYtdlpRunning,
    reloadCommands,
    commandManager,
    onMatchResult,
    copyQuery,
    reloadMessages: configManager.reloadMessages
};
