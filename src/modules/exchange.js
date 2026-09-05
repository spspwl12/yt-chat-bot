// ─── exchange.js ─────────────────────────────────────────────────────────────
// 실시간 환율 조회 및 환전 계산 모듈
// 사용법:
//   - !환율             → 주요 4대 통화 (USD, JPY 100엔, EUR, CNY) 환율 요약
//   - !달러 [금액]      → 달러 환율 및 환전 계산 (예: !달러, !달러 100, !달러 50000원)
//   - !엔화 [금액]      → 엔화(100엔) 환율 및 환전 계산 (예: !엔화, !엔화 1000)
//   - !유로 [금액]      → 유로 환율 및 환전 계산 (예: !유로, !유로 50)
//   - !위안 [금액]      → 위안화 환율 및 환전 계산 (예: !위안, !위안 100)
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');

/**
 * 실시간 환율 데이터 가져오기 (USD 기준 환율표)
 */
async function fetchExchangeRates() {
    // 1차 API: Open ExchangeRate API
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD', {
            signal: AbortSignal.timeout(3500)
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.rates && data.rates.KRW) {
                return data.rates;
            }
        }
    } catch (err) {
        console.warn('⚠️ [exchange] 1차 환율 API 실패, 폴백 시도:', err.message);
    }

    // 2차 폴백 API: ExchangeRate-API v4
    try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
            signal: AbortSignal.timeout(3500)
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.rates && data.rates.KRW) {
                return data.rates;
            }
        }
    } catch (err) {
        console.error('❌ [exchange] 2차 환율 API 실패:', err.message);
    }

    throw new Error('실시간 환율 데이터를 가져올 수 없습니다.');
}

/**
 * 통화별 환율 계산 헬퍼
 */
function getCalculatedRates(rates) {
    const krwPerUsd = rates.KRW || 1350;
    const jpyPerUsd = rates.JPY || 155;
    const eurPerUsd = rates.EUR || 0.92;
    const cnyPerUsd = rates.CNY || 7.2;

    const usdToKrw = krwPerUsd;
    const jpy100ToKrw = (krwPerUsd / jpyPerUsd) * 100;
    const eurToKrw = krwPerUsd / eurPerUsd;
    const cnyToKrw = krwPerUsd / cnyPerUsd;

    return {
        usdToKrw,
        jpy100ToKrw,
        eurToKrw,
        cnyToKrw,
        rates
    };
}

/**
 * 금액 포맷 헬퍼 (소수점 2자리 또는 정수)
 */
function formatNum(num, decimals = 2) {
    if (typeof num !== 'number' || isNaN(num)) return '0';
    return Number(num.toFixed(decimals)).toLocaleString('ko-KR', {
        minimumFractionDigits: (decimals > 0 && num % 1 !== 0) ? 2 : 0,
        maximumFractionDigits: decimals
    });
}

