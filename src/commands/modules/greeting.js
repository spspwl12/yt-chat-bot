module.exports = {
    name: 'greeting',
    group: 'greeting',
    aliases: ['!안녕', '!인사', '!하이', '!헬로', '!ㅎㅇ', '!gd', '!반가워', '!방가'],
    description: '봇 인사 메시지 출력',

    async execute({ cmd, displayName, _input, ctx }) {
        if (!ctx.cfg.input.enable_greeting) {
            return null;
        }
        // lazy require: 핫리로드 시 최신 greeting.js 코드가 반영되도록 execute 안에서 require
        const greeting_lib = require('../../greeting.js');
        ctx.setCooldown(cmd, 0, _input);
        return greeting_lib(ctx.maskProfanity(displayName));
    }
};
