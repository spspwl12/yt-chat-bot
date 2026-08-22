const fs = require('fs');
const path = require('path');
const context = require('./context.js');
const { getEpisodeInfo } = require('../tracker.js');

class CommandManager {
    constructor() {
        this.modules = new Map();         // name -> module
        this.aliasToModule = new Map();    // alias (e.g. '!스탯') -> { module, group }
        this.commandGroups = {};           // group -> [aliases]
        this.modulesDir = path.join(__dirname, 'modules');
        this.watcher = null;
        this.watchDebounce = null;
        this.loadModules();
        this.startWatcher();
    }

    /**
     * modules 디렉토리 파일 변경 감지 및 자동 핫리로드
     */
    startWatcher() {
        if (!fs.existsSync(this.modulesDir)) return;
        try {
            this.watcher = fs.watch(this.modulesDir, (eventType, filename) => {
                if (!filename || !filename.endsWith('.js')) return;
                if (this.watchDebounce) clearTimeout(this.watchDebounce);
                this.watchDebounce = setTimeout(() => {
                    console.log(`📂 [CommandManager] 모듈 파일 변경 감지 (${filename}) → 자동 핫리로드 실행`);
                    this.reload();
                }, 300);
            });
        } catch (e) {
            console.warn('⚠️ [CommandManager] 파일 감시기 시작 실패:', e.message);
        }
    }

    /**
     * modules 디렉토리 내의 모든 명령어 모듈 동적 로드
     */
    loadModules() {
        const newModules = new Map();
        const newAliasMap = new Map();
        const newCommandGroups = {};

        if (!fs.existsSync(this.modulesDir)) {
            console.warn(`⚠️ [CommandManager] 모듈 디렉토리가 없습니다: ${this.modulesDir}`);
            return;
        }

        const files = fs.readdirSync(this.modulesDir).filter(f => f.endsWith('.js'));

        // 1패스: 모듈 파일 + 모듈이 lazy-require하는 src/ 하위 라이브러리 캐시 삭제
        // (greeting.js → ../greeting.js 등 모듈 레벨에서 직접 참조하는 라이브러리)
        try {
            const greetingPath = require.resolve('../greeting.js');
            delete require.cache[greetingPath];
        } catch {}

        for (const file of files) {
            const filePath = path.join(this.modulesDir, file);
            try {
                // 캐시 삭제 후 fresh require
                const resolved = require.resolve(filePath);
                delete require.cache[resolved];
                const mod = require(filePath);

                if (!mod || !mod.name || typeof mod.execute !== 'function') {
                    console.warn(`⚠️ [CommandManager] 유효하지 않은 모듈 스킵: ${file}`);
                    continue;
                }

                newModules.set(mod.name, mod);

                // 1. 단일 그룹 모듈인 경우
                if (mod.group && Array.isArray(mod.aliases)) {
                    const group = mod.group;
                    if (!newCommandGroups[group]) newCommandGroups[group] = [];

                    for (const alias of mod.aliases) {
                        const cleanAlias = alias.trim();
                        newAliasMap.set(cleanAlias, { module: mod, group });
                        if (!newCommandGroups[group].includes(cleanAlias)) {
                            newCommandGroups[group].push(cleanAlias);
                        }
                    }
                }

                // 2. 다중 그룹을 지원하는 모듈인 경우 (예: future-episode)
                if (mod.groups && typeof mod.groups === 'object') {
                    for (const [group, aliases] of Object.entries(mod.groups)) {
                        if (!newCommandGroups[group]) newCommandGroups[group] = [];

                        for (const alias of aliases) {
                            const cleanAlias = alias.trim();
                            newAliasMap.set(cleanAlias, { module: mod, group });
                            if (!newCommandGroups[group].includes(cleanAlias)) {
                                newCommandGroups[group].push(cleanAlias);
                            }
                        }
                    }
                }

            } catch (err) {
                console.error(`❌ [CommandManager] 모듈 로드 실패 (${file}):`, err.message);
                throw err;
            }
        }

        this.modules = newModules;
        this.aliasToModule = newAliasMap;
        this.commandGroups = newCommandGroups;

        // context에 명령어 그룹 resolver 주입
        context.setCommandGroupResolver((cmd) => {
            const entry = this.aliasToModule.get(cmd);
            return entry ? entry.group : cmd;
        }, this.commandGroups);

        console.log(`✅ [CommandManager] ${this.modules.size}개 모듈 로드 완료 (${this.aliasToModule.size}개 명령어 등록)`);
    }

