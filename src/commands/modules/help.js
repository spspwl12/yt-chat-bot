module.exports = {
    name: 'help',
    group: 'help',
    aliases: ['!도움', '!안내', '!소개', '!헬프', '!가이드', '!도움말', '!사용법', '!설명서', '!명령어', '!commands', '!command'],
    description: '봇 명령어 안내 및 도움말 출력',

    async execute({ cmd, _input, ctx }) {
        ctx.setCooldown(cmd, 0, _input);
        return ctx.msg.help.main;
    }
};
