const msg = require('../../data/config-messages.js');
const { sendChat } = require('../innertube.js');

module.exports = {
    name: 'help',
    group: 'help',
    icon: '❓',
    aliases: ['!도움', '!안내', '!소개', '!헬프', '!가이드', '!도움말', '!사용법', '!설명서', '!명령어', '!commands', '!command'],
    description: '봇 명령어 안내 및 도움말 출력',

    web: {
        title: '명령어 도움말',
        icon: 'ℹ️',
        description: '전체 명령어 및 사용법 안내 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, _input, ctx }) {
        ctx.setCooldown(cmd, 0, _input);

        if (msg.help.main2 && _input) {
            _input.onSuccess = () => {
                sendChat(msg.help.main2);
            };
        }

        return msg.help.main;
    }
};
