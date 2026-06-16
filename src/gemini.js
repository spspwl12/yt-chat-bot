const https = require('https');

/**
 * Gemini AI에 에피소드 질의를 보내고 응답에서 파싱된 화수(숫자)를 반환합니다.
 * @param {string} query - 사용자가 입력한 검색 문자열 (에피소드 내용 등)
 * @param {object} geminiCfg - config-youtube.js 의 gemini 설정 객체
 * @param {number} startEp - 유효한 시작 에피소드 번호
 * @param {number} endEp - 유효한 끝 에피소드 번호
 * @returns {Promise<number|null>} 파싱된 에피소드 번호 또는 실패 시 null
 */
async function searchEpisodeByGemini(query, geminiCfg, startEp, endEp) {
    if (!geminiCfg || !geminiCfg.enable || !geminiCfg.api_key || !geminiCfg.query_template)
        return null;

    if (geminiCfg.api_key.length <= 0)
        return null;

    if (geminiCfg.query_template.length <= 0)
        return null;

    const aiResponse = await new Promise((resolve) => {
        const model = geminiCfg.model || 'gemini-2.5-flash';
        const apiKey = geminiCfg.api_key;
        const timeoutMs = geminiCfg.timeout_ms || 10000;

        // 프롬프트 인젝션 방지 1: 악의적일 수 있는 지시 제어 단어 필터링
        const sanitizedQuery = query.replace(/(프롬프트|ignore|prompt|instruction|system|role|forget|clear|reset)/gi, '');

        // config의 query_template에서 {query}를 사용자 입력으로 치환
        const template = geminiCfg.query_template;

        // 프롬프트 인젝션 방지 2: 쿼리를 따옴표로 감싸고, 쿼리 내부의 명령을 절대 따르지 말라는 방어적 문구 추가
        const prompt = template.replace(/\{query\}/g, `"${sanitizedQuery}"`);

        const payload = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        });

        const url = new URL(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
        );

        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                clearTimeout(timer);
                try {
                    const json = JSON.parse(body);
                    console.log(body);
                    const text = json.candidates
                        && json.candidates[0]
                        && json.candidates[0].content
                        && json.candidates[0].content.parts
                        && json.candidates[0].content.parts[0]
                        && json.candidates[0].content.parts[0].text;
                    resolve(text || null);
                } catch (e) {
                    console.warn('⚠️ Gemini 응답 파싱 실패:', e.message);
                    resolve(null);
                }
            });
        });

        const timer = setTimeout(() => {
            req.destroy();
            console.warn('⚠️ Gemini API 타임아웃');
            resolve(null);
        }, timeoutMs);

        req.on('error', (err) => {
            clearTimeout(timer);
            console.warn('⚠️ Gemini API 에러:', err.message);
            resolve(null);
        });

        req.write(payload);
        req.end();
    });

    if (!aiResponse) return null;

    // 응답에서 숫자(화수) 추출 — "64화" "64" "제64화" 등 다양한 패턴 지원
    const match = aiResponse.match(/(\d+)/);
    if (!match) return null;

    const episodeNum = parseInt(match[1], 10);
    if (isNaN(episodeNum) || episodeNum < startEp || episodeNum > endEp) {
        return null;
    }

    return episodeNum;
}

module.exports = {
    searchEpisodeByGemini
};
