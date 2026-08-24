const fs = require('fs');
const path = require('path');
const { getEpisodeInfo } = require('./tracker.js');

// cfg/msg를 매 호출마다 fresh하게 읽는 헬퍼 (리로드 후 반영)
function getCfg() { return require(path.join(__dirname, '../data/config-youtube.js')); }
function getMsg() { return require(path.join(__dirname, '../data/config-messages.js')); }

const eventBus = require('./event-bus.js');

class ModuleManager {
    constructor() {
        this.modules = new Map();         // name -> module
        this.aliasToModule = new Map();    // alias -> { module, group }
        this.commandGroups = {};           // group -> [aliases]
        this.modulesDir = path.join(__dirname, 'modules');
        this.context = null;
        this.loadModules();
    }

    /**
     * modules 디렉토리 내의 모든 독립 모듈 동적 로드
     * command-context.js 포함 관련 모듈 전체 캐시 삭제 후 fresh require
     */
    loadModules() {
        // 기존 모듈 정리 (stop/destroy 훅 실행)
        if (this.modules && this.modules.size > 0) {
            for (const [name, mod] of this.modules) {
                try {
                    if (typeof mod.destroy === 'function') mod.destroy();
                    else if (typeof mod.stop === 'function') mod.stop();
                } catch (err) {
                    console.warn(`⚠️ [ModuleManager] 모듈 정리 중 에러 (${name}):`, err.message);
                }
            }
        }

        const newModules = new Map();
        const newAliasMap = new Map();
        const newCommandGroups = {};

        if (!fs.existsSync(this.modulesDir)) {
            console.warn(`⚠️ [ModuleManager] 모듈 디렉토리가 없습니다: ${this.modulesDir}`);
            return;
        }

        // 1패스: data 파일 및 관련 모든 모듈 캐시 삭제
        const filesToInvalidate = [
            '../data/config-youtube.js',
            '../data/config-messages.js',
            '../data/config-search.js',
            '../data/profanity-list.js',
            '../data/video-music.json',
            '../data/video-metadata.json',
            '../data/video-info.json',
            '../data/video-sub.json',
            './greeting.js',
            './func.js',
            './stats-db.js',
            './command-context.js',
        ];
        for (const relPath of filesToInvalidate) {
            try {
                const resolved = require.resolve(path.join(__dirname, relPath));
                delete require.cache[resolved];
            } catch {}
        }

        // command-context.js fresh 재로딩
        this.context = require('./command-context.js');

        // 2패스: 모든 모듈 캐시 삭제 후 fresh require
        const files = fs.readdirSync(this.modulesDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            const filePath = path.join(this.modulesDir, file);
            try {
                const resolved = require.resolve(filePath);
                delete require.cache[resolved];
                const mod = require(filePath);

                if (!mod || !mod.name) {
                    console.warn(`⚠️ [ModuleManager] name 속성이 없는 모듈 스킵: ${file}`);
                    continue;
                }

                newModules.set(mod.name, mod);

                // 명령어가 정의된 모듈인 경우에만 alias 및 group 등록
                if (typeof mod.execute === 'function') {
                    // 단일 그룹 모듈
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

                    // 다중 그룹 모듈 (예: future-episode)
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
                }

                // 모듈 초기화 훅 (init 또는 start) 실행
                try {
                    if (typeof mod.init === 'function') {
                        mod.init({ eventBus, moduleManager: this });
                    } else if (typeof mod.start === 'function') {
                        mod.start({ eventBus, moduleManager: this });
                    }
                } catch (initErr) {
                    console.error(`❌ [ModuleManager] 모듈 초기화 에러 (${mod.name}):`, initErr.message);
                }

            } catch (err) {
                console.error(`❌ [ModuleManager] 개별 모듈 로드 실패 (${file}):`, err.message);
            }
        }

        this.modules = newModules;
        this.aliasToModule = newAliasMap;
        this.commandGroups = newCommandGroups;

        // context에 명령어 그룹 resolver 주입
        this.context.setCommandGroupResolver((cmd) => {
            const entry = this.aliasToModule.get(cmd);
            return entry ? entry.group : cmd;
        }, this.commandGroups);

        console.log(`✅ [ModuleManager] ${this.modules.size}개 모듈 로드 완료 (${this.aliasToModule.size}개 명령어 등록)`);
    }

    /**
     * 봇 재부팅 없이 모든 모듈 실시간 핫리로드
     */
    reload() {
        console.log('🔄 [ModuleManager] 모든 모듈 핫리로드 시작...');
        try {
            this.loadModules();
            return true;
        } catch (err) {
            console.error('❌ [ModuleManager] 핫리로드 실패:', err.message);
            return false;
        }
    }

