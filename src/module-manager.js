const fs = require('fs');
const path = require('path');
const { getEpisodeInfo } = require('./tracker.js');

// cfg/msg를 매 호출마다 fresh하게 읽는 헬퍼 (리로드 후 반영)
function getCfg() { return require(path.join(__dirname, '../data/config-youtube.js')); }
function getMsg() { return require(path.join(__dirname, '../data/config-messages.js')); }

const eventBus = require('./event-bus.js');

/**
 * 모듈별 독립적인 ScopedEventBus 래퍼
 * 모듈이 eventBus에 등록한 모든 이벤트 리스너를 추적하여
 * 언로드 또는 리로드 시 자동으로 일괄 해제함으로써 메모리 누수 방지
 */
class ScopedEventBus {
    constructor(parentBus, moduleName) {
        this.parentBus = parentBus;
        this.moduleName = moduleName;
        this.trackedListeners = []; // { event, listener }
    }

    on(event, listener) {
        if (typeof listener !== 'function') return this;
        this.parentBus.on(event, listener);
        this.trackedListeners.push({ event, listener });
        return this;
    }

    addListener(event, listener) {
        return this.on(event, listener);
    }

    once(event, listener) {
        if (typeof listener !== 'function') return this;
        const wrapped = (...args) => {
            this.removeTracked(event, wrapped);
            listener(...args);
        };
        this.parentBus.once(event, wrapped);
        this.trackedListeners.push({ event, listener: wrapped });
        return this;
    }

    off(event, listener) {
        this.parentBus.off(event, listener);
        this.removeTracked(event, listener);
        return this;
    }

    removeListener(event, listener) {
        return this.off(event, listener);
    }

    emit(event, ...args) {
        return this.parentBus.emit(event, ...args);
    }

    removeAllListeners(event) {
        if (event) {
            const targets = this.trackedListeners.filter(t => t.event === event);
            for (const t of targets) {
                this.parentBus.off(t.event, t.listener);
            }
            this.trackedListeners = this.trackedListeners.filter(t => t.event !== event);
        } else {
            this.cleanup();
        }
        return this;
    }

    removeTracked(event, listener) {
        const idx = this.trackedListeners.findIndex(t => t.event === event && t.listener === listener);
        if (idx !== -1) {
            this.trackedListeners.splice(idx, 1);
        }
    }

    cleanup() {
        for (const { event, listener } of this.trackedListeners) {
            try {
                this.parentBus.off(event, listener);
            } catch (err) {
                // 안전하게 무시
            }
        }
        this.trackedListeners = [];
    }
}

/**
 * 경로가 지정된 디렉토리 내부인지 검증 (Windows 대소문자 무시 및 심볼릭링크 탈출 방지)
 */
function isPathInsideDir(targetPath, parentDir) {
    try {
        const realTarget = fs.realpathSync(targetPath).toLowerCase();
        const realParent = fs.realpathSync(parentDir).toLowerCase();
        if (realTarget === realParent) return true;
        const rel = path.relative(realParent, realTarget);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
    } catch {
        return false;
    }
}

/**
 * 모듈명 입력값 안전성 검증 및 정규화
 */
function sanitizeTargetNames(targetModules) {
    if (!targetModules || targetModules === 'all') return 'all';
    const targets = Array.isArray(targetModules) ? targetModules : [targetModules];
    return targets
        .filter(t => typeof t === 'string' && t.trim().length > 0)
        .map(t => {
            const clean = t.trim().replace(/\\/g, '/');
            return clean.endsWith('.js') ? path.basename(clean, '.js') : clean;
        })
        .filter(t => /^[a-zA-Z0-9_-]+$/.test(t));
}

