// ─── stock.js ───────────────────────────────────────────────────────────────
// 실시간 국내 및 해외 주식 시세 & 시가총액 조회 모듈
// 사용법:
//   - !주식, !stock, !주가, !증시       → 주요 대장주 6종(삼전, 하닉, 현차, 테슬라, 엔비디아, 애플) 시세 요약
//   - !주식 <종목명/티커>               → 특정 주식 실시간 시세 및 시총 조회 (국내/해외 모든 주식 지원)
//   - !삼성전자, !삼전, !테슬라, !tsla, !엔비디아, !nvda, !애플, !aapl, !마소, !msft 등 → 해당 주식 직접 조회
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');

// ── 주요 대표 종목 요약 목록 ──
const TOP_STOCKS = [
    { name: '삼전', code: '005930', isDomestic: true },
    { name: '하닉', code: '000660', isDomestic: true },
    { name: '현차', code: '005380', isDomestic: true },
    { name: '테슬라', symbol: 'TSLA.O', isDomestic: false },
    { name: '엔비디아', symbol: 'NVDA.O', isDomestic: false },
    { name: '애플', symbol: 'AAPL.O', isDomestic: false }
];

// ── 국내 및 해외 시총 상위 주요 종목 별칭 맵 ──
const STOCK_ALIASES = {
    // [국내 주요 대형주]
    '삼전': { code: '005930', isDomestic: true },
    '삼성전자': { code: '005930', isDomestic: true },
    '삼성전자우': { code: '005935', isDomestic: true },
    '삼전우': { code: '005935', isDomestic: true },
    '하닉': { code: '000660', isDomestic: true },
    '하이닉스': { code: '000660', isDomestic: true },
    'sk하이닉스': { code: '000660', isDomestic: true },
    '엔솔': { code: '373220', isDomestic: true },
    'lg엔솔': { code: '373220', isDomestic: true },
    'lg에너지솔루션': { code: '373220', isDomestic: true },
    '삼바': { code: '207940', isDomestic: true },
    '삼성바이오': { code: '207940', isDomestic: true },
    '삼성바이오로직스': { code: '207940', isDomestic: true },
    '현차': { code: '005380', isDomestic: true },
    '현대차': { code: '005380', isDomestic: true },
    '현대자동차': { code: '005380', isDomestic: true },
    '기아': { code: '000270', isDomestic: true },
    '기아차': { code: '000270', isDomestic: true },
    '셀트': { code: '068270', isDomestic: true },
    '셀트리온': { code: '068270', isDomestic: true },
    '포스코': { code: '005490', isDomestic: true },
    'posco': { code: '005490', isDomestic: true },
    'posco홀딩스': { code: '005490', isDomestic: true },
    '포스코홀딩스': { code: '005490', isDomestic: true },
    '네이버': { code: '035420', isDomestic: true },
    'naver': { code: '035420', isDomestic: true },
    '카카오': { code: '035720', isDomestic: true },
    'kakao': { code: '035720', isDomestic: true },
    '모비스': { code: '012330', isDomestic: true },
    '현대모비스': { code: '012330', isDomestic: true },
    '삼성물산': { code: '028260', isDomestic: true },
    'kb금융': { code: '105560', isDomestic: true },
    '신한지주': { code: '055550', isDomestic: true },
    '신한금융': { code: '055550', isDomestic: true },
    '하나금융': { code: '086790', isDomestic: true },
    '하나금융지주': { code: '086790', isDomestic: true },
    '메리츠금융': { code: '138040', isDomestic: true },
    '메리츠금융지주': { code: '138040', isDomestic: true },
    'lg화학': { code: '051910', isDomestic: true },
    '삼성생명': { code: '032830', isDomestic: true },
    '삼성sdi': { code: '006400', isDomestic: true },
    'sdi': { code: '006400', isDomestic: true },
    'lg전자': { code: '066570', isDomestic: true },
    '카카오뱅크': { code: '323410', isDomestic: true },
    '카뱅': { code: '323410', isDomestic: true },
    '카카오페이': { code: '377300', isDomestic: true },
    '카카오게임즈': { code: '293490', isDomestic: true },
    '크래프톤': { code: '259960', isDomestic: true },
    '알테오젠': { code: '196170', isDomestic: true },
    '에코프로': { code: '086520', isDomestic: true },
    '에코프로비엠': { code: '247540', isDomestic: true },
    '에코프로머티': { code: '450080', isDomestic: true },
    '한화에어로스페이스': { code: '012450', isDomestic: true },
    '한화에어로': { code: '012450', isDomestic: true },
    'hd현대중공업': { code: '329180', isDomestic: true },
    '현대중공업': { code: '329180', isDomestic: true },
    '두산에너빌리티': { code: '034020', isDomestic: true },
    '두산에너': { code: '034020', isDomestic: true },
    '포스코퓨처엠': { code: '003670', isDomestic: true },
    '하이브': { code: '352820', isDomestic: true },
    'hybe': { code: '352820', isDomestic: true },
    '한미반도체': { code: '042700', isDomestic: true },
    '한국전력': { code: '015760', isDomestic: true },
    '한전': { code: '015760', isDomestic: true },
    'kt&g': { code: '033780', isDomestic: true },
    '담배': { code: '033780', isDomestic: true },
    '삼성화재': { code: '000810', isDomestic: true },
    '고려아연': { code: '010130', isDomestic: true },
    'sk텔레콤': { code: '017670', isDomestic: true },
    'skt': { code: '017670', isDomestic: true },
    'kt': { code: '030200', isDomestic: true },
    'lg유플러스': { code: '032640', isDomestic: true },
    '유플러스': { code: '032640', isDomestic: true },
    '엔씨소프트': { code: '036570', isDomestic: true },
    '엔씨': { code: '036570', isDomestic: true },
    '펄어비스': { code: '263750', isDomestic: true },
    '위메이드': { code: '112040', isDomestic: true },
    'hlb': { code: '028300', isDomestic: true },
    '삼양식품': { code: '003230', isDomestic: true },
    '불닭': { code: '003230', isDomestic: true },
    '농심': { code: '004370', isDomestic: true },
    '오리온': { code: '271560', isDomestic: true },

    // [해외 주요 대형주 및 별칭 (미국/나스닥/NYSE/ETF)]
    '테슬라': { symbol: 'TSLA.O', isDomestic: false },
    'tsla': { symbol: 'TSLA.O', isDomestic: false },
    '엔비디아': { symbol: 'NVDA.O', isDomestic: false },
    '엔비': { symbol: 'NVDA.O', isDomestic: false },
    'nvda': { symbol: 'NVDA.O', isDomestic: false },
    '애플': { symbol: 'AAPL.O', isDomestic: false },
    'aapl': { symbol: 'AAPL.O', isDomestic: false },
    '마이크로소프트': { symbol: 'MSFT.O', isDomestic: false },
    '마소': { symbol: 'MSFT.O', isDomestic: false },
    'msft': { symbol: 'MSFT.O', isDomestic: false },
    '알파벳': { symbol: 'GOOGL.O', isDomestic: false },
    '구글': { symbol: 'GOOGL.O', isDomestic: false },
    'googl': { symbol: 'GOOGL.O', isDomestic: false },
    'goog': { symbol: 'GOOG.O', isDomestic: false },
    '아마존': { symbol: 'AMZN.O', isDomestic: false },
    'amzn': { symbol: 'AMZN.O', isDomestic: false },
    '메타': { symbol: 'META.O', isDomestic: false },
    '페이스북': { symbol: 'META.O', isDomestic: false },
    'meta': { symbol: 'META.O', isDomestic: false },
    '버크셔': { symbol: 'BRKb', isDomestic: false },
    '버크셔해서웨이': { symbol: 'BRKb', isDomestic: false },
    'brk': { symbol: 'BRKb', isDomestic: false },
    'brk-b': { symbol: 'BRKb', isDomestic: false },
    'brkb': { symbol: 'BRKb', isDomestic: false },
    '일라이릴리': { symbol: 'LLY', isDomestic: false },
    '릴리': { symbol: 'LLY', isDomestic: false },
    'lly': { symbol: 'LLY', isDomestic: false },
    '브로드컴': { symbol: 'AVGO.O', isDomestic: false },
    'avgo': { symbol: 'AVGO.O', isDomestic: false },
    'tsmc': { symbol: 'TSM', isDomestic: false },
    'tsm': { symbol: 'TSM', isDomestic: false },
    '노보노디스크': { symbol: 'NVO', isDomestic: false },
    'nvo': { symbol: 'NVO', isDomestic: false },
    'jp모건': { symbol: 'JPM', isDomestic: false },
    'jpm': { symbol: 'JPM', isDomestic: false },
    '비자': { symbol: 'V', isDomestic: false },
    'visa': { symbol: 'V', isDomestic: false },
    '월마트': { symbol: 'WMT', isDomestic: false },
    'wmt': { symbol: 'WMT', isDomestic: false },
    'asml': { symbol: 'ASML.O', isDomestic: false },
    '엑손모빌': { symbol: 'XOM', isDomestic: false },
    'xom': { symbol: 'XOM', isDomestic: false },
    '마스터카드': { symbol: 'MA', isDomestic: false },
    '코스트코': { symbol: 'COST.O', isDomestic: false },
    'cost': { symbol: 'COST.O', isDomestic: false },
    '넷플릭스': { symbol: 'NFLX.O', isDomestic: false },
    '넷플': { symbol: 'NFLX.O', isDomestic: false },
    'nflx': { symbol: 'NFLX.O', isDomestic: false },
    'amd': { symbol: 'AMD.O', isDomestic: false },
    '퀄컴': { symbol: 'QCOM.O', isDomestic: false },
    'qcom': { symbol: 'QCOM.O', isDomestic: false },
    '인텔': { symbol: 'INTC.O', isDomestic: false },
    'intc': { symbol: 'INTC.O', isDomestic: false },
    '팔란티어': { symbol: 'PLTR.O', isDomestic: false },
    'pltr': { symbol: 'PLTR.O', isDomestic: false },
    '코인베이스': { symbol: 'COIN.O', isDomestic: false },
    'coin': { symbol: 'COIN.O', isDomestic: false },
    '슈퍼마이크로': { symbol: 'SMCI.O', isDomestic: false },
    'smci': { symbol: 'SMCI.O', isDomestic: false },
    '스타벅스': { symbol: 'SBUX.O', isDomestic: false },
    '스벅': { symbol: 'SBUX.O', isDomestic: false },
    'sbux': { symbol: 'SBUX.O', isDomestic: false },
    '맥도날드': { symbol: 'MCD', isDomestic: false },
    'mcd': { symbol: 'MCD', isDomestic: false },
    '나이키': { symbol: 'NKE', isDomestic: false },
    'nke': { symbol: 'NKE', isDomestic: false },
    '디즈니': { symbol: 'DIS', isDomestic: false },
    'dis': { symbol: 'DIS', isDomestic: false },
    '보잉': { symbol: 'BA', isDomestic: false },
    'ba': { symbol: 'BA', isDomestic: false },
    '코카콜라': { symbol: 'KO', isDomestic: false },
    'ko': { symbol: 'KO', isDomestic: false },
    '펩시': { symbol: 'PEP.O', isDomestic: false },
    'pep': { symbol: 'PEP.O', isDomestic: false },
    '어도비': { symbol: 'ADBE.O', isDomestic: false },
    'adbe': { symbol: 'ADBE.O', isDomestic: false },
    '오라클': { symbol: 'ORCL.K', isDomestic: false },
    'orcl': { symbol: 'ORCL.K', isDomestic: false },
    '우버': { symbol: 'UBER.K', isDomestic: false },
    'uber': { symbol: 'UBER.K', isDomestic: false },
    '암젠': { symbol: 'AMGN.O', isDomestic: false },
    '모더나': { symbol: 'MRNA.O', isDomestic: false },
    '화이자': { symbol: 'PFE', isDomestic: false },
    'pfe': { symbol: 'PFE', isDomestic: false },
    '슈드': { symbol: 'SCHD.K', isDomestic: false },
    'schd': { symbol: 'SCHD.K', isDomestic: false },
    'spy': { symbol: 'SPY', isDomestic: false },
    'qqq': { symbol: 'QQQ.O', isDomestic: false },
    'soxl': { symbol: 'SOXL.K', isDomestic: false },
    'tqqq': { symbol: 'TQQQ.O', isDomestic: false },
    'sqqq': { symbol: 'SQQQ.O', isDomestic: false }
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 네이버 종목 검색 API
 */
async function searchStock(query) {
    const qClean = query.trim();
    const qLower = qClean.toLowerCase();

    // 1. 별칭 테이블 우선 확인
    if (STOCK_ALIASES[qLower]) {
        const item = STOCK_ALIASES[qLower];
        return {
            name: qClean,
            code: item.code || item.symbol,
            symbol: item.symbol || item.code,
            reutersCode: item.symbol || item.code,
            isDomestic: item.isDomestic
        };
    }

    // 2. 네이버 검색 API 호출
    const url = 'https://ac.stock.naver.com/ac?q=' + encodeURIComponent(qClean) + '&target=stock';
    const res = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Referer': 'https://m.stock.naver.com/'
        },
        signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) throw new Error(`Stock Search HTTP ${res.status}`);
    const json = await res.json();

    if (!Array.isArray(json.items) || json.items.length === 0) {
        return null;
    }

    const first = json.items[0];
    const isDomestic = (first.nationCode === 'KOR');

    return {
        name: first.name,
        code: first.code,
        symbol: first.reutersCode || first.code,
        reutersCode: first.reutersCode || first.code,
        isDomestic,
        typeCode: first.typeCode,
        typeName: first.typeName
    };
}

