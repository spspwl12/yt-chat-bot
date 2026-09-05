// ─── crypto.js ───────────────────────────────────────────────────────────────
// 실시간 비트코인 및 가상화폐 시세 조회 모듈 (캐싱 없이 매 호출 실시간 조회)
// 사용법:
//   - !비트코인, !코인            → 주요 코인 5종(BTC, ETH, XRP, SOL, DOGE) 실시간 시세 요약
//   - !코인 [코인명/심볼]         → 특정 코인 실시간 상세 시세 (예: !코인 이더리움, !코인 sol, !코인 리플)
//   - !이더리움, !리플, !도지, !솔라나, !btc, !eth, !xrp, !doge, !sol → 해당 코인 직접 조회
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');

// 주요 5대 코인 시장 심볼
const TOP_COINS = [
    { market: 'KRW-BTC', name: '비트코인', symbol: 'BTC' },
    { market: 'KRW-ETH', name: '이더리움', symbol: 'ETH' },
    { market: 'KRW-XRP', name: '리플', symbol: 'XRP' },
    { market: 'KRW-SOL', name: '솔라나', symbol: 'SOL' },
    { market: 'KRW-DOGE', name: '도지', symbol: 'DOGE' }
];

// 한글 별칭 매핑 테이블
const COIN_ALIASES = {
    '비트': 'BTC',
    '비트코인': 'BTC',
    '이더': 'ETH',
    '이더리움': 'ETH',
    '리플': 'XRP',
    '솔라나': 'SOL',
    '도지': 'DOGE',
    '도지코인': 'DOGE',
    '에이다': 'ADA',
    '에이다코인': 'ADA',
    '트론': 'TRX',
    '샌드박스': 'SAND',
    '아발란체': 'AVAX',
    '체인링크': 'LINK',
    '시바이누': 'SHIB',
    '폴리곤': 'POL'
};

/**
 * 실시간 업비트 티커 조회 (캐싱 없이 실시간 호출)
 * @param {string[]} markets 마켓 코드 배열 (예: ['KRW-BTC', 'KRW-ETH'])
 */
async function fetchUpbitTickers(markets) {
    const marketStr = markets.join(',');
    const url = `https://api.upbit.com/v1/ticker?markets=${marketStr}`;
    const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) throw new Error(`Upbit HTTP ${res.status}`);
    return await res.json();
}

/**
 * 실시간 전체 KRW 마켓 목록 조회
 */
async function fetchUpbitMarkets() {
    const url = 'https://api.upbit.com/v1/market/all?isDetails=false';
    const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) throw new Error(`Upbit Market HTTP ${res.status}`);
    const all = await res.json();
    return all.filter(m => m.market.startsWith('KRW-'));
}

/**
 * 가격 포맷팅 (원화 기준, 100원 미만은 소수점 표시)
 */
function formatPrice(price) {
    if (typeof price !== 'number' || isNaN(price)) return '0원';
    if (price >= 100) {
        return price.toLocaleString('ko-KR') + '원';
    }
    if (price >= 1) {
        return price.toFixed(2) + '원';
    }
    return price.toFixed(4) + '원';
}

/**
 * 변동률 포맷팅 (▲/▼/-, %)
 */
function formatChange(changeRate, changePrice) {
    const pct = (changeRate * 100).toFixed(2);
    if (changeRate > 0) {
        return { sign: '▲', str: `▲${pct}%`, priceStr: `+${formatPrice(changePrice)}` };
    }
    if (changeRate < 0) {
        return { sign: '▼', str: `▼${pct}%`, priceStr: `-${formatPrice(Math.abs(changePrice))}` };
    }
    return { sign: '-', str: `0.00%`, priceStr: `0원` };
}

