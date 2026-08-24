const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ─── 파일 경로 정의 ─────────────────────────────────────────
const PATHS = {
    youtube: path.join(__dirname, '../data/config-youtube.js'),
    messages: path.join(__dirname, '../data/config-messages.js'),
    search: path.join(__dirname, '../data/config-search.js'),
    profanity: path.join(__dirname, '../data/profanity-list.js'),
    videoInfo: path.join(__dirname, '../data/video-info.json'),
    videoSub: path.join(__dirname, '../data/video-sub.json'),
    videoMusic: path.join(__dirname, '../data/video-music.json'),
    videoMetadata: path.join(__dirname, '../data/video-metadata.json'),
};

// ─── 설정 및 데이터 메모리 인스턴스 (In-Place 갱신용) ─────────────
const cfgYoutube = require(PATHS.youtube);
const cfgMessages = require(PATHS.messages);
const cfgSearch = require(PATHS.search);
const profanitySet = require(PATHS.profanity);
let profanityVersion = 1;

/**
 * JS 코드 문법 및 module.exports 유효성 검증
 */
function validateJS(code, filename = 'config.js') {
    const script = new vm.Script(code, { filename });
    const sandbox = { module: { exports: {} }, exports: {}, Set };
    vm.createContext(sandbox);
    script.runInContext(sandbox);
    if (!sandbox.module.exports) {
        throw new Error('module.exports 가 정의되지 않았습니다.');
    }
    return sandbox.module.exports;
}

/**
 * require.cache 갱신 헬퍼
 */
function updateRequireCache(filePath, targetExport) {
    try {
        const resolved = require.resolve(filePath);
        if (require.cache[resolved]) {
            require.cache[resolved].exports = targetExport;
        }
    } catch { }
}

// ─── 개별 리로드 로직 ────────────────────────────────────────

function reloadYoutubeConfig() {
    try {
        const resolved = require.resolve(PATHS.youtube);
        delete require.cache[resolved];
        const fresh = require(PATHS.youtube);

        for (const k of Object.keys(cfgYoutube)) {
            delete cfgYoutube[k];
        }
        Object.assign(cfgYoutube, fresh);
        updateRequireCache(PATHS.youtube, cfgYoutube);

        console.log('[ConfigManager] config-youtube.js 리로드 완료');
        return true;
    } catch (e) {
        console.error('[ConfigManager] config-youtube.js 리로드 실패:', e.message);
        throw e;
    }
}

function reloadMessagesConfig() {
    try {
        const resolved = require.resolve(PATHS.messages);
        delete require.cache[resolved];
        const fresh = require(PATHS.messages);

        for (const k of Object.keys(cfgMessages)) {
            delete cfgMessages[k];
        }
        Object.assign(cfgMessages, fresh);
        updateRequireCache(PATHS.messages, cfgMessages);

        console.log('[ConfigManager] config-messages.js 리로드 완료');
        return true;
    } catch (e) {
        console.error('[ConfigManager] config-messages.js 리로드 실패:', e.message);
        throw e;
    }
}

function reloadSearchConfig() {
    try {
        const resolved = require.resolve(PATHS.search);
        delete require.cache[resolved];
        const fresh = require(PATHS.search);

        for (const k of Object.keys(cfgSearch)) {
            delete cfgSearch[k];
        }
        Object.assign(cfgSearch, fresh);
        updateRequireCache(PATHS.search, cfgSearch);

        console.log('[ConfigManager] config-search.js 리로드 완료');
        try {
            const eventBus = require('./event-bus.js');
            eventBus.emit('search_config_reloaded', cfgSearch);
        } catch (_) { }
        return true;
    } catch (e) {
        console.error('[ConfigManager] config-search.js 리로드 실패:', e.message);
        throw e;
    }
}

