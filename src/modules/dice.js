// ─── dice.js ────────────────────────────────────────────────────────────────
// 주사위 굴리기 및 랜덤 선택 모듈
// 사용법:
//   - !주사위                 → 1~6 기본 주사위 (이모지 포함)
//   - !주사위 100             → 1~100 랜덤 숫자
//   - !주사위 10 50           → 10~50 범위 랜덤 숫자
//   - !주사위 짜장 짬뽕 볶음밥 → 선택지 중 하나 랜덤 선택
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');
const { maskProfanity } = require('../func.js');

const DICE_EMOJIS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

module.exports = {
    name: 'dice',
    group: 'dice',
    icon: '🎲',
    aliases: ['!주사위', '!dice', '!굴리기'],
    description: '랜덤 주사위 굴리기 및 선택지 추첨',

    web: {
        title: '주사위 굴리기',
        icon: '🎲',
        description: '랜덤 주사위 굴리기 및 선택지 추첨 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, args, displayName, _input, ctx }) {
        const rawArg = (args && args.length > 0 && typeof args[0] === 'string')
            ? args.join(' ').trim()
            : '';
        const name = maskProfanity(displayName || '시청자');
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        ctx.setCooldown(cmd, 0, _input);

        // 입력값 안전 제한 (200자 초과 시 차단)
        if (rawArg.length > 200) {
            return ctx.returnWarning('⚠️ 입력값이 너무 깁니다. (200자 이내)', cmd, _input);
        }

        // 1. 인자가 없는 경우: 1~6 기본 주사위
        if (!rawArg) {
            const roll = Math.floor(Math.random() * 6) + 1;
            const emoji = DICE_EMOJIS[roll] || '🎲';
            if (msg.dice && msg.dice.roll_standard) {
                return msg.dice.roll_standard(name, emoji, roll, 1, 6, cooldownMsg);
            }
            return `🎲 [${name}]님의 주사위 결과: ${emoji} ${roll} (1~6) ${cooldownMsg}`;
        }

        // 2. 인자 파싱: 숫자 범위인지 아니면 텍스트 선택지인지 판별
        const tokens = rawArg.split(/\s+/).filter(Boolean);

        // (1) 숫자 1개: 1~N (예: !주사위 100)
        if (tokens.length === 1 && /^-?\d+$/.test(tokens[0])) {
            const maxVal = parseInt(tokens[0], 10);
            if (isNaN(maxVal) || maxVal < 1 || maxVal > 1000000) {
                return ctx.returnWarning(
                    (msg.dice && msg.dice.invalid_range) || '⚠️ 1 이상 1,000,000 이하의 숫자를 입력해 주세요.',
                    cmd, _input
                );
            }
            const roll = Math.floor(Math.random() * maxVal) + 1;
            if (maxVal <= 6) {
                const emoji = DICE_EMOJIS[roll] || '🎲';
                return (msg.dice && msg.dice.roll_standard)
                    ? msg.dice.roll_standard(name, emoji, roll, 1, maxVal, cooldownMsg)
                    : `🎲 [${name}]님의 주사위 결과: ${emoji} ${roll} (1~${maxVal}) ${cooldownMsg}`;
            }
            return (msg.dice && msg.dice.roll_custom)
                ? msg.dice.roll_custom(name, roll, 1, maxVal, cooldownMsg)
                : `🎲 [${name}]님의 주사위(1~${maxVal}): ${roll} ${cooldownMsg}`;
        }

        // (2) 숫자 2개: min ~ max (예: !주사위 10 50)
        if (tokens.length === 2 && /^-?\d+$/.test(tokens[0]) && /^-?\d+$/.test(tokens[1])) {
            let minVal = parseInt(tokens[0], 10);
            let maxVal = parseInt(tokens[1], 10);
            if (minVal > maxVal) [minVal, maxVal] = [maxVal, minVal];
            if (isNaN(minVal) || isNaN(maxVal) || (maxVal - minVal) > 1000000 || (maxVal - minVal) < 0) {
                return ctx.returnWarning(
                    (msg.dice && msg.dice.invalid_range) || '⚠️ 올바른 숫자 범위를 입력해 주세요.',
                    cmd, _input
                );
            }
            const roll = Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;
            return (msg.dice && msg.dice.roll_custom)
                ? msg.dice.roll_custom(name, roll, minVal, maxVal, cooldownMsg)
                : `🎲 [${name}]님의 주사위(${minVal}~${maxVal}): ${roll} ${cooldownMsg}`;
        }

        // (3) 여러 단어 선택지: e.g. !주사위 짜장 짬뽕 탕수육
        const chosenRaw = tokens[Math.floor(Math.random() * tokens.length)];
        const chosen = maskProfanity(chosenRaw);

        if (msg.dice && msg.dice.choose_option) {
            return msg.dice.choose_option(name, chosen, cooldownMsg);
        }
        return `🎲 [${name}]님의 선택: "${chosen}" ${cooldownMsg}`;
    }
};
