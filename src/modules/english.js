// ─── english.js ──────────────────────────────────────────────────────────────
// 영어사전 및 영한/한영 양방향 단어 번역 모듈
// 사용법:
//   - !영어 [단어/문장]  → 영어 입력 시 한글 뜻, 한글 입력 시 영어 번역 출력
//   - !영어 (인자 없음)  → ⚠️ 한글 또는 영어를 입력하세요. 경고 출력
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');
const { maskProfanity } = require('../func.js');

/**
 * HTML에서 og:description 추출
 */
function extractOgDescription(html) {
    if (!html) return null;
    const match = html.match(/<meta\s+(?:[^>]*?\s+)?property=["']og:description["']\s+content=["']([^"']+)["']/i)
        || html.match(/<meta\s+(?:[^>]*?\s+)?content=["']([^"']+)["']\s+property=["']og:description["']/i);
    const desc = match ? match[1].trim() : null;
    if (desc && !desc.startsWith('Daum') && !desc.includes('검색결과') && !desc.includes('사전')) {
        return desc;
    }
    return null;
}

/**
 * 다음(Daum) 어학사전 조회 (영한 / 한영 자동 감지)
 */
async function fetchDaumDictionary(query) {
    try {
        const searchUrl = `https://dic.daum.net/search.do?q=${encodeURIComponent(query)}&dic=eng`;
        const res = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(3500)
        });
        const html = await res.text();

        // 1. 초기 페이지의 og:description 우선 확인
        const initialOg = extractOgDescription(html);
        if (initialOg) {
            return initialOg;
        }

        // 2. 단어 상세 페이지로 리다이렉트 메타태그가 있는 경우 추적
        const refreshMatch = html.match(/URL=([^\s"'<>]+)/i);
        let finalHtml = html;
        if (refreshMatch) {
            // SSRF 방지: dic.daum.net 도메인으로만 리다이렉트 허용
            let redirectUrl = refreshMatch[1];
            if (!redirectUrl.startsWith('http')) {
                redirectUrl = 'https://dic.daum.net' + redirectUrl;
            }
            try {
                const urlObj = new URL(redirectUrl);
                if (urlObj.hostname !== 'dic.daum.net') {
                    console.warn(`[english] 안전하지 않은 리다이렉트 URL 차단: ${urlObj.hostname}`);
                    return null;
                }
                redirectUrl = urlObj.toString();
            } catch {
                return null;
            }
            const res2 = await fetch(redirectUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                signal: AbortSignal.timeout(3500)
            });
            finalHtml = await res2.text();

            const redirectOg = extractOgDescription(finalHtml);
            if (redirectOg) {
                return redirectOg;
            }
        }

        // 3. txt_mean 또는 txt_search 클래스에서 뜻 추출
        const txtMeans = [...finalHtml.matchAll(/class="txt_mean[^"]*">([\s\S]*?)<\/(?:span|div|a)>/gi)]
            .map(m => m[1].replace(/<[^>]+>/g, '').trim())
            .filter(Boolean);

        const txtSearch = [...finalHtml.matchAll(/class="txt_search">([\s\S]*?)<\/span>/gi)]
            .map(m => m[1].replace(/<[^>]+>/g, '').trim())
            .filter(Boolean);

        const combined = [...new Set([...txtMeans, ...txtSearch])]
            .filter(t => t.toLowerCase() !== query.toLowerCase() && !t.includes('http') && t.length > 0)
            .slice(0, 4);

        if (combined.length > 0) {
            return combined.join(', ');
        }
    } catch (err) {
        console.warn(`⚠️ [english] 다음 사전 조회 실패 (${query}):`, err.message);
    }
    return null;
}

/**
 * MyMemory 번역 API 폴백
 */
async function fetchMyMemoryTranslation(query, isKorean) {
    try {
        const langpair = isKorean ? 'ko|en' : 'en|ko';
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=${langpair}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const mainTrans = data?.responseData?.translatedText;
        if (mainTrans && mainTrans.trim() && mainTrans.toLowerCase() !== query.toLowerCase()) {
            const altMatches = (data.matches || [])
                .map(m => m.translation?.trim())
                .filter(t => t && t.toLowerCase() !== query.toLowerCase() && t !== mainTrans)
                .slice(0, 2);

            const all = [mainTrans, ...new Set(altMatches)];
            return all.join(', ');
        }
    } catch (err) {
        console.warn(`⚠️ [english] MyMemory 번역 API 실패 (${query}):`, err.message);
    }
    return null;
}

/**
 * 통합 단어 사전 검색 (다음 사전 우선, MyMemory 폴백)
 */
async function lookupWord(query) {
    const trimmed = query.trim();
    const hasKorean = /[가-힣]/.test(trimmed);

    // 1단계: 다음 사전
    const daumResult = await fetchDaumDictionary(trimmed);
    if (daumResult) {
        return daumResult;
    }

    // 2단계: MyMemory 번역
    const mmResult = await fetchMyMemoryTranslation(trimmed, hasKorean);
    if (mmResult) {
        return mmResult;
    }

    return null;
}

module.exports = {
    name: 'english',
    group: 'english',
    icon: '📖',
    aliases: ['!영어', '!영한', '!한영', '!단어', '!dict', '!dictionary'],
    description: '영어 및 한국어 단어 양방향 사전 검색',

    web: {
        title: '영어 사전',
        icon: '📖',
        description: '영한/한영 양방향 실시간 단어 검색 및 뜻 조회 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, args, _input, ctx }) {
        const rawArg = (args && args.length > 0 && typeof args[0] === 'string')
            ? args.join(' ').trim()
            : '';

        // 1. 단어 입력을 안 한 경우: 경고 출력
        if (!rawArg) {
            const warnText = (msg.english && msg.english.missing_word)
                ? msg.english.missing_word
                : '⚠️ 한글 또는 영어를 입력하세요. (예: !영어 immune, !영어 산업화)';
            return ctx.returnWarning(warnText, cmd, _input);
        }

        // 입력값 안전 제한 (60자 초과 시 차단)
        if (rawArg.length > 60) {
            return ctx.returnWarning('⚠️ 검색어가 너무 깁니다. (60자 이내로 입력해 주세요)', cmd, _input);
        }

        ctx.setCooldown(cmd, 0, _input);
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        const safeQuery = maskProfanity(rawArg);

        try {
            const meaning = await lookupWord(safeQuery);

            if (!meaning) {
                if (msg.english && msg.english.not_found) {
                    return msg.english.not_found(safeQuery, cooldownMsg);
                }
                return `⚠️ "${safeQuery}"에 대한 검색 결과를 찾을 수 없습니다. ${cooldownMsg}`;
            }

            if (msg.english && msg.english.result) {
                return msg.english.result(safeQuery, meaning, cooldownMsg);
            }
            return `📖 [영어사전] ${safeQuery} → ${meaning} ${cooldownMsg}`;
        } catch (err) {
            console.error('❌ [english] 사전 검색 중 에러:', err.message);
            if (msg.english && msg.english.fetch_error) {
                return msg.english.fetch_error(cooldownMsg);
            }
            return `⚠️ 사전 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`;
        }
    }
};