    /**
     * 봇 재부팅 없이 모든 명령어 모듈 실시간 핫리로드
     */
    reload() {
        console.log('🔄 [CommandManager] 명령어 모듈 핫리로드 시작...');
        try {
            this.loadModules();
            return true;
        } catch (err) {
            console.error('❌ [CommandManager] 핫리로드 실패 (기존 모듈 상태 유지):', err.message);
            return false;
        }
    }

    /**
     * 특정 명령어 alias에 매핑된 모듈 및 그룹 정보 조회
     * @param {string} cmd 
     */
    resolveCommand(cmd) {
        return this.aliasToModule.get(cmd) || null;
    }

    /**
     * 유튜브 채팅 명령어 메인 핸들러
     * @param {number} type - 0: 쿨타임 초기화, 1: 일반 명령어 처리
     * @param {string} text - 채팅 텍스트
     * @param {string} displayName - 유저 닉네임
     * @param {object} _input - 컨텍스트 상태 객체 (warn, ban, channelId 등)
     */
    async handleCommand(type, text, displayName, _input) {
        // 쿨타임 강제 초기화
        if (type === 0) {
            context.resetCooldown();
            return null;
        }

        // 메시지 기본 유효성 검증
        if (!text || typeof text !== "string")
            return null;

        if (text.length < context.cfg.input.text_min_length)
            return null;

        // 2. 명령어 접두사 확인
        text = text.replace(/^\s*!\s*/, '!');
        if (!text.startsWith('!'))
            return null;

        // 3. 파싱 및 모듈 매핑
        const parts = text.trim().split(/ (.+)/);
        const cmd = parts[0];
        const args = parts.slice(1);

        const resolved = this.resolveCommand(cmd);
        if (!resolved)
            return null;

        const { module: targetModule, group } = resolved;

        // 4. 쿨타임 체크
        if (context.isCooldown(cmd))
            return null;

        // 5. 차단 유저 플래그 체크
        if (_input && _input.ban) {
            _input.blockedCommand = true;
            return null;
        }

        // 6. 경고(Warns) 수치 할당
        const customWarn = context.getWarnsValue(group);
        if (_input) {
            _input.warn = customWarn !== null ? customWarn : 1;
        }

        const rtn = getEpisodeInfo();
        if (!rtn) {
            return null;
        }

        // 과도기/경계 시간 보호
        if (Math.abs(rtn.end - rtn.now) <= context.cfg.input.boundary_sec || rtn.now <= context.cfg.input.boundary_sec) {
            if (_input) _input.warn = 0;
            return null;
        }

        // 명령어 사용 로그 메타데이터 저장
        const _emitLog = (response) => {
            if (_input) {
                _input.logData = {
                    time: Date.now(),
                    user: displayName,
                    cmd: cmd,
                    group: group,
                    args: args.length > 0 ? args[0] : null,
                    response: typeof response === 'string' ? response :
                        (response && response.msg ? response.msg : null),
                };
            }
            return response;
        };

        if (text.length > context.cfg.input.text_max_length) {
            return _emitLog(context.returnWarning(
                context.msg.error.text_too_long(context.cfg.input.text_max_length), cmd, _input));
        }

        try {
            const result = await targetModule.execute({
                cmd,
                args,
                text,
                group,
                displayName,
                channelId: _input ? _input.channelId : null,
                _input,
                rtn,
                ctx: context
            });

            return _emitLog(result);
        } catch (err) {
            console.error(`❌ [CommandManager] 명령어 실행 에러 (${cmd}):`, err);
            return null;
        }
    }

    getCooldownState() {
        return context.getCooldownState();
    }
}

const commandManager = new CommandManager();

module.exports = {
    commandManager,
    handleCommand: (type, text, displayName, _input) => commandManager.handleCommand(type, text, displayName, _input),
    reloadCommands: () => commandManager.reload(),
    getCooldownState: () => commandManager.getCooldownState(),
    context
};
