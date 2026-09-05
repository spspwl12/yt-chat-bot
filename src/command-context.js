const cfg = require('../data/config-youtube.js');
const msg = require('../data/config-messages.js');
const eventBus = require('./event-bus.js');

// ─── 쿨타임 상태 관리 ─────────────────────────────────────────
// require.cache 무효화(핫리로드) 시에도 쿨타임 상태가 유지되도록 global에 저장
if (!global.__cooldownState) {
    global.__cooldownState = {
        delayChatTime: 0,
        delayChatTimeMap: new Map(),
    };
}
const _cs = global.__cooldownState;
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
        return Date.now() - _cs.delayChatTime <= globalCooldownMs;
    }

    const group = getCommandGroup(cmd);
    const config = getCooldownConfig(group);
    const cooldownMs = 1000 * 60 * config.time;

    const lastTime = _cs.delayChatTimeMap.get(config.key) || 0;
    return Date.now() - lastTime <= cooldownMs;
}

function setCooldown(cmd, offsetMs = 0, _input = null) {
    if (_input) {
        _input.triggerCooldown = () => {
            const now = Date.now() + offsetMs;
            if (cfg.cooldown.mode === 'global') {
                _cs.delayChatTime = now;
            } else {
                const group = getCommandGroup(cmd);
                const config = getCooldownConfig(group);
                _cs.delayChatTimeMap.set(config.key, now);
            }
        };
        return;
    }

    const now = Date.now() + offsetMs;
    if (cfg.cooldown.mode === 'global') {
        _cs.delayChatTime = now;
    } else {
        const group = getCommandGroup(cmd);
        const config = getCooldownConfig(group);
        _cs.delayChatTimeMap.set(config.key, now);
    }
}

function resetCooldown() {
    _cs.delayChatTime = 0;
    _cs.delayChatTimeMap.clear();
}

function getCooldownState() {
    const now = Date.now();
    const globalCooldownMs = 1000 * 60 * cfg.cooldown.time_min;

    const state = {
        mode: cfg.cooldown.mode,
        global: {
            lastTime: _cs.delayChatTime,
            cooldownMs: globalCooldownMs,
            remainingMs: Math.max(0, globalCooldownMs - (now - _cs.delayChatTime))
        },
        groups: {}
    };

    if (cfg.cooldown.mode === 'per-command') {
        const allGroups = Object.keys(commandGroupsMap);

        for (const group of allGroups) {
            const config = getCooldownConfig(group);
            const cooldownMs = 1000 * 60 * config.time;
            const lastTime = _cs.delayChatTimeMap.get(config.key) || 0;
            state.groups[group] = {
                groupKey: config.key,
                cooldownMs,
                lastTime,
                remainingMs: Math.max(0, cooldownMs - (now - lastTime))
            };
        }
    }
    return state;
}

module.exports = {
    eventBus,
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
