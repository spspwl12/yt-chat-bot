const configManager = require('../config-manager.js');
const { cfg, msg, schCfg, musics, videoMetadata, videoMetaMap } = configManager;
const videoSubManager = require('../sub-manager.js');
const search_lib = require('../video-matcher/search.js');
const { searchEpisodeByAI } = require('../ai.js');
const TextSearchEngine = require('../textsearcher.js');
const statsTracker = require('../stats-db.js');
const eventBus = require('../event-bus.js');
const { sendChat } = require('../innertube.js');
const {
    insertSpaces, filterText, toUnicodeNumber, toUnicodeNumber2,
    toHHMMSS, fromHHMMSS, formatDate, roundUpTime, getClockEmoji, parseKoreanDate, hasProfanity, maskProfanity
} = require('../func.js');

const videoInfo = search_lib.videoInfo;
const retryPattern = ["$1", "$1 ", " $1", "", ""];

// ─── 쿨타임 상태 관리 ─────────────────────────────────────────
let delayChatTime = 0;                 // global 모드용
const delayChatTimeMap = new Map();    // per-command 모드용
let commandGroupResolver = (cmd) => cmd;
let commandGroupsMap = {};

function setCommandGroupResolver(resolver, groups = {}) {
    commandGroupResolver = resolver;
    commandGroupsMap = groups;
}

function getCommandGroup(cmd) {
    return commandGroupResolver(cmd);
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

function returnWarning(warningMsg, cmd, _input) {
    if (_input) {
        setCooldown(cmd, -(1000 * 60 * (cfg.cooldown.error_offset_min || 0)), _input);
    }
    return `${warningMsg} ${getCooldownMsg(cmd)}`;
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

function resetCooldown() {
    delayChatTime = 0;
    delayChatTimeMap.clear();
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
        const allGroups = new Set([
            ...Object.keys(commandGroupsMap),
            ...(cfg.cooldown.group_times ? Object.keys(cfg.cooldown.group_times).flatMap(k => k.split(',').map(s => s.trim())) : [])
        ]);

        for (const group of allGroups) {
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

module.exports = {
    cfg,
    msg,
    schCfg,
    musics,
    videoMetadata,
    videoMetaMap,
    videoSubManager,
    search_lib,
    searchEpisodeByAI,
    TextSearchEngine,
    statsTracker,
    eventBus,
    sendChat,
    videoInfo,
    retryPattern,
    insertSpaces,
    filterText,
    toUnicodeNumber,
    toUnicodeNumber2,
    toHHMMSS,
    fromHHMMSS,
    formatDate,
    roundUpTime,
    getClockEmoji,
    parseKoreanDate,
    hasProfanity,
    maskProfanity,
    setCommandGroupResolver,
    getCommandGroup,
    getCooldownConfig,
    getCooldownMsg,
    returnWarning,
    getWarnsValue,
    isCooldown,
    setCooldown,
    resetCooldown,
    getCooldownState
};