module.exports = {
    name: 'crypto',
    group: 'crypto',
    icon: '🪙',
    aliases: ['!비트코인', '!코인', '!비트', '!btc', '!eth', '!이더리움', '!리플', '!xrp', '!도지', '!doge', '!솔라나', '!sol'],
    description: '실시간 가상화폐(비트코인 등) 시세 조회',

    web: {
        title: '가상화폐 실시간 시세',
        icon: '🪙',
        description: '업비트 실시간 API 기반 비트코인 및 주요 암호화폐 시세 조회 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, args, _input, ctx }) {
        const rawArg = (args && args.length > 0 && typeof args[0] === 'string')
            ? args.join(' ').trim()
            : '';

        ctx.setCooldown(cmd, 0, _input);
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        // 입력값 안전 제한 (60자 초과 시 차단)
        if (rawArg.length > 60) {
            return `⚠️ 코인명이 너무 깁니다. ${cooldownMsg}`;
        }

        const cmdLower = cmd.toLowerCase();

        // 1. 특정 코인 직접 호출 별칭 체크 (!이더리움, !eth, !리플, !xrp, !도지, !doge, !솔라나, !sol 등)
        let specificQuery = null;
        if (cmdLower === '!이더리움' || cmdLower === '!eth' || cmdLower === '!이더') specificQuery = 'ETH';
        else if (cmdLower === '!리플' || cmdLower === '!xrp') specificQuery = 'XRP';
        else if (cmdLower === '!도지' || cmdLower === '!doge') specificQuery = 'DOGE';
        else if (cmdLower === '!솔라나' || cmdLower === '!sol') specificQuery = 'SOL';
        else if (cmdLower === '!비트' || cmdLower === '!btc') {
            // !비트, !btc 단독은 비트코인 단일 상세 조회
            if (!rawArg) specificQuery = 'BTC';
        }

        // 인자가 있으면 인자를 우선하여 검색 대상 지정
        if (rawArg) {
            specificQuery = rawArg;
        }

        // 2. 단일 특정 코인 상세 시세 조회
        if (specificQuery && specificQuery !== '주요' && specificQuery !== '전체') {
            try {
                const markets = await fetchUpbitMarkets();
                const qClean = specificQuery.trim();
                const qUpper = qClean.toUpperCase();

                // 마켓 찾기
                let targetMarket = markets.find(m =>
                    m.market === `KRW-${qUpper}` || m.market.replace('KRW-', '') === qUpper
                );

                if (!targetMarket) {
                    targetMarket = markets.find(m => m.korean_name === qClean);
                }

                if (!targetMarket && COIN_ALIASES[qClean]) {
                    const aliasSym = COIN_ALIASES[qClean];
                    targetMarket = markets.find(m => m.market === `KRW-${aliasSym}`);
                }

                if (!targetMarket) {
                    targetMarket = markets.find(m =>
                        m.korean_name.includes(qClean) || m.english_name.toUpperCase().includes(qUpper)
                    );
                }

                if (!targetMarket) {
                    if (msg.crypto && msg.crypto.not_found) {
                        return msg.crypto.not_found(qClean, cooldownMsg);
                    }
                    return `⚠️ "${qClean}" 코인을 찾을 수 없습니다. (예: 비트코인, 이더리움, 리플, SOL, DOGE 등) ${cooldownMsg}`;
                }

                // 실시간 티커 조회
                const tickers = await fetchUpbitTickers([targetMarket.market]);
                if (!tickers || tickers.length === 0) {
                    throw new Error('티커 정보를 받지 못했습니다.');
                }

                const ticker = tickers[0];
                const symbol = targetMarket.market.replace('KRW-', '');
                const change = formatChange(ticker.signed_change_rate, ticker.signed_change_price);
                const priceStr = formatPrice(ticker.trade_price);
                const changeStr = `${change.str}, ${change.priceStr}`;
                const highLowStr = `당일고가: ${formatPrice(ticker.high_price)} / 당일저가: ${formatPrice(ticker.low_price)}`;

                if (msg.crypto && msg.crypto.single) {
                    return msg.crypto.single(targetMarket.korean_name, symbol, priceStr, changeStr, highLowStr, cooldownMsg);
                }
                return `🪙 [${targetMarket.korean_name}(${symbol})] 현재가: ${priceStr} (${changeStr}) | ${highLowStr} ${cooldownMsg}`;
            } catch (err) {
                console.error('❌ [crypto] 단일 코인 시세 조회 실패:', err.message);
                if (msg.crypto && msg.crypto.fetch_error) {
                    return msg.crypto.fetch_error(cooldownMsg);
                }
                return `⚠️ 가상화폐 시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`;
            }
        }

        // 3. 인자 없음: 주요 코인 5종(BTC, ETH, XRP, SOL, DOGE) 종합 요약
        try {
            const topMarkets = TOP_COINS.map(c => c.market);
            const tickers = await fetchUpbitTickers(topMarkets);

            const summaryItems = TOP_COINS.map(coin => {
                const t = tickers.find(item => item.market === coin.market);
                if (!t) return `${coin.name} -`;
                const change = formatChange(t.signed_change_rate, t.signed_change_price);
                return `${coin.name} ${formatPrice(t.trade_price)}(${change.str})`;
            });

            const coinListStr = summaryItems.join(' | ');

            if (msg.crypto && msg.crypto.summary) {
                return msg.crypto.summary(coinListStr, cooldownMsg);
            }
            return `🪙 [가상화폐 실시간 시세] ${coinListStr} ${cooldownMsg}`;
        } catch (err) {
            console.error('❌ [crypto] 주요 가상화폐 시세 조회 실패:', err.message);
            if (msg.crypto && msg.crypto.fetch_error) {
                return msg.crypto.fetch_error(cooldownMsg);
            }
            return `⚠️ 가상화폐 시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`;
        }
    }
};