/**
 * 국내 주식 실시간 시세 및 시총 조회
 */
async function fetchDomesticStock(code) {
    const [bRes, iRes] = await Promise.all([
        fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(3500)
        }),
        fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(3500)
        })
    ]);

    if (!bRes.ok) throw new Error(`Domestic Basic HTTP ${bRes.status}`);
    const b = await bRes.json();
    const i = iRes.ok ? await iRes.json() : null;

    const cap = i?.totalInfos?.find(x => x.key === '시총');
    const high = i?.totalInfos?.find(x => x.key === '고가');
    const low = i?.totalInfos?.find(x => x.key === '저가');
    const last = i?.totalInfos?.find(x => x.key === '전일');

    const isRising = b.compareToPreviousPrice?.name === 'RISING';
    const isFalling = b.compareToPreviousPrice?.name === 'FALLING';
    const sign = isRising ? '▲' : isFalling ? '▼' : '-';
    const pSign = isRising ? '+' : isFalling ? '-' : '';
    const ratioStr = (b.fluctuationsRatio !== undefined) ? `${sign}${b.fluctuationsRatio}%` : '0.00%';
    const diffPriceStr = b.compareToPreviousClosePrice ? `${pSign}${b.compareToPreviousClosePrice}원` : '0원';

    let sessionStr = '';
    if (b.marketSessionType === 'afterMarket' && b.overMarketPriceInfo?.overPrice) {
        const overSign = b.overMarketPriceInfo.compareToPreviousPrice?.name === 'RISING' ? '▲' :
                         b.overMarketPriceInfo.compareToPreviousPrice?.name === 'FALLING' ? '▼' : '-';
        sessionStr = `시간외단일가: ${b.overMarketPriceInfo.overPrice}원 (${overSign}${b.overMarketPriceInfo.fluctuationsRatio || '0'}%)`;
    }

    return {
        name: b.stockName,
        code: b.itemCode,
        market: b.stockExchangeName || 'KRX',
        priceStr: `${b.closePrice}원`,
        changeStr: `${ratioStr}, ${diffPriceStr}`,
        ratioOnlyStr: ratioStr,
        capStr: cap ? cap.value : '정보없음',
        highLowStr: `고가: ${high ? high.value : '-'} / 저가: ${low ? low.value : '-'}${last ? ` (전일: ${last.value})` : ''}`,
        sessionStr
    };
}