    /**
     * 프로세스 종료 시 모든 모듈 정리
     */
    shutdown() {
        console.log('⏹️ [ModuleManager] 모든 모듈 종료 정리...');
        for (const [name, mod] of this.modules) {
            try {
                if (typeof mod.destroy === 'function') mod.destroy();
                else if (typeof mod.stop === 'function') mod.stop();
            } catch (err) {
                console.warn(`⚠️ [ModuleManager] 모듈 종료 중 에러 (${name}):`, err.message);
            }
        }
    }

    /**
     * 웹 대시보드에서 열람 가능한 웹 모듈 목록 반환
     */
    getWebModules() {
        const list = [];
        for (const [name, mod] of this.modules) {
            if (mod.web) {
                list.push({
                    id: mod.web.id || mod.name,
                    name: mod.name,
                    title: mod.web.title || mod.name,
                    icon: mod.web.icon || '📦',
                    description: mod.web.description || mod.description || '',
                    category: mod.web.category || (typeof mod.execute === 'function' ? 'Commands' : 'Services'),
                    badge: mod.web.badge || (typeof mod.execute === 'function' ? 'Command' : 'Service'),
                    isCommand: typeof mod.execute === 'function',
                    aliases: mod.aliases || [],
                    group: mod.group || null,
                    // 모듈 자체 UI 정의
                    panel: mod.web.panel || null,
                    styles: mod.web.styles || null,
                    scripts: mod.web.scripts || null,
                });
            }
        }
        return list;
    }

    /**
     * 웹소켓 클라이언트로부터 들어온 웹 액션을 모듈의 web.actions 로 동적 디스패치
     */
    async handleWebAction(action, payload) {
        for (const [name, mod] of this.modules) {
            if (mod.web && mod.web.actions && typeof mod.web.actions[action] === 'function') {
                try {
                    const result = await mod.web.actions[action](payload);
                    return { handled: true, result, moduleName: name };
                } catch (err) {
                    console.error(`❌ [ModuleManager] 모듈 웹 액션 에러 (${name}.${action}):`, err);
                    return { handled: true, error: err.message, moduleName: name };
                }
            }
        }
        return { handled: false };
    }

    getModule(name) {
        return this.modules.get(name) || null;
    }

    getAllModules() {
        return Array.from(this.modules.values());
    }

    resolveCommand(cmd) {
        return this.aliasToModule.get(cmd) || null;
    }

    /**
     * 유튜브 채팅 명령어 메인 핸들러
     */
    async handleCommand(type, text, displayName, _input) {
        const ctx = this.context;

        // 쿨타임 강제 초기화
        if (type === 0) {
            ctx.resetCooldown();
            return null;
        }

        const cfg = getCfg();
        const msg = getMsg();

        if (!text || typeof text !== 'string')
            return null;

        if (text.length < cfg.input.text_min_length)
            return null;

        text = text.replace(/^\s*!\s*/, '!');
        if (!text.startsWith('!'))
            return null;

        const parts = text.trim().split(/ (.+)/);
        const cmd = parts[0];
        const args = parts.slice(1);

        const resolved = this.resolveCommand(cmd);
        if (!resolved)
            return null;

        const { module: targetModule, group } = resolved;

        if (ctx.isCooldown(cmd))
            return null;

        if (_input && _input.ban) {
            _input.blockedCommand = true;
            return null;
        }

        const customWarn = ctx.getWarnsValue(group);
        if (_input) {
            _input.warn = customWarn !== null ? customWarn : 1;
        }

        const rtn = getEpisodeInfo();
        if (!rtn) return null;

        if (Math.abs(rtn.end - rtn.now) <= cfg.input.boundary_sec || rtn.now <= cfg.input.boundary_sec) {
            if (_input) _input.warn = 0;
            return null;
        }

        if (text.length > cfg.input.text_max_length) {
            return ctx.returnWarning(msg.error.text_too_long(cfg.input.text_max_length), cmd, _input);
        }

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

        try {
            const result = await targetModule.execute({
                cmd, args, text, group, displayName,
                channelId: _input ? _input.channelId : null,
                _input, rtn,
                ctx
            });
            return _emitLog(result);
        } catch (err) {
            console.error(`❌ [ModuleManager] 명령어 실행 에러 (${cmd}):`, err);
            return null;
        }
    }

    getCooldownState() {
        return this.context.getCooldownState();
    }
}

const moduleManager = new ModuleManager();

module.exports = {
    moduleManager,
    commandManager: moduleManager,
    handleCommand: (type, text, displayName, _input) => moduleManager.handleCommand(type, text, displayName, _input),
    reloadCommands: () => moduleManager.reload(),
    reloadModules: () => moduleManager.reload(),
    shutdown: () => moduleManager.shutdown(),
    getCooldownState: () => moduleManager.getCooldownState(),
    getWebModules: () => moduleManager.getWebModules(),
    handleWebAction: (action, payload) => moduleManager.handleWebAction(action, payload),
    get context() { return moduleManager.context; }
};
