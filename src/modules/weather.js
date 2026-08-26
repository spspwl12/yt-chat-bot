// ─── weather.js ──────────────────────────────────────────────────────────────
// 실시간 전국 날씨 및 지역별 날씨 조회 모듈
// 사용법:
//   - !날씨         → 전국 주요 도시 (서울, 강릉, 대전, 대구, 광주, 부산, 제주) 날씨 요약
//   - !날씨 [지역]  → 특정 지역 날씨 상세 조회 (예: !날씨 부산, !날씨 제주)
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');

// 전국 주요 도시 위도/경도 좌표 테이블
const CITY_COORDS = {
    '서울': { lat: 37.5665, lon: 126.9780, name: '서울' },
    '강릉': { lat: 37.7556, lon: 128.8961, name: '강릉' },
    '대전': { lat: 36.3504, lon: 127.3845, name: '대전' },
    '대구': { lat: 35.8714, lon: 128.6014, name: '대구' },
    '광주': { lat: 35.1595, lon: 126.8526, name: '광주' },
    '부산': { lat: 35.1796, lon: 129.0756, name: '부산' },
    '제주': { lat: 33.4996, lon: 126.5312, name: '제주' },
    '인천': { lat: 37.4563, lon: 126.7052, name: '인천' },
    '수원': { lat: 37.2636, lon: 127.0286, name: '수원' },
    '춘천': { lat: 37.8813, lon: 127.7298, name: '춘천' },
    '청주': { lat: 36.6424, lon: 127.4890, name: '청주' },
    '전주': { lat: 35.8242, lon: 127.1480, name: '전주' },
    '울산': { lat: 35.5384, lon: 129.3114, name: '울산' },
    '창원': { lat: 35.2280, lon: 128.6811, name: '창원' },
    '포항': { lat: 36.0190, lon: 129.3435, name: '포항' },
    '독도': { lat: 37.2428, lon: 131.8686, name: '독도' },
    '여수': { lat: 34.7604, lon: 127.6622, name: '여수' }
};

// 전국 요약에 표시할 기본 도시 순서
const NATIONAL_CITIES = ['서울', '강릉', '대전', '대구', '광주', '부산', '제주'];

// WMO 날씨 코드 매핑
function parseWeatherCode(code) {
    if (code === 0) return { desc: '맑음', emoji: '☀️' };
    if (code === 1) return { desc: '대체로 맑음', emoji: '🌤️' };
    if (code === 2) return { desc: '구름조금', emoji: '⛅' };
    if (code === 3) return { desc: '흐림', emoji: '☁️' };
    if (code === 45 || code === 48) return { desc: '안개', emoji: '🌫️' };
    if (code >= 51 && code <= 55) return { desc: '이슬비', emoji: '🌦️' };
    if (code >= 61 && code <= 65) return { desc: '비', emoji: '🌧️' };
    if (code >= 71 && code <= 77) return { desc: '눈', emoji: '❄️' };
    if (code >= 80 && code <= 82) return { desc: '소나기', emoji: '🌦️' };
    if (code === 85 || code === 86) return { desc: '눈소나기', emoji: '🌨️' };
    if (code >= 95) return { desc: '뇌우', emoji: '⛈️' };
    return { desc: '맑음', emoji: '🌤️' };
}

// 10분 인메모리 캐시 + in-flight 중복 호출 방지
let cachedNationalData = null;
let lastFetchTime = 0;
let _inflight = null; // 진행 중인 fetch Promise
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분

async function fetchNationalWeather() {
    const now = Date.now();
    if (cachedNationalData && (now - lastFetchTime < CACHE_TTL_MS)) {
        return cachedNationalData;
    }

    // 진행 중인 요청 사용 (동시 중복 API 호출 방지)
    if (_inflight) return _inflight;

    _inflight = (async () => {
        try {
            const cityKeys = Object.keys(CITY_COORDS);
            const lats = cityKeys.map(k => CITY_COORDS[k].lat).join(',');
            const lons = cityKeys.map(k => CITY_COORDS[k].lon).join(',');
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,weather_code&timezone=Asia%2FSeoul`;

            const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const resultMap = {};
            if (Array.isArray(data)) {
                data.forEach((item, idx) => {
                    const cityName = cityKeys[idx];
                    if (item && item.current) {
                        const w = parseWeatherCode(item.current.weather_code);
                        resultMap[cityName] = {
                            temp: Math.round(item.current.temperature_2m),
                            desc: w.desc,
                            emoji: w.emoji
                        };
                    }
                });
            }

            // 빈 응답(전체 도시 실패)은 캐시하지 않고 오류 throw
            if (Object.keys(resultMap).length === 0) {
                throw new Error('날씨 API 응답이 비어 있습니다.');
            }

            cachedNationalData = resultMap;
            lastFetchTime = Date.now();
            return resultMap;
        } finally {
            _inflight = null;
        }
    })();

    return _inflight;
}

module.exports = {
    name: 'weather',
    group: 'weather',
    aliases: ['!날씨', '!weather', '!전국날씨'],
    description: '전국 및 주요 도시 실시간 날씨/기온 조회',

    async execute({ cmd, args, _input, ctx }) {
        const rawArg = (args && args.length > 0 && typeof args[0] === 'string')
            ? args[0].trim()
            : '';

        let weatherData = null;
        try {
            weatherData = await fetchNationalWeather();
        } catch (err) {
            console.error('⚠️ [weather] 날씨 API 호출 실패:', err.message);
            const errText = msg.weather && msg.weather.fetch_error
                ? msg.weather.fetch_error(ctx.getCooldownMsg(cmd))
                : `⚠️ 날씨 정보를 불러오지 못했습니다. ${ctx.getCooldownMsg(cmd)}`;
            return errText;
        }

        ctx.setCooldown(cmd, 0, _input);
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        // 1. 특정 지역 검색 시
        if (rawArg) {
            // 접두사/부분 검색 (예: "서울시" -> "서울", "부산" -> "부산")
            const matchedKey = Object.keys(CITY_COORDS).find(k =>
                rawArg.includes(k) || k.includes(rawArg)
            );

            if (matchedKey && weatherData[matchedKey]) {
                const info = weatherData[matchedKey];
                if (msg.weather && msg.weather.city_weather) {
                    return msg.weather.city_weather(matchedKey, info.temp, info.desc, info.emoji, cooldownMsg);
                }
                return `${info.emoji} [${matchedKey} 날씨] 현재 기온: ${info.temp}°C (${info.desc}) ${cooldownMsg}`;
            }

            if (msg.weather && msg.weather.invalid_city) {
                return msg.weather.invalid_city(rawArg, cooldownMsg);
            }
            return `⚠️ "${rawArg}" 지역을 찾을 수 없습니다. (예: 서울, 부산, 대전, 제주 등) ${cooldownMsg}`;
        }

        // 2. 인자 없음: 전국 주요 도시 요약
        const summaryItems = NATIONAL_CITIES.map(city => {
            const info = weatherData[city];
            if (!info) return `${city} -`;
            return `${city} ${info.temp}°C ${info.desc}`;
        });

        const weatherListStr = summaryItems.join(' | ');
        if (msg.weather && msg.weather.national_summary) {
            return msg.weather.national_summary(weatherListStr, cooldownMsg);
        }
        return `🌤️ [전국 날씨] ${weatherListStr} ${cooldownMsg}`;
    }
};