/**
 * 해외 주식 실시간 시세 및 시총 조회
 */
async function fetchWorldStock(symbol) {
    let targetSymbol = symbol;
    let res = await fetch(`https://api.stock.naver.com/stock/${targetSymbol}/basic`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(3500)
    });

    // 404/409 응답 시 접미사 형식 자동 보정 재시도 (.N 제거, .O, .K 시도 등)
    if (!res.ok) {
        const noDot = targetSymbol.replace(/\.[A-Za-z]+$/, '');
        if (noDot !== targetSymbol) {
            const r2 = await fetch(`https://api.stock.naver.com/stock/${noDot}/basic`, {
                headers: { 'User-Agent': USER_AGENT },
                signal: AbortSignal.timeout(3500)
            });
            if (r2.ok) {
                res = r2;
                targetSymbol = noDot;
            }
        }
        if (!res.ok && !targetSymbol.includes('.')) {
            for (const ext of ['.O', '.K']) {
                const withExt = `${targetSymbol}${ext}`;
                const r3 = await fetch(`https://api.stock.naver.com/stock/${withExt}/basic`, {
                    headers: { 'User-Agent': USER_AGENT },
                    signal: AbortSignal.timeout(3500)
                });
                if (r3.ok) {
                    res = r3;
                    targetSymbol = withExt;
                    break;
                }
            }
        }
    }

    if (!res.ok) throw new Error(`World Stock HTTP ${res.status}`);
    const b = await res.json();

    const cap = b.stockItemTotalInfos?.find(x => x.key === '시총');
    const high = b.stockItemTotalInfos?.find(x => x.key === '고가');
    const low = b.stockItemTotalInfos?.find(x => x.key === '저가');
    const last = b.stockItemTotalInfos?.find(x => x.key === '전일');

    const ratioNum = parseFloat(b.fluctuationsRatio) || 0;
    const diffNum = parseFloat(b.compareToPreviousClosePrice) || 0;
    const sign = ratioNum > 0 ? '▲' : ratioNum < 0 ? '▼' : '-';
    const pSign = diffNum > 0 ? '+' : '';
    const ratioStr = `${sign}${Math.abs(ratioNum).toFixed(2)}%`;
    const diffPriceStr = `${pSign}${b.compareToPreviousClosePrice || '0'}`;

    const capStr = cap ? `${cap.value}${cap.valueDesc ? ` (약 ${cap.valueDesc})` : ''}` : '정보없음';
    const shortSymbol = (b.reutersCode || targetSymbol).split('.')[0];

    let sessionStr = '';
    const over = b.overMarketPriceInfo;
    if (over && over.overPrice && over.overMarketStatus === 'OPEN') {
        const overType = over.tradingSessionType === 'PRE_MARKET' ? '프리장' : '애프터장';
        const overSign = parseFloat(over.fluctuationsRatio) > 0 ? '▲' : parseFloat(over.fluctuationsRatio) < 0 ? '▼' : '-';
        sessionStr = `${overType}: $${over.overPrice} (${overSign}${over.fluctuationsRatio || '0'}%)`;
    }

    return {
        name: b.stockName,
        code: shortSymbol,
        symbol: shortSymbol,
        market: b.stockExchangeName || '해외',
        priceStr: `$${b.closePrice}`,
        changeStr: `${ratioStr}, ${diffPriceStr}`,
        ratioOnlyStr: ratioStr,
        capStr,
        highLowStr: `고가: $${high ? high.value : '-'} / 저가: $${low ? low.value : '-'}${last ? ` (전일: $${last.value})` : ''}`,
        sessionStr
    };
}

