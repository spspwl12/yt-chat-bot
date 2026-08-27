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
        // 리로드 공백(destroy→init 사이) 동안 chat 이벤트 손실 방지용 임시 버퍼
        const chatBuffer = [];
        const chatBufferListener = (msg) => chatBuffer.push(msg);
        eventBus.on('chat', chatBufferListener);

        // 기존 모듈 정리 (stop/destroy 훅 실행)
        const prevModules = this.modules ? new Map(this.modules) : new Map();
        if (this.modules && this.modules.size > 0) {
            for (const [name, mod] of this.modules) {
                try {
                    // 💡 [필수] 만약 모듈 내부에 이벤트 해제 로직이 없다면 여기서 확실히 해제 유도
                    if (typeof mod.destroy === 'function') mod.destroy();
                    else if (typeof mod.stop === 'function') mod.stop();

                    // 만약 모듈 안에 리스너 해제 함수를 따로 안 만들었다면 
                    // eventBus.removeAllListeners(`chat:${name}`) 같은 네임스페이스 구조를 권장합니다.
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
            // 💡 에러 시 버퍼 리스너를 해제해 주지 않으면 여기서도 누수가 납니다.
            eventBus.off('chat', chatBufferListener);
            return;
        }

        // 1패스: modules/*.js 및 그 의존성 트리 전체를 재귀적으로 캐시 삭제
        const selfPath = require.resolve(__filename);
        const nodeModulesStr = path.sep + 'node_modules' + path.sep;
        const coreSingletons = new Set([
            selfPath,
            require.resolve('./tracker.js'),
            require.resolve('./video-matcher/search.js'),
            require.resolve('./innertube.js'),
            require.resolve('./event-bus.js'),
            require.resolve('./config-manager.js'),
        ]);
        const invalidated = new Set();

        const invalidateWithDeps = (filePath) => {
            let resolved;
            try { resolved = require.resolve(filePath); } catch { return; }
            if (invalidated.has(resolved)) return;
            if (coreSingletons.has(resolved)) return;
            if (resolved.includes(nodeModulesStr)) return;
            invalidated.add(resolved);
            const cached = require.cache[resolved];
            if (cached) {
                if (Array.isArray(cached.children)) {
                    for (const child of cached.children) {
                        invalidateWithDeps(child.id);
                    }
                    cached.children = [];
                }

                // 부모 모듈 참조 제거 (현재 캐시 순회 방식은 정확하며 안전합니다)
                for (const cacheId in require.cache) {
                    const parentModule = require.cache[cacheId];
                    if (parentModule && Array.isArray(parentModule.children)) {
                        const idx = parentModule.children.indexOf(cached);
                        if (idx !== -1) {
                            parentModule.children.splice(idx, 1);
                        }
                    }
                }

                delete require.cache[resolved];
            }
        };

        const files = fs.readdirSync(this.modulesDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            invalidateWithDeps(path.join(this.modulesDir, file));
        }
        invalidateWithDeps(path.join(__dirname, 'command-context.js'));

        // command-context.js fresh 재로딩
        this.context = require('./command-context.js');

        // 2패스: 모든 모듈 fresh require
        for (const file of files) {
            const filePath = path.join(this.modulesDir, file);

            try {
                const realPath = fs.realpathSync(filePath);
                const realDir = fs.realpathSync(this.modulesDir);
                if (!realPath.startsWith(realDir + path.sep) && realPath !== realDir) {
                    console.warn(`⚠️ [ModuleManager] 심볼릭 링크 외부 경로 스킵: ${file} → ${realPath}`);
                    continue;
                }
            } catch (pathErr) {
                console.warn(`⚠️ [ModuleManager] 경로 검증 실패 스킵 (${file}):`, pathErr.message);
                continue;
            }

            try {
                const mod = require(filePath);

                if (!mod || !mod.name) {
                    console.warn(`⚠️ [ModuleManager] name 속성이 없는 모듈 스킵: ${file}`);
                    continue;
                }

                newModules.set(mod.name, mod);

                if (typeof mod.execute === 'function') {
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

        this.context.setCommandGroupResolver((cmd) => {
            const entry = this.aliasToModule.get(cmd);
            return entry ? entry.group : cmd;
        }, this.commandGroups);

        // 리로드 공백 동안 버퍼에 쌓인 chat 이벤트 플러시 후 버퍼 리스너 제거
        eventBus.off('chat', chatBufferListener);
        if (chatBuffer.length > 0) {
            console.log(`📦 [ModuleManager] 리로드 공백 중 버퍼된 chat ${chatBuffer.length}건 재처리`);

            // 💡 setImmediate를 사용해 동기적 실행 스택이 꼬이는 것을 방지합니다.
            setImmediate(() => {
                for (const msg of chatBuffer) {
                    eventBus.emit('chat', msg);
                }
            });
        }

        console.log(`✅ [ModuleManager] ${this.modules.size}개 모듈 로드 완료 (${this.aliasToModule.size}개 명령어 등록)`);
    }

    /**
     * 봇 재부팅 없이 모든 모듈 실시간 핫리로드 (실패 시 스냅샷 롤백)
     */
    reload() {
        console.log('🔄 [ModuleManager] 모든 모듈 핫리로드 시작...');
        // 롤백용 스냅샷 저장
        const snapshot = {
            modules: new Map(this.modules),
            aliasToModule: new Map(this.aliasToModule),
            commandGroups: { ...this.commandGroups },
        };
        try {
            this.loadModules();
            return true;
        } catch (err) {
            console.error('❌ [ModuleManager] 핫리로드 실패 — 이전 상태로 롤백:', err.message);
            // 롤백 복원
            this.modules = snapshot.modules;
            this.aliasToModule = snapshot.aliasToModule;
            this.commandGroups = snapshot.commandGroups;
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

        if (Math.abs((rtn.end ?? NaN) - (rtn.now ?? NaN)) <= cfg.input.boundary_sec || (rtn.now ?? NaN) <= cfg.input.boundary_sec) {
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
