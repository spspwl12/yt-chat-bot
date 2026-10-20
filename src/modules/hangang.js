// ─── hangang.js ─────────────────────────────────────────────────────────────
// 실시간 한강물 온도(수온) 조회 모듈
// 사용법:
//   - !한강, !한강물온도, !한강온도, !수온, !물온도, !드가자, !자살각
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');

/**
 * 수온에 따른 위트 있는 안내 코멘트 생성
 */
function getWaterComment(temp) {
    if (typeof temp !== 'number' || isNaN(temp)) return '수온 정보 확인 중';
    if (temp <= 0) return '꽁꽁 얼어붙은 한강 위로 고양이가 걸어다닙니다 🧊';
    if (temp < 5) return '얼음장입니다. 입수 시 심장마비 위험! 절대 금지 🥶';
    if (temp < 10) return '매우 차갑습니다. 삶은 계속됩니다, 힘내세요! ❄️';
    if (temp < 15) return '쌀쌀하고 차가운 수온입니다. 포기하지 마세요 💧';
    if (temp < 20) return '선선하고 시원한 수온입니다. 차분히 심호흡해보세요 🍃';
    if (temp < 25) return '물놀이하기 좋은 시원한 온도입니다 🏊';
    return '미지근하고 따뜻한 수온입니다 ☀️';
}

/**
 * 1차: 서울시 열린데이터광장 실시간 한강 및 주요 지천 수온 API
 */
async function fetchSeoulHangang() {
    const url = 'http://openAPI.seoul.go.kr:8088/sample/json/WPOSInformationTime/1/5/';
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) throw new Error(`Seoul API HTTP ${res.status}`);
    const json = await res.json();

    const rows = json?.WPOSInformationTime?.row;
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('데이터가 비어 있습니다.');
    }

    const stations = {};
    let latestTime = '';

    for (const r of rows) {
        const name = r.MSRSTN_NM;
        const watt = parseFloat(r.WATT);
        if (!name || isNaN(watt)) continue;

        if (!stations[name]) {
            stations[name] = watt;
        }
        if (!latestTime && r.HR) {
            const hr = r.HR.includes(':') ? r.HR : `${r.HR}:00`;
            latestTime = hr;
        }
    }

    // 선유(본류)를 우선, 없으면 첫 번째 관측소
    const mainTemp = stations['선유'] ?? stations['노량진'] ?? Object.values(stations)[0];
    if (mainTemp === undefined) throw new Error('유효한 수온 데이터가 없습니다.');

    return {
        mainTemp,
        mainStation: stations['선유'] ? '선유' : Object.keys(stations)[0],
        stations,
        time: latestTime || '최근'
    };
}

/**
 * 2차 폴백: hangang.life API
 */
async function fetchHangangLifeFallback() {
    const url = 'https://api.hangang.life/';
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) throw new Error(`Hangang.life HTTP ${res.status}`);
    const json = await res.json();

    const data = json?.DATAs?.DATA?.HANGANG;
    if (!data) throw new Error('hangang.life 데이터 파싱 실패');

    const stations = {};
    for (const [stName, stObj] of Object.entries(data)) {
        if (typeof stObj?.TEMP === 'number') {
            stations[stName] = stObj.TEMP;
        }
    }

    const mainTemp = stations['선유'] ?? stations['중랑천'] ?? Object.values(stations)[0];
    if (mainTemp === undefined) throw new Error('hangang.life 수온 값 없음');

    return {
        mainTemp,
        mainStation: stations['선유'] ? '선유' : Object.keys(stations)[0],
        stations,
        time: '최근'
    };
}

module.exports = {
    name: 'hangang',
    group: 'hangang',
    icon: '🌊',
    aliases: ['!한강', '!한강물온도', '!한강온도', '!수온', '!물온도'],
    description: '실시간 한강물 온도(수온) 조회',

    web: {
        title: '실시간 한강물 온도',
        icon: '🌊',
        description: '서울시 실시간 수질 측정망 기반 한강 및 주요 지천(선유, 탄천, 중랑천, 안양천) 수온 조회 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, args, _input, ctx }) {
        ctx.setCooldown(cmd, 0, _input);
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        let data = null;
        try {
            data = await fetchSeoulHangang();
        } catch (err1) {
            console.warn('⚠️ [hangang] 1차 서울시 API 실패, 2차 폴백 시도:', err1.message);
            try {
                data = await fetchHangangLifeFallback();
            } catch (err2) {
                console.error('❌ [hangang] 2차 폴백 API도 실패:', err2.message);
            }
        }

        if (!data) {
            if (msg.hangang && msg.hangang.fetch_error) {
                return msg.hangang.fetch_error(cooldownMsg);
            }
            return `⚠️ 한강물 온도 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. ${cooldownMsg}`;
        }

        const tempStr = data.mainTemp.toFixed(1);
        const comment = getWaterComment(data.mainTemp);

        // 지천 수온 요약
        const subList = [];
        for (const [name, val] of Object.entries(data.stations)) {
            if (name !== data.mainStation && typeof val === 'number') {
                subList.push(`${name} ${val.toFixed(1)}°C`);
            }
        }
        const detailStr = subList.length > 0 ? `(${subList.join(', ')})` : '';

        if (msg.hangang && msg.hangang.result) {
            return msg.hangang.result(tempStr, comment, detailStr, data.time, cooldownMsg);
        }

        return `🌊 [실시간 한강물 온도] 한강(${data.mainStation}) 수온: ${tempStr}°C (${comment})${detailStr ? ` | ${detailStr}` : ''} [${data.time} 측정] ${cooldownMsg}`;
    }
};