module.exports = {
    name: 'stock',
    group: 'stock',
    icon: '📈',
    aliases: [
        '!주식', '!stock', '!주가', '!증시',
        '!삼성전자', '!삼전', '!삼전우',
        '!sk하이닉스', '!하이닉스', '!하닉',
        '!lg에너지솔루션', '!엔솔',
        '!삼성바이오로직스', '!삼바',
        '!현대차', '!현차', '!기아',
        '!셀트리온', '!셀트',
        '!카카오', '!네이버', '!naver',
        '!알테오젠', '!에코프로', '!에코프로비엠',
        '!한화에어로', '!두산에너',
        '!테슬라', '!tsla',
        '!엔비디아', '!nvda', '!엔비',
        '!애플', '!aapl',
        '!마이크로소프트', '!마소', '!msft',
        '!구글', '!알파벳', '!googl',
        '!아마존', '!amzn',
        '!메타', '!페이스북', '!meta',
        '!버크셔', '!brk',
        '!tsmc', '!tsm',
        '!일라이릴리', '!릴리',
        '!팔란티어', '!pltr',
        '!스타벅스', '!스벅',
        '!넷플릭스', '!넷플',
        '!코카콜라', '!디즈니',
        '!슈드', '!schd', '!spy', '!qqq'
    ],
    description: '실시간 국내/해외 주식 시세 및 시가총액 조회',

    web: {
        title: '실시간 주식 시세 & 시가총액',
        icon: '📈',
        description: '국내(코스피/코스닥) 및 해외(나스닥/S&P500) 시총 상위 100위권 종목 실시간 주가 및 시총 조회 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, args, _input, ctx }) {
        const rawArg = (args && args.length > 0 && typeof args[0] === 'string')
            ? args.join(' ').trim()
            : '';

        ctx.setCooldown(cmd, 0, _input);
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        // 입력값 길이 안전 제한
        if (rawArg.length > 60) {
            return `⚠️ 주식명이 너무 깁니다. ${cooldownMsg}`;
        }

        const cmdLower = cmd.toLowerCase();

        // 1. 특정 주식 직접 호출 별칭 체크 (!삼성전자, !테슬라, !엔비디아, !애플, !마소, !tsla 등)
        let targetQuery = null;
        if (!['!주식', '!stock', '!주가', '!증시'].includes(cmdLower)) {
            targetQuery = cmdLower.replace(/^!/, '');
        }

        // !주식 <종목명> 처럼 인자가 주어진 경우 인자를 최우선으로 적용
        if (rawArg) {
            targetQuery = rawArg;
        }

        // 2. 단일 주식 상세 시세 & 시총 조회
        if (targetQuery && targetQuery !== '주요' && targetQuery !== '전체') {
            try {
                const stockMeta = await searchStock(targetQuery);
                if (!stockMeta) {
                    if (msg.stock && msg.stock.not_found) {
                        return msg.stock.not_found(targetQuery, cooldownMsg);
                    }
                    return `⚠️ "${targetQuery}" 주식 종목을 찾을 수 없습니다. (예: 삼성전자, 테슬라, 엔비디아, 삼전, TSLA 등) ${cooldownMsg}`;
                }

                let info = null;
                if (stockMeta.isDomestic) {
                    info = await fetchDomesticStock(stockMeta.code);
                } else {
                    info = await fetchWorldStock(stockMeta.symbol || stockMeta.reutersCode);
                }

                if (!info) {
                    throw new Error('시세 정보를 가져오지 못했습니다.');
                }

                if (msg.stock && msg.stock.single) {
                    return msg.stock.single(
                        info.name,
                        info.code,
                        info.market,
                        info.priceStr,
                        info.changeStr,
                        info.capStr,
                        info.highLowStr,
                        info.sessionStr,
                        cooldownMsg
                    );
                }

                return `📈 [${info.name}(${info.code}/${info.market})] 현재가: ${info.priceStr} (${info.changeStr}) | 시총: ${info.capStr} | ${info.highLowStr}${info.sessionStr ? ` (${info.sessionStr})` : ''} ${cooldownMsg}`;
            } catch (err) {
                console.error(`❌ [stock] 종목(${targetQuery}) 시세 조회 실패:`, err.message);
                if (msg.stock && msg.stock.fetch_error) {
                    return msg.stock.fetch_error(cooldownMsg);
                }
                return `⚠️ 주식 시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`;
            }
        }

        // 3. 인자 없음: 주요 대장주 6종 종합 시세 요약 (!주식 단독 실행)
        try {
            const results = await Promise.allSettled(
                TOP_STOCKS.map(async (st) => {
                    if (st.isDomestic) {
                        const data = await fetchDomesticStock(st.code);
                        return `${st.name} ${data.priceStr}(${data.ratioOnlyStr})`;
                    } else {
                        const data = await fetchWorldStock(st.symbol);
                        return `${st.name} ${data.priceStr}(${data.ratioOnlyStr})`;
                    }
                })
            );

            const summaryItems = results.map((r, idx) => {
                if (r.status === 'fulfilled') return r.value;
                return `${TOP_STOCKS[idx].name} -`;
            });

            const stockListStr = summaryItems.join(' | ');

            if (msg.stock && msg.stock.summary) {
                return msg.stock.summary(stockListStr, cooldownMsg);
            }
            return `📈 [주요 주식 실시간 시세] ${stockListStr} ${cooldownMsg}`;
        } catch (err) {
            console.error('❌ [stock] 주요 주식 시세 요약 조회 실패:', err.message);
            if (msg.stock && msg.stock.fetch_error) {
                return msg.stock.fetch_error(cooldownMsg);
            }
            return `⚠️ 주식 시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`;
        }
    }
};