module.exports = {
    name: 'exchange',
    group: 'exchange',
    icon: '💱',
    aliases: ['!환율', '!exchange', '!달러', '!usd', '!엔화', '!엔', '!jpy', '!유로', '!eur', '!위안', '!위안화', '!cny'],
    description: '실시간 주요 통화 환율 및 환전 금액 계산',

    web: {
        title: '실시간 환율',
        icon: '💱',
        description: '달러(USD), 엔화(JPY), 유로(EUR), 위안(CNY) 실시간 환율 및 환전 계산 모듈',
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
            return `⚠️ 입력값이 너무 깁니다. ${cooldownMsg}`;
        }

        let ratesData = null;
        try {
            ratesData = await fetchExchangeRates();
        } catch (err) {
            console.error('❌ [exchange] 환율 조회 실패:', err.message);
            if (msg.exchange && msg.exchange.fetch_error) {
                return msg.exchange.fetch_error(cooldownMsg);
            }
            return `⚠️ 환율 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`;
        }

        const calc = getCalculatedRates(ratesData);
        const cmdLower = cmd.toLowerCase();

        // 1. !달러 / !usd 별칭
        if (cmdLower === '!달러' || cmdLower === '!usd') {
            return handleSingleCurrency('달러', 'USD', '💵', calc.usdToKrw, 1, rawArg, cooldownMsg);
        }

        // 2. !엔화 / !엔 / !jpy 별칭
        if (cmdLower === '!엔화' || cmdLower === '!엔' || cmdLower === '!jpy') {
            return handleSingleCurrency('엔화', 'JPY', '💴', calc.jpy100ToKrw, 100, rawArg, cooldownMsg);
        }

        // 3. !유로 / !eur 별칭
        if (cmdLower === '!유로' || cmdLower === '!eur') {
            return handleSingleCurrency('유로', 'EUR', '💶', calc.eurToKrw, 1, rawArg, cooldownMsg);
        }

        // 4. !위안 / !위안화 / !cny 별칭
        if (cmdLower === '!위안' || cmdLower === '!위안화' || cmdLower === '!cny') {
            return handleSingleCurrency('위안', 'CNY', '🇨🇳', calc.cnyToKrw, 1, rawArg, cooldownMsg);
        }

        // 5. !환율 기본 명령어 인자 분석
        if (rawArg) {
            const argLower = rawArg.toLowerCase();

            if (argLower.includes('달러') || argLower.includes('usd') || argLower.includes('$')) {
                return handleSingleCurrency('달러', 'USD', '💵', calc.usdToKrw, 1, rawArg, cooldownMsg);
            }
            if (argLower.includes('엔') || argLower.includes('jpy') || argLower.includes('¥')) {
                return handleSingleCurrency('엔화', 'JPY', '💴', calc.jpy100ToKrw, 100, rawArg, cooldownMsg);
            }
            if (argLower.includes('유로') || argLower.includes('eur') || argLower.includes('€')) {
                return handleSingleCurrency('유로', 'EUR', '💶', calc.eurToKrw, 1, rawArg, cooldownMsg);
            }
            if (argLower.includes('위안') || argLower.includes('cny')) {
                return handleSingleCurrency('위안', 'CNY', '🇨🇳', calc.cnyToKrw, 1, rawArg, cooldownMsg);
            }
        }

        // 6. !환율 기본 요약 출력
        const rateItems = [
            `달러 ${formatNum(calc.usdToKrw)}원`,
            `엔화(100엔) ${formatNum(calc.jpy100ToKrw)}원`,
            `유로 ${formatNum(calc.eurToKrw)}원`,
            `위안 ${formatNum(calc.cnyToKrw)}원`
        ];
        const rateListStr = rateItems.join(' | ');

        if (msg.exchange && msg.exchange.summary) {
            return msg.exchange.summary(rateListStr, cooldownMsg);
        }
        return `💱 [실시간 환율] ${rateListStr} ${cooldownMsg}`;
    }
};

/**
 * 개별 통화 포맷 및 환전 계산 처리기
 */
function handleSingleCurrency(currName, symbol, emoji, unitRate, unitBase = 1, rawArg = '', cooldownMsg = '') {
    // 숫자 추출 (예: '100', '100달러', '50000원', '1,000')
    const cleanArg = rawArg.replace(/[,]/g, '');
    const numMatch = cleanArg.match(/(\d+(?:\.\d+)?)/);

    // 인자가 없거나 숫자가 없으면 기본 1단위 환율 출력
    if (!numMatch) {
        const rateStr = `${emoji} [${currName} 환율] ${unitBase} ${symbol} = ${formatNum(unitRate)}원`;
        if (msg.exchange && msg.exchange.single) {
            return msg.exchange.single(rateStr, '', cooldownMsg);
        }
        return `${rateStr} ${cooldownMsg}`.trim();
    }

    const amount = parseFloat(numMatch[1]);
    if (isNaN(amount) || amount <= 0 || amount > 1000000000000) {
        const rateStr = `${emoji} [${currName} 환율] ${unitBase} ${symbol} = ${formatNum(unitRate)}원`;
        return `${rateStr} ${cooldownMsg}`.trim();
    }

    // '원' 또는 'krw'가 포함되어 있으면 원화 -> 외화 환전
    if (cleanArg.includes('원') || cleanArg.toLowerCase().includes('krw')) {
        const convertedForeign = (amount / unitRate) * unitBase;
        const resultStr = `${emoji} [원화 환전] ${formatNum(amount, 0)} KRW = 약 ${formatNum(convertedForeign, 2)} ${symbol} (기준: ${unitBase} ${symbol} = ${formatNum(unitRate)}원)`;
        return `${resultStr} ${cooldownMsg}`.trim();
    }

    // 외화 -> 원화 환전
    const convertedKrw = (amount / unitBase) * unitRate;
    const baseStr = unitBase === 1 ? `1 ${symbol} = ${formatNum(unitRate)}원` : `${unitBase} ${symbol} = ${formatNum(unitRate)}원`;
    const resultStr = `${emoji} [${currName} 환전] ${formatNum(amount, unitBase > 1 ? 0 : 2)} ${symbol} = ${formatNum(convertedKrw, 0)}원 (기준: ${baseStr})`;
    return `${resultStr} ${cooldownMsg}`.trim();
}