class ModuleManager {
    constructor() {
        this.modules = new Map();            // name -> module (현재 메모리에 로드된 활성 모듈)
        this.aliasToModule = new Map();      // alias -> { module, group }
        this.commandGroups = {};             // group -> [aliases]
        this.modulesDir = path.join(__dirname, 'modules');
        this.context = null;
        this.moduleScopedBuses = new Map();  // moduleName -> ScopedEventBus
        this.knownModuleMeta = new Map();    // moduleName -> 캐시된 메타데이터 (언로드된 상태에서도 조회 가능)
        this.loadModules();
    }

    /**
     * modules 디렉토리 및 모든 하위 폴더에서 모듈 파일(.js)들을 재귀적으로 검색
     */
    discoverModuleFiles(dir = this.modulesDir, rootDir = this.modulesDir) {
        if (!fs.existsSync(dir)) return [];
        const entries = [];
        try {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
                // 숨김 파일이나 임시 파일, 테스트 파일, node_modules 스킵
                if (item.name.startsWith('.') || item.name.startsWith('_') || item.name === 'node_modules') continue;

                const fullPath = path.join(dir, item.name);
                const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

                if (item.isDirectory()) {
                    // 하위 폴더 재귀 탐색
                    const subEntries = this.discoverModuleFiles(fullPath, rootDir);
                    entries.push(...subEntries);
                } else if (item.isFile() && item.name.endsWith('.js') && !item.name.endsWith('.test.js') && !item.name.endsWith('.spec.js')) {
                    // index.js 인 경우 부모 폴더명을 모듈명으로, 그 외는 파일명을 모듈명으로
                    let modName = path.basename(item.name, '.js');
                    if (modName === 'index') {
                        const parentDirName = path.basename(dir);
                        if (parentDirName && parentDirName !== 'modules') {
                            modName = parentDirName;
                        }
                    }
                    entries.push({
                        modName,
                        fileName: relPath,
                        fullPath
                    });
                }
            }
        } catch (err) {
            console.warn(`⚠️ [ModuleManager] 파일 탐색 중 에러 (${dir}):`, err.message);
        }
        return entries;
    }

    /**
     * 모듈 디렉토리 내의 모듈 간 의존성 맵 구축 (require 문 및 mod.dependencies 분석)
     */
    getDependencyGraph() {
        const graph = {};
        if (!fs.existsSync(this.modulesDir)) return graph;

        const fileEntries = this.discoverModuleFiles();
        const moduleNames = fileEntries.map(e => e.modName);

        for (const name of moduleNames) {
            graph[name] = { dependencies: new Set(), dependents: new Set() };
        }

        for (const entry of fileEntries) {
            const modName = entry.modName;
            try {
                const content = fs.readFileSync(entry.fullPath, 'utf8');
                // require('./xxx') 또는 require('../xxx') 등 로컬 require 매칭
                const requireRegex = /require\s*\(\s*['"](?:\.\/|\.\.\/)+([^'"]+?)(?:\.js)?['"]\s*\)/g;
                let match;
                while ((match = requireRegex.exec(content)) !== null) {
                    const reqBase = path.basename(match[1], '.js');
                    if (moduleNames.includes(reqBase) && reqBase !== modName) {
                        if (!graph[modName]) graph[modName] = { dependencies: new Set(), dependents: new Set() };
                        if (!graph[reqBase]) graph[reqBase] = { dependencies: new Set(), dependents: new Set() };
                        graph[modName].dependencies.add(reqBase);
                        graph[reqBase].dependents.add(modName);
                    }
                }

                // 모듈 객체에 명시적 dependencies 가 선언된 경우 추가
                const mod = this.modules.get(modName);
                if (mod && Array.isArray(mod.dependencies)) {
                    for (const dep of mod.dependencies) {
                        if (moduleNames.includes(dep) && dep !== modName) {
                            if (!graph[modName]) graph[modName] = { dependencies: new Set(), dependents: new Set() };
                            if (!graph[dep]) graph[dep] = { dependencies: new Set(), dependents: new Set() };
                            graph[modName].dependencies.add(dep);
                            graph[dep].dependents.add(modName);
                        }
                    }
                }
            } catch (err) {
                console.warn(`⚠️ [ModuleManager] 의존성 분석 실패 (${entry.fileName}):`, err.message);
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
        const fileEntries = this.discoverModuleFiles();
        const allModNames = fileEntries.map(e => e.modName);
        const sanitized = sanitizeTargetNames(targetNames);
        if (!sanitized || sanitized === 'all' || sanitized.length === 0) {
            return allModNames;
        }

        const targets = Array.isArray(sanitized) ? sanitized : [sanitized];
        const graph = this.getDependencyGraph();
        const resolved = new Set();
        const queue = [...targets];

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) continue;
            const cleanName = current.endsWith('.js') ? path.basename(current, '.js') : current;
            if (resolved.has(cleanName)) continue;
            if (!allModNames.includes(cleanName)) continue;

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
     * 언로드 시 대상 모듈을 참조하고 있는 하위 피의존 모듈(dependents) 탐색
     */
    resolveUnloadDependencies(targetNames) {
        const sanitized = sanitizeTargetNames(targetNames);
        if (!sanitized || sanitized === 'all') return Array.from(this.modules.keys());

        const graph = this.getDependencyGraph();
        const toUnload = new Set();
        const queue = [...sanitized];

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current || toUnload.has(current)) continue;
            toUnload.add(current);

            const node = graph[current];
            if (node && node.dependents) {
                for (const dep of node.dependents) {
                    if ((this.modules.has(dep) || this.knownModuleMeta.has(dep)) && !toUnload.has(dep)) {
                        queue.push(dep);
                    }
                }
            }
        }

        return Array.from(toUnload);
    }

    /**
     * 웹 대시보드 및 리로드/언로드 모달에서 사용하는 전체 모듈 메타데이터 목록 반환
     * (로드된 모듈은 isLoaded: true, 언로드된 모듈은 isLoaded: false 로 반환)
     */
    getModuleList() {
        if (!fs.existsSync(this.modulesDir)) return [];
        const fileEntries = this.discoverModuleFiles();
        const graph = this.getDependencyGraph();
        const list = [];
        const seenNames = new Set();

        // 모듈 기본 아이콘 매핑
        const defaultIcons = {
            coolcheck: '⏳', date: '📅', dice: '🎲', episode: '🎬',
            future: '⏭️', generator: '🖼️', greeting: '👋', help: '❓',
            menu: '🍱', music: '🎵', poster: '📢', stats: '📊',
            time: '⏰', timetable: '📑', weather: '⛅'
        };

        for (const entry of fileEntries) {
            const mod = this.modules.get(entry.modName) || this.modules.get(entry.fileName);
            const isLoaded = !!mod;
            const modName = (mod && mod.name) ? mod.name : entry.modName;

            if (seenNames.has(modName)) continue;
            seenNames.add(modName);

            // 캐시된 메타데이터 또는 현재 인스턴스로부터 정보 추출
            const cached = this.knownModuleMeta.get(modName) || this.knownModuleMeta.get(entry.modName) || {};
            const isCommand = mod ? (typeof mod.execute === 'function') : (cached.isCommand !== undefined ? cached.isCommand : true);

            const node = graph[modName] || graph[entry.modName] || { dependencies: new Set(), dependents: new Set() };
            const related = Array.from(new Set([
                ...Array.from(node.dependencies),
                ...Array.from(node.dependents)
            ]));

            const title = (mod && mod.web && mod.web.title) || cached.title || modName;
            const icon = (mod && mod.web && mod.web.icon) || cached.icon || defaultIcons[modName] || defaultIcons[entry.modName] || (isCommand ? '⚡' : '⚙️');
            const description = (mod && mod.web && mod.web.description) || (mod && mod.description) || cached.description || (isLoaded ? '독립 모듈' : '현재 언로드된 모듈');
            const category = (mod && mod.web && mod.web.category) || cached.category || (isCommand ? 'Commands' : 'Services');
            const badge = (mod && mod.web && mod.web.badge) || cached.badge || (isCommand ? 'Command' : 'Service');
            const aliases = (mod && mod.aliases) || cached.aliases || [];
            const group = (mod && mod.group) || cached.group || null;
            const groups = (mod && mod.groups) || cached.groups || null;

            list.push({
                name: modName,
                fileName: entry.fileName,
                fullPath: entry.fullPath,
                isLoaded,
                title,
                icon,
                description,
                category,
                badge,
                isCommand,
                aliases,
                group,
                groups,
                dependencies: Array.from(node.dependencies),
                dependents: Array.from(node.dependents),
                related
            });
        }

        return list;
    }

    /**
     * require.cache 무효화 및 부모/자식 간 순환 참조 정리
     */
    invalidateWithDeps(filePath) {
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

        const doInvalidate = (target) => {
            let resolved;
            try { resolved = require.resolve(target); } catch { return; }
            if (invalidated.has(resolved)) return;
            if (coreSingletons.has(resolved)) return;
            if (resolved.includes(nodeModulesStr)) return;

            invalidated.add(resolved);
            const cached = require.cache[resolved];
            if (cached) {
                if (Array.isArray(cached.children)) {
                    for (const child of cached.children) {
                        if (child && child.id) doInvalidate(child.id);
                    }
                    cached.children = [];
                }

                // 부모 모듈 참조 제거하여 GC 수거 가능하도록 처리
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

        doInvalidate(filePath);
    }

    /**
     * 현재 로드된 this.modules 를 바탕으로 aliasToModule 및 commandGroups 맵 재구성
     */
    rebuildAliasAndCommandGroups() {
        const newAliasMap = new Map();
        const newCommandGroups = {};

        for (const [name, mod] of this.modules) {
            if (!mod || typeof mod.execute !== 'function') continue;

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

        this.aliasToModule = newAliasMap;
        this.commandGroups = newCommandGroups;

        if (this.context && typeof this.context.setCommandGroupResolver === 'function') {
            this.context.setCommandGroupResolver((cmd) => {
                const entry = this.aliasToModule.get(cmd);
                return entry ? entry.group : cmd;
            }, this.commandGroups);
        }
    }

    /**
     * modules 디렉토리 및 하위 폴더 내의 모듈 동적 로드 (전체 또는 지정된 모듈 리스트)
     * @param {string[]|string|null} targetModules 리로드할 모듈명 배열 (생략 시 전체 리로드)
     */
    loadModules(targetModules = null) {
        // 리로드 공백(destroy→init 사이) 동안 chat 이벤트 손실 방지용 임시 버퍼
        const chatBuffer = [];
        const chatBufferListener = (msg) => chatBuffer.push(msg);
        eventBus.on('chat', chatBufferListener);

        try {
            if (!fs.existsSync(this.modulesDir)) {
                console.warn(`⚠️ [ModuleManager] 모듈 디렉토리가 없습니다: ${this.modulesDir}`);
                return { success: false, error: 'Directory not found' };
            }

            const fileEntries = this.discoverModuleFiles();
            const allModNames = fileEntries.map(e => e.modName);
            const sanitized = sanitizeTargetNames(targetModules);
            const isFullReload = !sanitized || sanitized === 'all' || (Array.isArray(sanitized) && sanitized.length === 0) || (Array.isArray(sanitized) && sanitized.length >= allModNames.length);

            // 의존성 분석을 거친 실제 리로드/로드 대상 모듈명 목록
            const modulesToReload = isFullReload
                ? allModNames
                : this.resolveDependencies(sanitized);

            const reloadSet = new Set(modulesToReload);

            // 1단계: 리로드 대상 모듈 정리 (destroy/stop 훅 실행 및 ScopedEventBus 클린업)
            if (this.modules && this.modules.size > 0) {
                const cleanedMods = new Set();
                for (const [name, mod] of this.modules) {
                    if (!mod || cleanedMods.has(mod)) continue;
                    if (reloadSet.has(name) || (mod.name && reloadSet.has(mod.name))) {
                        cleanedMods.add(mod);
                        try {
                            if (typeof mod.destroy === 'function') mod.destroy();
                            else if (typeof mod.stop === 'function') mod.stop();
                        } catch (err) {
                            console.warn(`⚠️ [ModuleManager] 모듈 정리 중 에러 (${name}):`, err.message);
                        }

                        // ScopedEventBus 등록 리스너 일괄 해제 (이벤트 누수 방지)
                        const scopedBus = this.moduleScopedBuses.get(mod.name) || this.moduleScopedBuses.get(name);
                        if (scopedBus) {
                            scopedBus.cleanup();
                            this.moduleScopedBuses.delete(mod.name);
                            this.moduleScopedBuses.delete(name);
                        }
                    }
                }
            }

            // 2단계: 대상 모듈 파일 및 의존성 캐시 삭제
            for (const entry of fileEntries) {
                if (reloadSet.has(entry.modName)) {
                    this.invalidateWithDeps(entry.fullPath);
                }
            }

            if (isFullReload) {
                this.invalidateWithDeps(path.join(__dirname, 'command-context.js'));
                this.context = require('./command-context.js');
            } else if (!this.context) {
                this.context = require('./command-context.js');
            }

            // 3단계: 모듈 재구성
            // 부분 리로드 시 기존 모듈 복사 후 대상만 fresh require로 덮어씀
            const newModules = isFullReload ? new Map() : new Map(this.modules);

            for (const entry of fileEntries) {
                const modName = entry.modName;
                if (!reloadSet.has(modName) && !isFullReload) {
                    // 리로드 대상이 아닌 모듈은 기존 인스턴스 유지
                    continue;
                }

                // 보안: 모듈 파일 경로가 modules 디렉토리 내부인지 검증
                if (!isPathInsideDir(entry.fullPath, this.modulesDir)) {
                    console.warn(`⚠️ [ModuleManager] 디렉토리 외부 경로 스킵: ${entry.fileName}`);
                    continue;
                }

                try {
                    const mod = require(entry.fullPath);
                    if (!mod || !mod.name) {
                        console.warn(`⚠️ [ModuleManager] name 속성이 없는 모듈 스킵: ${entry.fileName}`);
                        continue;
                    }

                    mod.__fileName = entry.fileName;
                    mod.__fullPath = entry.fullPath;

                    // ScopedEventBus 주입 (메모리 누수 방지 추적기)
                    let scopedBus = this.moduleScopedBuses.get(mod.name);
                    if (scopedBus) {
                        scopedBus.cleanup();
                    }
                    scopedBus = new ScopedEventBus(eventBus, mod.name);
                    this.moduleScopedBuses.set(mod.name, scopedBus);

                    newModules.set(mod.name, mod);
                    if (modName !== mod.name && !newModules.has(modName)) {
                        newModules.set(modName, mod);
                    }

                    // 메타데이터 캐싱
                    this.knownModuleMeta.set(mod.name, {
                        title: (mod.web && mod.web.title) || mod.name,
                        icon: (mod.web && mod.web.icon) || null,
                        description: (mod.web && mod.web.description) || mod.description || '',
                        category: (mod.web && mod.web.category) || null,
                        badge: (mod.web && mod.web.badge) || null,
                        isCommand: typeof mod.execute === 'function',
                        aliases: mod.aliases || [],
                        group: mod.group || null,
                        groups: mod.groups || null,
                        dependencies: mod.dependencies || []
                    });

                    try {
                        if (typeof mod.init === 'function') {
                            mod.init({ eventBus: scopedBus, moduleManager: this });
                        } else if (typeof mod.start === 'function') {
                            mod.start({ eventBus: scopedBus, moduleManager: this });
                        }
                    } catch (initErr) {
                        console.error(`❌ [ModuleManager] 모듈 초기화 에러 (${mod.name}):`, initErr.message);
                    }

                } catch (err) {
                    console.error(`❌ [ModuleManager] 개별 모듈 로드 실패 (${entry.fileName}):`, err.message);
                }
            }

            this.modules = newModules;

            // 4단계: 명령어 별칭 및 그룹 맵 전체 재구성
            this.rebuildAliasAndCommandGroups();

            const reloadedCount = modulesToReload.length;
            if (isFullReload) {
                console.log(`✅ [ModuleManager] 전체 ${this.modules.size}개 모듈 로드 완료 (${this.aliasToModule.size}개 명령어 등록)`);
            } else {
                console.log(`✅ [ModuleManager] ${reloadedCount}개 모듈 핫리로드 완료 [${modulesToReload.join(', ')}]`);
            }

            return {
                success: true,
                reloaded: modulesToReload,
                total: this.modules.size,
                isFullReload
            };
        } finally {
            // 리로드 공백 동안 버퍼에 쌓인 chat 이벤트 플러시 후 버퍼 리스너 제거 (무조건 실행되어 누수 방지)
            eventBus.off('chat', chatBufferListener);
            if (chatBuffer.length > 0) {
                console.log(`📦 [ModuleManager] 리로드 공백 중 버퍼된 chat ${chatBuffer.length}건 재처리`);
                const msgs = [...chatBuffer];
                chatBuffer.length = 0;
                setImmediate(() => {
                    for (const msg of msgs) {
                        eventBus.emit('chat', msg);
                    }
                });
            }
        }
    }

    /**
     * 지정된 모듈 언로드 (실행 중단, 이벤트 리스너 해제, 명령어 매핑 제거, require.cache 삭제)
     * @param {string[]|string} targetModules 언로드할 모듈명 (배열 또는 단일 문자열)
     */
    unload(targetModules) {
        const sanitized = sanitizeTargetNames(targetModules);
        if (!sanitized || sanitized === 'all' || sanitized.length === 0) {
            return this.unloadAll();
        }

        console.log(`⏹️ [ModuleManager] 모듈 언로드 시작... (${JSON.stringify(sanitized)})`);

        // 의존성 분석: 언로드 대상에 의존하는 하위 모듈(dependents)도 함께 언로드
        const modulesToUnload = this.resolveUnloadDependencies(sanitized);
        const unloadSet = new Set(modulesToUnload);
        const unloadedList = [];
        const cleanedMods = new Set();

        // 1단계: 모듈 인스턴스 정리 (destroy/stop 훅 및 ScopedEventBus 클린업)
        for (const [name, mod] of this.modules) {
            if (!mod || cleanedMods.has(mod)) continue;
            if (unloadSet.has(name) || (mod.name && unloadSet.has(mod.name))) {
                cleanedMods.add(mod);
                const canonicalName = mod.name || name;
                unloadedList.push(canonicalName);

                try {
                    if (typeof mod.destroy === 'function') mod.destroy();
                    else if (typeof mod.stop === 'function') mod.stop();
                } catch (err) {
                    console.warn(`⚠️ [ModuleManager] 모듈 언로드 정리 중 에러 (${name}):`, err.message);
                }

                const scopedBus = this.moduleScopedBuses.get(mod.name) || this.moduleScopedBuses.get(name);
                if (scopedBus) {
                    scopedBus.cleanup();
                    this.moduleScopedBuses.delete(mod.name);
                    this.moduleScopedBuses.delete(name);
                }
            }
        }

        // 2단계: this.modules 에서 제거
        for (const target of unloadSet) {
            this.modules.delete(target);
        }
        for (const [name, mod] of this.modules) {
            if (mod && unloadSet.has(mod.name)) {
                this.modules.delete(name);
            }
        }

        // 3단계: 대상 모듈 파일 및 의존성 캐시 삭제
        const fileEntries = this.discoverModuleFiles();
        for (const entry of fileEntries) {
            if (unloadSet.has(entry.modName)) {
                this.invalidateWithDeps(entry.fullPath);
            }
        }

        // 4단계: aliasToModule 및 commandGroups 재구성
        this.rebuildAliasAndCommandGroups();

        console.log(`✅ [ModuleManager] ${unloadedList.length}개 모듈 언로드 완료 [${unloadedList.join(', ')}], 활성 모듈: ${this.modules.size}개`);

        return {
            success: true,
            unloaded: unloadedList,
            total: this.modules.size
        };
    }

    /**
     * 모든 모듈 언로드
     */
    unloadAll() {
        console.log('⏹️ [ModuleManager] 전체 모듈 언로드 시작...');
        const allNames = Array.from(new Set([...this.modules.keys()]));
        return this.unload(allNames);
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
            this.rebuildAliasAndCommandGroups();
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
        const cleanedMods = new Set();
        for (const [name, mod] of this.modules) {
            if (!mod || cleanedMods.has(mod)) continue;
            cleanedMods.add(mod);
            try {
                if (typeof mod.destroy === 'function') mod.destroy();
                else if (typeof mod.stop === 'function') mod.stop();
            } catch (err) {
                console.warn(`⚠️ [ModuleManager] 모듈 종료 중 에러 (${name}):`, err.message);
            }
        }
        for (const [name, scopedBus] of this.moduleScopedBuses) {
            try { scopedBus.cleanup(); } catch { }
        }
        this.moduleScopedBuses.clear();
        this.modules.clear();
        this.aliasToModule.clear();
        this.commandGroups = {};
    }

    /**
     * 웹 대시보드에서 열람 가능한 웹 모듈 목록 반환
     */
    getWebModules() {
        const list = [];
        const seenIds = new Set();

        for (const [name, mod] of this.modules) {
            if (!mod || !mod.web) continue;
            const id = mod.web.id || mod.name;
            if (seenIds.has(id)) continue;
            seenIds.add(id);

            list.push({
                id,
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
        return list;
    }

    /**
     * 웹소켓 클라이언트로부터 들어온 웹 액션을 모듈의 web.actions 로 동적 디스패치
     * (보안: action 이름 검증 및 프로토타입 오염 방지)
     */
    async handleWebAction(action, payload) {
        if (typeof action !== 'string' || !action || !/^[a-zA-Z0-9_-]+$/.test(action)) {
            return { handled: false, error: 'Invalid action name' };
        }

        for (const [name, mod] of this.modules) {
            if (mod && mod.web && mod.web.actions && Object.prototype.hasOwnProperty.call(mod.web.actions, action) && typeof mod.web.actions[action] === 'function') {
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
        if (!ctx) return null;

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
        return this.context ? this.context.getCooldownState() : null;
    }
}

const moduleManager = new ModuleManager();

module.exports = {
    moduleManager,
    commandManager: moduleManager,
    handleCommand: (type, text, displayName, _input) => moduleManager.handleCommand(type, text, displayName, _input),
    reloadCommands: (targets) => moduleManager.reload(targets),
    reloadModules: (targets) => moduleManager.reload(targets),
    unloadCommands: (targets) => moduleManager.unload(targets),
    unloadModules: (targets) => moduleManager.unload(targets),
    unloadAll: () => moduleManager.unloadAll(),
    shutdown: () => moduleManager.shutdown(),
    getCooldownState: () => moduleManager.getCooldownState(),
    getWebModules: () => moduleManager.getWebModules(),
    getModuleList: () => moduleManager.getModuleList(),
    getDependencyGraph: () => moduleManager.getDependencyGraph(),
    resolveDependencies: (targets) => moduleManager.resolveDependencies(targets),
    resolveUnloadDependencies: (targets) => moduleManager.resolveUnloadDependencies(targets),
    handleWebAction: (action, payload) => moduleManager.handleWebAction(action, payload),
    get context() { return moduleManager.context; }
};