function reloadProfanityList() {
    try {
        const resolved = require.resolve(PATHS.profanity);
        delete require.cache[resolved];
        const fresh = require(PATHS.profanity);

        profanitySet.clear();
        for (const word of fresh) {
            profanitySet.add(word);
        }
        profanityVersion++;
        updateRequireCache(PATHS.profanity, profanitySet);

        console.log(`[ConfigManager] profanity-list.js 리로드 완료 (${profanitySet.size}개 단어)`);
        return true;
    } catch (e) {
        console.error('[ConfigManager] profanity-list.js 리로드 실패:', e.message);
        throw e;
    }
}

function reloadVideoInfo() {
    try {
        const search_lib = require('./video-matcher/search.js');
        const success = search_lib.reloadVideoInfo();
        return success;
    } catch (e) {
        console.error('[ConfigManager] video-info.json 리로드 실패:', e.message);
        throw e;
    }
}

function reloadVideoSub() {
    try {
        const subManager = require('./sub-manager.js');
        const success = subManager.reloadVideoSub();
        return success;
    } catch (e) {
        console.error('[ConfigManager] video-sub.json 리로드 실패:', e.message);
        throw e;
    }
}

function reloadCommands() {
    try {
        const { reloadModules, reloadCommands: reloadCmds } = require('./module-manager.js');
        if (reloadModules) {
            return reloadModules();
        }
        if (reloadCmds) {
            return reloadCmds();
        }
        return true;
    } catch (e) {
        console.error('[ConfigManager] 명령어 리로드 실패:', e.message);
        return false;
    }
}

/**
 * 모든 설정 및 데이터 파일 일괄 리로드
 */
function reloadAll() {
    reloadYoutubeConfig();
    reloadMessagesConfig();
    reloadSearchConfig();
    reloadProfanityList();
    reloadVideoInfo();
    reloadVideoSub();
    reloadCommands();
    return true;
}

/**
 * 설정/데이터 파일 검증 후 저장 및 실시간 핫리로드 수행
 * @param {'youtube'|'messages'|'search'|'profanity'|'videoInfo'|'videoSub'|'videoMusic'|'videoMetadata'} target 
 * @param {string} content 
 */
function validateAndSaveConfig(target, content) {
    const filePath = PATHS[target];
    if (!filePath) {
        throw new Error(`알 수 없는 대상입니다: ${target}`);
    }

    const cleanContent = (content || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();

    // 1. 형식별 사전 검증
    if (filePath.endsWith('.js')) {
        validateJS(cleanContent, path.basename(filePath));
    } else if (filePath.endsWith('.json')) {
        JSON.parse(cleanContent);
    }

    // 2. 파일 저장
    fs.writeFileSync(filePath, cleanContent, 'utf8');

    // 3. 해당 타겟 리로드
    switch (target) {
        case 'youtube':
            reloadYoutubeConfig();
            break;
        case 'messages':
            reloadMessagesConfig();
            reloadCommands();
            break;
        case 'search':
            reloadSearchConfig();
            break;
        case 'profanity':
            reloadProfanityList();
            reloadCommands();
            break;
        case 'videoInfo':
            reloadVideoInfo();
            reloadCommands();
            break;
        case 'videoSub':
            reloadVideoSub();
            reloadCommands();
            break;
        case 'videoMusic':
        case 'videoMetadata':
            // 명령어 모듈들이 직접 require 하므로 명령어 리로드로 즉시 재적용
            reloadCommands();
            break;
    }

    return true;
}

module.exports = {
    // 경로
    PATHS,

    // 설정 객체 및 데이터 인스턴스
    cfgYoutube,
    cfgMessages,
    cfgSearch,
    profanitySet,
    getProfanityVersion: () => profanityVersion,

    // 단축 별칭
    cfg: cfgYoutube,
    msg: cfgMessages,
    schCfg: cfgSearch,

    // 리로드 함수
    reloadYoutubeConfig,
    reloadMessagesConfig,
    reloadMessages: reloadMessagesConfig, // alias
    reloadSearchConfig,
    reloadProfanityList,
    reloadVideoInfo,
    reloadVideoSub,
    reloadCommands,
    reloadAll,

    // 검증 및 저장
    validateJS,
    validateAndSaveConfig
};

