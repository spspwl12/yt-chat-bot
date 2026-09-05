// ─── searchrank.js ────────────────────────────────────────────────────────────
// 실시간 검색순위 1위~10위 조회 모듈
// 사용법: !실검, !실시간검색어, !검색순위, !실시간, !실시간순위
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');
const { maskProfanity } = require('../func.js');

/**
 * 1단계: 구글 트렌드 실시간 트렌딩 페이지 파싱
 */
async function fetchGoogleTrends() {
    const res = await fetch('https://trends.google.co.kr/trending?geo=KR&hl=ko', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // ReDoS 방지: 응답이 지나치게 크면 정규식 평가를 실행하지 않음 (2MB 제한)
    if (html.length > 2_000_000) {
        throw new Error('구글 트렌드 응답이 너무 큽니다.');
    }

    // 패턴 A: AF_initDataCallback ds:0 데이터셋 파싱
    const scriptMatches = [...html.matchAll(/AF_initDataCallback\s*\(\s*({[\s\S]*?})\s*\)\s*;/g)];
    for (const sm of scriptMatches) {
        const raw = sm[1];
        if (raw.includes('ds:0')) {
            const dataMatch = raw.match(/data:\s*(\[[\s\S]*?\])\s*,\s*sideChannel/);
            if (dataMatch) {
                const data = JSON.parse(dataMatch[1]);
                if (data && Array.isArray(data[1]) && data[1].length > 0) {
                    return data[1].slice(0, 10).map((item, idx) => ({
                        rank: idx + 1,
                        keyword: (item[0] || '').trim()
                    })).filter(x => x.keyword.length > 0);
                }
            }
        }
    }

    // 패턴 B: HTML 내의 트렌드 항목 배열 패턴 탐색
    const arrayMatches = [...html.matchAll(/\[\[\s*"([^"]+)"\s*,\s*null\s*,\s*"KR"/g)];
    if (arrayMatches.length > 0) {
        return arrayMatches.slice(0, 10).map((m, idx) => ({
            rank: idx + 1,
            keyword: (m[1] || '').trim()
        })).filter(x => x.keyword.length > 0);
    }

    throw new Error('구글 트렌드 실시간 데이터 추출 실패');
}

/**
 * 2단계: signal.bz 실시간 검색어 API (폴백)
 */
async function fetchSignalBz() {
    const res = await fetch('https://api.signal.bz/news/realtime', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && Array.isArray(data.top10) && data.top10.length > 0) {
        return data.top10.slice(0, 10).map((item, idx) => ({
            rank: item.rank || (idx + 1),
            keyword: (item.keyword || '').trim()
        })).filter(x => x.keyword.length > 0);
    }
    throw new Error('signal.bz top10 응답 없음');
}

/**
 * 실시간 검색어 1~10위 조회 (캐시 없이 매회 실시간 조회)
 */
async function getRealtimeRankings() {
    // 1단계: 구글 트렌드 (실시간 화면 데이터)
    try {
        const list = await fetchGoogleTrends();
        if (list && list.length >= 5) {
            return list;
        }
    } catch (err) {
        console.warn('⚠️ [searchrank] 1단계 구글 트렌드 조회 실패, 2단계 signal.bz 전환:', err.message);
    }

    // 2단계: signal.bz 폴백
    try {
        const list = await fetchSignalBz();
        if (list && list.length > 0) {
            return list;
        }
    } catch (err) {
        console.error('❌ [searchrank] 2단계 signal.bz 조회 실패:', err.message);
    }

    throw new Error('실시간 검색순위를 불러올 수 없습니다.');
}

module.exports = {
    name: 'searchrank',
    group: 'searchrank',
    aliases: ['!실검', '!실시간검색어', '!검색순위', '!실시간순위', '!실시간', '!실검순위'],
    description: '실시간 검색순위 1위~10위 조회',

    web: {
        title: '실시간 검색순위',
        icon: '🔥',
        description: '구글 트렌드 및 실시간 검색어 순위(1위~10위) 조회 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, _input, ctx }) {
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        ctx.setCooldown(cmd, 0, _input);

        try {
            const list = await getRealtimeRankings();
            const rankItems = list.map(item => `${item.rank}. ${maskProfanity(item.keyword)}`);
            const rankListStr = rankItems.join(' ');

            if (msg.searchrank && msg.searchrank.top10) {
                return msg.searchrank.top10(rankListStr, cooldownMsg);
            }
            return `🔥 [실시간 검색순위] ${rankListStr} ${cooldownMsg}`.trim();
        } catch (err) {
            console.error('❌ [searchrank] 명령어 실행 중 에러:', err.message);
            if (msg.searchrank && msg.searchrank.fetch_error) {
                return msg.searchrank.fetch_error(cooldownMsg);
            }
            return `⚠️ 실시간 검색순위를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`.trim();
        }
    }
};
