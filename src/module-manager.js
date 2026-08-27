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
     * 모듈 디렉토리 내의 모듈 간 의존성 맵 구축 (require 문 및 mod.dependencies 분석)
     */
    getDependencyGraph() {
        const graph = {};
        if (!fs.existsSync(this.modulesDir)) return graph;

        const files = fs.readdirSync(this.modulesDir).filter(f => f.endsWith('.js'));
        const moduleNames = files.map(f => path.basename(f, '.js'));

        for (const name of moduleNames) {
            graph[name] = { dependencies: new Set(), dependents: new Set() };
        }

        for (const file of files) {
            const modName = path.basename(file, '.js');
            const filePath = path.join(this.modulesDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                // require('./<modName>') 또는 require('./<modName>.js') 구문 정규식 매칭
                const requireRegex = /require\s*\(\s*['"]\.\/([^'"]+?)(?:\.js)?['"]\s*\)/g;
                let match;
                while ((match = requireRegex.exec(content)) !== null) {
                    const depName = match[1];
                    if (moduleNames.includes(depName) && depName !== modName) {
                        graph[modName].dependencies.add(depName);
                        if (graph[depName]) {
                            graph[depName].dependents.add(modName);
                        }
                    }
                }

                // 모듈 객체에 명시적 dependencies 가 선언된 경우 추가
                const mod = this.modules.get(modName);
                if (mod && Array.isArray(mod.dependencies)) {
                    for (const dep of mod.dependencies) {
                        if (moduleNames.includes(dep) && dep !== modName) {
                            graph[modName].dependencies.add(dep);
                            if (graph[dep]) graph[dep].dependents.add(modName);
                        }
                    }
                }
            } catch (err) {
                console.warn(`⚠️ [ModuleManager] 의존성 분석 실패 (${file}):`, err.message);
            }
        }

        return graph;
    }

    /**
     * 지정된 모듈들의 상호 의존성(상위 의존 + 하위 피의존)을 재귀 탐색하여
     * 안전하게 함께 리로드되어야 할 전체 모듈 목록 반환
     */
    resolveDependencies(targetNames) {
        if (!fs.existsSync(this.modulesDir)) return [];
        const allFiles = fs.readdirSync(this.modulesDir).filter(f => f.endsWith('.js')).map(f => path.basename(f, '.js'));
        if (!targetNames || targetNames === 'all' || (Array.isArray(targetNames) && targetNames.length === 0)) {
            return allFiles;
        }

        const targets = Array.isArray(targetNames) ? targetNames : [targetNames];
        const graph = this.getDependencyGraph();
        const resolved = new Set();
        const queue = [...targets];

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) continue;
            const cleanName = current.endsWith('.js') ? current.slice(0, -3) : current;
            if (resolved.has(cleanName)) continue;
            if (!allFiles.includes(cleanName)) continue;

            resolved.add(cleanName);

            const node = graph[cleanName];
            if (node) {
                // 상위 의존 모듈 (내가 필요로 하는 모듈)
                for (const dep of node.dependencies) {
                    if (!resolved.has(dep)) queue.push(dep);
                }
                // 하위 피의존 모듈 (나를 참조하고 있어서 내가 리로드되면 같이 리로드되어야 하는 모듈)
                for (const dep of node.dependents) {
                    if (!resolved.has(dep)) queue.push(dep);
                }
            }
        }

        return Array.from(resolved);
    }

    /**
     * 웹 대시보드 및 리로드 모달에서 사용하는 전체 모듈 메타데이터 목록 반환
     */
    getModuleList() {
        if (!fs.existsSync(this.modulesDir)) return [];
        const files = fs.readdirSync(this.modulesDir).filter(f => f.endsWith('.js'));
        const graph = this.getDependencyGraph();
        const list = [];

        // 모듈 기본 아이콘 매핑
        const defaultIcons = {
            coolcheck: '⏳', date: '📅', dice: '🎲', episode: '🎬',
            future: '⏭️', generator: '🖼️', greeting: '👋', help: '❓',
            menu: '🍱', music: '🎵', poster: '📢', stats: '📊',
            time: '⏰', timetable: '📑', weather: '⛅'
        };

        for (const file of files) {
            const modName = path.basename(file, '.js');
            const mod = this.modules.get(modName) || {};
            const isCommand = typeof mod.execute === 'function';
            const node = graph[modName] || { dependencies: new Set(), dependents: new Set() };
            const related = Array.from(new Set([
                ...Array.from(node.dependencies),
                ...Array.from(node.dependents)
            ]));

            list.push({
                name: mod.name || modName,
                fileName: file,
                title: (mod.web && mod.web.title) ? mod.web.title : (mod.name || modName),
                icon: (mod.web && mod.web.icon) ? mod.web.icon : (defaultIcons[modName] || (isCommand ? '⚡' : '⚙️')),
                description: (mod.web && mod.web.description) ? mod.web.description : (mod.description || ''),
                category: (mod.web && mod.web.category) ? mod.web.category : (isCommand ? 'Commands' : 'Services'),
                badge: (mod.web && mod.web.badge) ? mod.web.badge : (isCommand ? 'Command' : 'Service'),
                isCommand,
                aliases: mod.aliases || [],
                group: mod.group || null,
                groups: mod.groups || null,
                dependencies: Array.from(node.dependencies),
                dependents: Array.from(node.dependents),
                related: related
            });
        }

        return list;
    }

    /**
     * modules 디렉토리 내의 모듈 동적 로드 (전체 또는 지정된 모듈 리스트)
     * @param {string[]|string|null} targetModules 리로드할 모듈명 배열 (생략 시 전체 리로드)
     */
    loadModules(targetModules = null) {
        // 리로드 공백(destroy→init 사이) 동안 chat 이벤트 손실 방지용 임시 버퍼
        const chatBuffer = [];
        const chatBufferListener = (msg) => chatBuffer.push(msg);
        eventBus.on('chat', chatBufferListener);

        if (!fs.existsSync(this.modulesDir)) {
            console.warn(`⚠️ [ModuleManager] 모듈 디렉토리가 없습니다: ${this.modulesDir}`);
            eventBus.off('chat', chatBufferListener);
            return { success: false, error: 'Directory not found' };
        }

        const allFiles = fs.readdirSync(this.modulesDir).filter(f => f.endsWith('.js'));
        const isFullReload = !targetModules || targetModules === 'all' || (Array.isArray(targetModules) && targetModules.length === 0) || (Array.isArray(targetModules) && targetModules.length >= allFiles.length);

        // 의존성 분석을 거친 실제 리로드 대상 모듈명 목록
        const modulesToReload = isFullReload
            ? allFiles.map(f => path.basename(f, '.js'))
            : this.resolveDependencies(targetModules);

        const reloadSet = new Set(modulesToReload);

        // 1단계: 리로드 대상 모듈 정리 (destroy/stop 훅 실행)
        if (this.modules && this.modules.size > 0) {
            for (const [name, mod] of this.modules) {
                if (reloadSet.has(name)) {
                    try {
                        if (typeof mod.destroy === 'function') mod.destroy();
                        else if (typeof mod.stop === 'function') mod.stop();
                    } catch (err) {
                        console.warn(`⚠️ [ModuleManager] 모듈 정리 중 에러 (${name}):`, err.message);
                    }
                }
            }
        }

        // 캐시 무효화 헬퍼
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

                // 부모 모듈 참조 제거
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

        // 2단계: 대상 모듈 파일 및 의존성 캐시 삭제
        for (const modName of modulesToReload) {
            const filePath = path.join(this.modulesDir, `${modName}.js`);
            if (fs.existsSync(filePath)) {
                invalidateWithDeps(filePath);
            }
        }

        if (isFullReload) {
            invalidateWithDeps(path.join(__dirname, 'command-context.js'));
            this.context = require('./command-context.js');
        } else if (!this.context) {
            this.context = require('./command-context.js');
        }

        // 3단계: 모듈 재구성
        // 부분 리로드 시 기존 모듈 복사 후 대상만 fresh require로 덮어씀
        const newModules = isFullReload ? new Map() : new Map(this.modules);

        for (const file of allFiles) {
            const modName = path.basename(file, '.js');
            if (!reloadSet.has(modName) && !isFullReload) {
                // 리로드 대상이 아닌 모듈은 기존 인스턴스 유지
                continue;
            }

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

        // 4단계: 명령어 별칭 및 그룹 맵 전체 재구성
        const newAliasMap = new Map();
        const newCommandGroups = {};

        for (const [name, mod] of newModules) {
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
            setImmediate(() => {
                for (const msg of chatBuffer) {
                    eventBus.emit('chat', msg);
                }
            });
        }

        const reloadedCount = modulesToReload.length;
        if (isFullReload) {
            console.log(`✅ [ModuleManager] 전체 ${this.modules.size}개 모듈 로드 완료 (${this.aliasToModule.size}개 명령어 등록)`);
        } else {
            console.log(`✅ [ModuleManager] ${reloadedCount}개 모듈 선택적 핫리로드 완료 [${modulesToReload.join(', ')}]`);
        }

        return {
            success: true,
            reloaded: modulesToReload,
            total: this.modules.size,
            isFullReload
        };
    }

    /**
     * 봇 재부팅 없이 모듈 실시간 핫리로드 (전체 또는 지정 모듈, 실패 시 스냅샷 롤백)
     * @param {string[]|string|null} targetModules 리로드할 모듈명 배열 (생략 시 전체 리로드)
     */
    reload(targetModules = null) {
        console.log(`🔄 [ModuleManager] 모듈 핫리로드 시작... (${targetModules ? JSON.stringify(targetModules) : '전체'})`);
        // 롤백용 스냅샷 저장
        const snapshot = {
            modules: new Map(this.modules),
            aliasToModule: new Map(this.aliasToModule),
            commandGroups: { ...this.commandGroups },
        };
        try {
            const result = this.loadModules(targetModules);
            if (result && result.success) return result;
            throw new Error(result ? result.error : 'Reload failed');
        } catch (err) {
            console.error('❌ [ModuleManager] 핫리로드 실패 — 이전 상태로 롤백:', err.message);
            // 롤백 복원
            this.modules = snapshot.modules;
            this.aliasToModule = snapshot.aliasToModule;
            this.commandGroups = snapshot.commandGroups;
            return {
                success: false,
                error: err.message,
                reloaded: []
            };
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
    reloadCommands: (targets) => moduleManager.reload(targets),
    reloadModules: (targets) => moduleManager.reload(targets),
    shutdown: () => moduleManager.shutdown(),
    getCooldownState: () => moduleManager.getCooldownState(),
    getWebModules: () => moduleManager.getWebModules(),
    getModuleList: () => moduleManager.getModuleList(),
    getDependencyGraph: () => moduleManager.getDependencyGraph(),
    resolveDependencies: (targets) => moduleManager.resolveDependencies(targets),
    handleWebAction: (action, payload) => moduleManager.handleWebAction(action, payload),
    get context() { return moduleManager.context; }
};
