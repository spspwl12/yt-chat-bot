const cfg = require('../../../data/config-youtube.js');
const { maskProfanity } = require('../../func.js');

module.exports = {
    name: 'greeting',
    group: 'greeting',
    aliases: ['!안녕', '!인사', '!하이', '!헬로', '!ㅎㅇ', '!gd', '!반가워', '!방가'],
    description: '봇 인사 메시지 출력',

    async execute({ cmd, displayName, _input, ctx }) {
        if (!cfg.input.enable_greeting) {
            return null;
        }
        const greeting_lib = require('../../greeting.js');
        ctx.setCooldown(cmd, 0, _input);
        return greeting_lib(maskProfanity(displayName));
    }
};
