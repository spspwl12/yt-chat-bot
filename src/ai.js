const http = require('http');
const https = require('https');

/**
 * 외부 AI API에 GET 요청을 보내고 응답 JSON에서 지정된 경로의 문자열을 추출하여
 * 에피소드 번호를 파싱합니다.
 * @param {string} query - 사용자가 입력한 검색 문자열
 * @param {object} aiCfg - config-youtube.js 의 ai 설정 객체
 * @param {number} startEp - 유효한 시작 에피소드 번호
 * @param {number} endEp - 유효한 끝 에피소드 번호
 * @returns {Promise<number|null>} 파싱된 에피소드 번호 또는 실패 시 null
 */
async function searchEpisodeByAI(query, aiCfg, startEp, endEp) {
    if (!aiCfg || !aiCfg.enable || !aiCfg.url)
        return null;

    if (aiCfg.url.length <= 0)
        return null;

    const aiResponse = await new Promise((resolve) => {
        const timeoutMs = aiCfg.timeout_ms || 10000;

        // query_template이 있으면 사용자 입력을 템플릿으로 감싸기
        let finalQuery = query;
        if (aiCfg.query_template && aiCfg.query_template.length > 0) {
            finalQuery = aiCfg.query_template.replace(/\{query\}/g, query);
        }

        // URL의 {query} 플레이스홀더를 최종 쿼리로 치환
        const requestUrl = aiCfg.url.replace(/\{query\}/g, encodeURIComponent(finalQuery));

        let url;
        try {
            url = new URL(requestUrl);
        } catch (e) {
            console.warn('⚠️ AI API URL 파싱 실패:', e.message);
            resolve(null);
            return;
        }

        // http/https 자동 선택
        const client = url.protocol === 'https:' ? https : http;

        const req = client.get(requestUrl, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                clearTimeout(timer);
                try {
                    const json = JSON.parse(body);
                    // response_path 설정에 따라 JSON 객체에서 실제 문자열 추출
                    const text = resolveJsonPath(json, aiCfg.response_path);
                    resolve(text || null);
                } catch (e) {
                    console.warn('⚠️ AI 응답 파싱 실패:', e.message);
                    resolve(null);
                }
            });
        });

        const timer = setTimeout(() => {
            req.destroy();
            console.warn('⚠️ AI API 타임아웃');
            resolve(null);
        }, timeoutMs);

        req.on('error', (err) => {
            clearTimeout(timer);
            console.warn('⚠️ AI API 에러:', err.message);
            resolve(null);
        });
    });

    if (!aiResponse) return null;

    // 응답 문자열을 String으로 변환
    const responseStr = String(aiResponse);

    // 응답에서 숫자(화수) 추출 — "64화" "64" "제64화" 등 다양한 패턴 지원
    const match = responseStr.match(/(\d+)(화|회|편)/);
    if (!match) return null;

    const episodeNum = parseInt(match[1], 10);
    if (isNaN(episodeNum) || episodeNum < startEp || episodeNum > endEp) {
        return null;
    }

    return episodeNum;
}

/**
 * 점(.)으로 구분된 경로 문자열을 따라 JSON 객체를 탐색하여 값을 반환합니다.
 * 예: resolveJsonPath({a: {b: {c: "hello"}}}, "a.b.c") → "hello"
 * @param {object} obj - 탐색할 JSON 객체
 * @param {string} path - 점(.)으로 구분된 경로 문자열 (예: "result.text", "data.answer")
 * @returns {*} 경로에 해당하는 값 또는 undefined
 */
function resolveJsonPath(obj, path) {
    if (!path || !obj) return obj;
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
        if (current == null || typeof current !== 'object') return undefined;
        current = current[key];
    }
    return current;
}

module.exports = {
    searchEpisodeByAI
};
