/**
 * yt-chat-bot 통합 모듈 및 실시간 방송 트래커 브릿지
 * 통합 모듈 시스템(module-manager.js -> modules/*)과 방송 매처 엔진(tracker.js)을 연결하여
 * 기존 참조와의 100% 하위 호환성을 보장합니다.
 */

const {
    commandManager,
    moduleManager,
    handleCommand,
    reloadCommands,
    reloadModules,
    shutdown,
    getCooldownState,
    getWebModules,
    getModuleList,
    getDependencyGraph,
    resolveDependencies,
    handleWebAction
} = require('./module-manager.js');

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
    reloadModules,
    shutdown,
    commandManager,
    moduleManager,
    getWebModules,
    getModuleList,
    getDependencyGraph,
    resolveDependencies,
    handleWebAction,
    onMatchResult,
    copyQuery,
    reloadMessages: configManager.reloadMessages
};
