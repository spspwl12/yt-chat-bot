// ─── fortune.js ──────────────────────────────────────────────────────────────
// 정통 만세력(사주명리학) 및 서양 점성술 기반 오늘의 운세 모듈
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');

// ─── 1. 만세력 천간(10간) 및 지지(12지) 정의 ─────────────────────────────────
const STEMS = [
    { name: '갑', hanja: '甲', element: '목', polarity: '양', color: '초록', dir: '동쪽', num: 3 },
    { name: '을', hanja: '乙', element: '목', polarity: '음', color: '청색', dir: '동쪽', num: 8 },
    { name: '병', hanja: '丙', element: '화', polarity: '양', color: '빨강', dir: '남쪽', num: 2 },
    { name: '정', hanja: '丁', element: '화', polarity: '음', color: '주황', dir: '남쪽', num: 7 },
    { name: '무', hanja: '戊', element: '토', polarity: '양', color: '노랑', dir: '중앙', num: 5 },
    { name: '기', hanja: '己', element: '토', polarity: '음', color: '갈색', dir: '중앙', num: 10 },
    { name: '경', hanja: '庚', element: '금', polarity: '양', color: '흰색', dir: '서쪽', num: 4 },
    { name: '신', hanja: '辛', element: '금', polarity: '음', color: '은색', dir: '서쪽', num: 9 },
    { name: '임', hanja: '壬', element: '수', polarity: '양', color: '검정', dir: '북쪽', num: 1 },
    { name: '계', hanja: '癸', element: '수', polarity: '음', color: '파랑', dir: '북쪽', num: 6 },
];

const BRANCHES = [
    { name: '자', hanja: '子', animal: '쥐', emoji: '🐭', element: '수', dir: '북쪽', num: 1 },
    { name: '축', hanja: '丑', animal: '소', emoji: '🐮', element: '토', dir: '북동', num: 5 },
    { name: '인', hanja: '寅', animal: '호랑이', emoji: '🐯', element: '목', dir: '동북', num: 3 },
    { name: '묘', hanja: '卯', animal: '토끼', emoji: '🐰', element: '목', dir: '동쪽', num: 8 },
    { name: '진', hanja: '辰', animal: '용', emoji: '🐲', element: '토', dir: '동남', num: 10 },
    { name: '사', hanja: '巳', animal: '뱀', emoji: '🐍', element: '화', dir: '남동', num: 2 },
    { name: '오', hanja: '午', animal: '말', emoji: '🐴', element: '화', dir: '남쪽', num: 7 },
    { name: '미', hanja: '未', animal: '양', emoji: '🐑', element: '토', dir: '남서', num: 5 },
    { name: '신', hanja: '申', animal: '원숭이', emoji: '🐵', element: '금', dir: '서남', num: 4 },
    { name: '유', hanja: '酉', animal: '닭', emoji: '🐔', element: '금', dir: '서쪽', num: 9 },
    { name: '술', hanja: '戌', animal: '개', emoji: '🐶', element: '토', dir: '서북', num: 10 },
    { name: '해', hanja: '亥', animal: '돼지', emoji: '🐷', element: '수', dir: '북서', num: 6 },
];

const ZODIAC_NAME_TO_IDX = {
    '쥐': 0, '소': 1, '호랑이': 2, '토끼': 3, '용': 4, '뱀': 5,
    '말': 6, '양': 7, '원숭이': 8, '닭': 9, '개': 10, '돼지': 11
};

const ZODIAC_ALIASES = {
    호: 2, 범: 2, 범띠: 2, 호랑이띠: 2,
    토: 3, 토끼띠: 3,
    뱀띠: 5, 말띠: 6, 개띠: 10, 쥐띠: 0, 소띠: 1, 용띠: 4,
    양띠: 7,
    원숭이띠: 8, 원숭띠: 8, 잔나비: 8, 잔나비띠: 8,
    닭띠: 9, 돼지띠: 11
};

// ─── 2. 12별자리 및 4대 원소(점성술) ─────────────────────────────────────────
const CONSTELLATIONS = {
    '물병자리':   { name: '물병자리',   emoji: '♒', element: '공기', ruler: '천왕성' },
    '물고기자리': { name: '물고기자리', emoji: '♓', element: '물',   ruler: '해왕성' },
    '양자리':     { name: '양자리',     emoji: '♈', element: '불',   ruler: '화성' },
    '황소자리':   { name: '황소자리',   emoji: '♉', element: '흙',   ruler: '금성' },
    '쌍둥이자리': { name: '쌍둥이자리', emoji: '♊', element: '공기', ruler: '수성' },
    '게자리':     { name: '게자리',     emoji: '♋', element: '물',   ruler: '달' },
    '사자자리':   { name: '사자자리',   emoji: '♌', element: '불',   ruler: '태양' },
    '처녀자리':   { name: '처녀자리',   emoji: '♍', element: '흙',   ruler: '수성' },
    '천칭자리':   { name: '천칭자리',   emoji: '♎', element: '공기', ruler: '금성' },
    '전갈자리':   { name: '전갈자리',   emoji: '♏', element: '물',   ruler: '명왕성' },
    '사수자리':   { name: '사수자리',   emoji: '♐', element: '불',   ruler: '목성' },
    '염소자리':   { name: '염소자리',   emoji: '♑', element: '흙',   ruler: '토성' },
};

const CONSTELLATION_ALIASES = {
    '물병': '물병자리', 'aquarius': '물병자리',
    '물고기': '물고기자리', 'pisces': '물고기자리',
    '양자리': '양자리', 'aries': '양자리',
    '황소': '황소자리', 'taurus': '황소자리',
    '쌍둥이': '쌍둥이자리', '쌍둥': '쌍둥이자리', 'gemini': '쌍둥이자리',
    '게': '게자리', 'cancer': '게자리',
    '사자': '사자자리', 'leo': '사자자리',
    '처녀': '처녀자리', 'virgo': '처녀자리',
    '천칭': '천칭자리', '저울': '천칭자리', '저울자리': '천칭자리', 'libra': '천칭자리',
    '전갈': '전갈자리', 'scorpio': '전갈자리',
    '사수': '사수자리', '궁수': '사수자리', '궁수자리': '사수자리', 'sagittarius': '사수자리',
    '염소': '염소자리', 'capricorn': '염소자리',
};

// ─── 3. 성명학 한글 초성 발음오행 ──────────────────────────────────────────────
const HANGUL_CHOSUNG_ELEMENT = {
    'ㄱ': '목', 'ㄲ': '목', 'ㅋ': '목',
    'ㄴ': '화', 'ㄷ': '화', 'ㄸ': '화', 'ㄹ': '화', 'ㅌ': '화',
    'ㅇ': '토', 'ㅎ': '토',
    'ㅅ': '금', 'ㅆ': '금', 'ㅈ': '금', 'ㅉ': '금', 'ㅊ': '금',
    'ㅁ': '수', 'ㅂ': '수', 'ㅃ': '수', 'ㅍ': '수'
};

const CHOSUNG_LIST = [
    'ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'
];

function getHangulElement(str) {
    if (!str || typeof str !== 'string') return '토';
    const code = str.charCodeAt(0) - 0xAC00;
    if (code >= 0 && code <= 11171) {
        const chosungIdx = Math.floor(code / 588);
        const chosung = CHOSUNG_LIST[chosungIdx];
        return HANGUL_CHOSUNG_ELEMENT[chosung] || '토';
    }
    return '토';
}

// ─── 4. 만세력 일진(오늘의 60갑자) 계산 ─────────────────────────────────────────
function getTodayIljin(timestamp = Date.now()) {
    const kst = new Date(timestamp + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear();
    const m = kst.getUTCMonth();
    const d = kst.getUTCDate();

    // 2024-01-01(KST)은 甲子(갑자)일 (Stem: 0, Branch: 0)
    const refMs = Date.UTC(2024, 0, 1);
    const currentMs = Date.UTC(y, m, d);
    const diffDays = Math.floor((currentMs - refMs) / 86400000);

    const stemIdx = ((diffDays % 10) + 10) % 10;
    const branchIdx = ((diffDays % 12) + 12) % 12;

    const stem = STEMS[stemIdx];
    const branch = BRANCHES[branchIdx];
    const dayOfWeek = kst.getUTCDay(); // 0:일, 1:월, ..., 6:토

    return {
        y, m: m + 1, d,
        stem,
        branch,
        stemIdx,
        branchIdx,
        ganjiStr: `${stem.hanja}${branch.hanja}(${stem.name}${branch.name})일`,
        dayOfWeek,
        seedBase: `${y}${String(m + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`
    };
}

// ─── 5. 사주명리학 궁합 및 점수 엔진 ─────────────────────────────────────────
const ELEMENT_RELATIONS = {
    '목': { generates: '화', overcomes: '토', isGeneratedBy: '수', isOvercomeBy: '금' },
    '화': { generates: '토', overcomes: '금', isGeneratedBy: '목', isOvercomeBy: '수' },
    '토': { generates: '금', overcomes: '수', isGeneratedBy: '화', isOvercomeBy: '목' },
    '금': { generates: '수', overcomes: '목', isGeneratedBy: '토', isOvercomeBy: '화' },
    '수': { generates: '목', overcomes: '화', isGeneratedBy: '금', isOvercomeBy: '토' }
};

// 육합 쌍 (인덱스)
const SIX_HARMONIES = [
    [0, 1],   // 子-丑
    [2, 11],  // 寅-亥
    [3, 10],  // 卯-戌
    [4, 9],   // 辰-酉
    [5, 8],   // 巳-申
    [6, 7]    // 午-未
];

// 삼합 (수국, 목국, 화국, 금국)
const THREE_HARMONIES = [
    [8, 0, 4],   // 申-子-辰 (수국)
    [11, 3, 7],  // 亥-卯-未 (목국)
    [2, 6, 10],  // 寅-午-戌 (화국)
    [5, 9, 1]    // 巳-酉-丑 (금국)
];

// 상충 쌍 (인덱스)
const SIX_CLASHES = [
    [0, 6],   // 子-午 충
    [1, 7],   // 丑-未 충
    [2, 8],   // 寅-申 충
    [3, 9],   // 卯-酉 충
    [4, 10],  // 辰-戌 충
    [5, 11]   // 巳-亥 충
];

// 원진살 쌍 (인덱스)
const WONJIN_PAIRS = [
    [0, 7],   // 子-未
    [1, 6],   // 丑-午
    [2, 9],   // 寅-酉
    [3, 8],   // 卯-申
    [4, 11],  // 辰-亥
    [5, 10]   // 巳-戌
];

// 천간합
const STEM_HARMONIES = [
    [0, 5], // 甲-己
    [1, 6], // 乙-庚
    [2, 7], // 丙-辛
    [3, 8], // 丁-壬
    [4, 9]  // 戊-癸
];

// ─── 6. 명리학 기반 풀이 메시지 풀 ──────────────────────────────────────────
const FORTUNES_BY_RELATION = {
    six_harmony: [
        '육합(六合)의 길운으로 뜻밖의 귀인을 만나 도움을 받고 오랫동안 고민하던 일이 순조롭게 풀립니다.',
        '협력과 상생의 기운이 강력하여 대인관계와 계약, 협상에서 큰 이득과 결실을 얻는 날입니다.',
        '마음이 맞는 조력자를 만나 큰 힘을 얻으며 추진 중인 일에 날개를 달게 됩니다.',
    ],
    three_harmony: [
        '삼합(三合)의 대길운이 형성되어 막힘없이 에너지가 솟구치며 주변의 신뢰와 인기를 한몸에 받습니다.',
        '재물운과 기회가 동시에 찾아오는 형국으로, 적극적인 실행과 도전이 성공으로 이어집니다.',
        '오랜 노력이 결실을 맺는 시기이며 협동과 팀워크에서 최상의 성과를 달성하게 됩니다.',
    ],
    stem_harmony: [
        '천간합(天干合)의 조화로운 기운으로 매사 순풍에 돛 단 듯 순조롭게 진행되는 하루입니다.',
        '원하던 좋은 소식이 찾아오고 사람들과의 유대와 신뢰가 한층 돈독해집니다.',
    ],
    generating: [
        '오행 상생의 순조로운 흐름으로 매끄러운 진행과 긍정적인 활력이 가득한 하루입니다.',
        '마음이 여유롭고 주변의 지지와 응원을 받으며 한 걸음 더 도약하는 날입니다.',
        '노력한 만큼 정직한 성취와 보람이 따르는 길한 운세입니다.',
    ],
    neutral: [
        '평온하고 안정적인 일진입니다. 서두르지 않고 내실을 다지며 기본에 충실하면 충분합니다.',
        '무리한 변화보다는 현재의 흐름을 차분하게 유지하며 다음 기회를 준비하는 것이 좋습니다.',
        '소소한 일상에서 뜻밖의 기쁨을 발견할 수 있는 하루입니다.',
    ],
    wonjin: [
        '원진의 기운이 스쳐 지나가므로 사소한 오해나 언행의 마찰을 피하고 경청하는 자세가 필요합니다.',
        '감정적인 대응을 삼가고 한 템포 쉬어가는 여유를 가지면 문제없이 무난히 지나갑니다.',
    ],
    clash: [
        '일진과 상충(相沖)하는 기운이 있으니 급격한 변동이나 무리한 확장은 피하고 안전과 신중을 기하세요.',
        '계약이나 금전 거래는 꼼꼼히 재검토하고 이동 및 언행에 주의를 기울이는 것이 현명합니다.',
        '오늘은 큰 결정을 내리기보다 관망하며 내실을 다지는 휴식의 시간으로 삼는 것이 좋습니다.',
    ]
};

// ─── 7. 대상 파싱 및 명리학적 평가 ──────────────────────────────────────────
function parseYear(raw) {
    if (!raw) return null;
    const compact = raw.trim().replace(/\s+/g, '');

    // 1. 8자리 생년월일 또는 YYYY-MM-DD / YYYY.MM.DD / YYYY년 MM월 DD일 형태
    const mDate = compact.match(/^(?:서기)?(19\d{2}|20\d{2})[-./년]?(\d{1,2})[-./월]?(\d{1,2})[일생]?$/);
    if (mDate) {
        return parseInt(mDate[1], 10);
    }

    // 2. 4자리 연도 패턴 (1900~2099): 1995, 1995년, 1995년생, 1995년도, 1995년도생, 1995생 등
    const m4 = compact.match(/^(?:서기)?(19\d{2}|20\d{2})(?:년도생|년도|년생|년|생)?$/);
    if (m4) {
        return parseInt(m4[1], 10);
    }

    // 3. 2자리 연도 패턴 (00~99): 95, 95년, 95년생, 95년도, 95년도생, 95생, 02, 02년, 02년생 등
    const m2 = compact.match(/^(\d{2})(?:년도생|년도|년생|년|생)?$/);
    if (m2) {
        const y2 = parseInt(m2[1], 10);
        const currentYear = new Date().getFullYear();
        const current2Digit = currentYear % 100;
        return y2 <= (current2Digit + 5) ? (2000 + y2) : (1900 + y2);
    }

    return null;
}

function evaluateTarget(rawArg, today) {
    const clean = rawArg.trim();

    // (1) 연도 확인 (4자리, 2자리, xxxx년, xxxx년생, xx년, xx년생, 년도/생/공백 등)
    const year = parseYear(clean);
    if (year !== null) {
        // 출생년도 간지 계산 (연주: 천간 + 지지)
        const yearStemIdx = ((year - 4) % 10 + 10) % 10;
        const yearBranchIdx = ((year - 4) % 12 + 12) % 12;
        const yearStem = STEMS[yearStemIdx];
        const yearBranch = BRANCHES[yearBranchIdx];
        const yearGanji = `${yearStem.hanja}${yearBranch.hanja}(${yearStem.name}${yearBranch.name}년)`;

        let score = 0;
        let relationKey = 'neutral';
        let detailTags = [];

        // 지지 육합 확인
        if (SIX_HARMONIES.some(([a, b]) => (a === yearBranchIdx && b === today.branchIdx) || (b === yearBranchIdx && a === today.branchIdx))) {
            score += 35;
            relationKey = 'six_harmony';
            detailTags.push('육합길운(六合)');
        }
        // 지지 삼합 확인
        else if (THREE_HARMONIES.some(group => group.includes(yearBranchIdx) && group.includes(today.branchIdx))) {
            score += 30;
            relationKey = 'three_harmony';
            detailTags.push('삼합길운(三合)');
        }
        // 지지 상충 확인
        else if (SIX_CLASHES.some(([a, b]) => (a === yearBranchIdx && b === today.branchIdx) || (b === yearBranchIdx && a === today.branchIdx))) {
            score -= 35;
            relationKey = 'clash';
            detailTags.push('일진상충(相沖)');
        }
        // 지지 원진 확인
        else if (WONJIN_PAIRS.some(([a, b]) => (a === yearBranchIdx && b === today.branchIdx) || (b === yearBranchIdx && a === today.branchIdx))) {
            score -= 25;
            relationKey = 'wonjin';
            detailTags.push('원진주의(怨嗔)');
        }
        // 오행 생극
        else {
            if (ELEMENT_RELATIONS[yearBranch.element].generates === today.branch.element ||
                ELEMENT_RELATIONS[today.branch.element].generates === yearBranch.element) {
                score += 15;
                relationKey = 'generating';
                detailTags.push('오행상생(相生)');
            } else if (ELEMENT_RELATIONS[yearBranch.element].overcomes === today.branch.element ||
                       ELEMENT_RELATIONS[today.branch.element].overcomes === yearBranch.element) {
                score -= 15;
                relationKey = 'wonjin';
                detailTags.push('오행상극(相剋)');
            } else {
                score += 5;
                detailTags.push('평온안정');
            }
        }

        // 천간합 확인
        if (STEM_HARMONIES.some(([a, b]) => (a === yearStemIdx && b === today.stemIdx) || (b === yearStemIdx && a === today.stemIdx))) {
            score += 20;
            detailTags.push('천간합(天干合)');
            if (score > 0 && relationKey === 'neutral') relationKey = 'stem_harmony';
        }

        return {
            label: `${year}년생(${yearStem.name}${yearBranch.name}년 ${yearBranch.animal}띠)`,
            zodiacEmoji: yearBranch.emoji + ' ',
            score,
            relationKey,
            detailTag: detailTags.join(' · '),
            element: yearBranch.element,
            seed: `YEAR_${year}`
        };
    }

    // (2) 12별자리 확인
    const constNorm = clean.toLowerCase();
    const constName = CONSTELLATIONS[clean] ? clean : CONSTELLATION_ALIASES[constNorm];
    if (constName && CONSTELLATIONS[constName]) {
        const c = CONSTELLATIONS[constName];
        let score = 0;
        let relationKey = 'neutral';
        let detailTags = [`${c.element}원소`];

        // 일진 오행과 서양 4대 원소 조화도
        // 동양 오행(목,화,토,금,수)과 서양 4대 원소(불, 흙, 공기, 물) 매핑
        const todayElement = today.branch.element;
        if (c.element === '불') {
            if (todayElement === '목' || todayElement === '화') { score += 30; relationKey = 'three_harmony'; detailTags.push('화기충만(대길)'); }
            else if (todayElement === '수') { score -= 35; relationKey = 'clash'; detailTags.push('수화상극(주의)'); }
            else { score += 10; relationKey = 'generating'; detailTags.push('순항'); }
        } else if (c.element === '물') {
            if (todayElement === '금' || todayElement === '수') { score += 30; relationKey = 'six_harmony'; detailTags.push('수기원활(대길)'); }
            else if (todayElement === '토' || todayElement === '화') { score -= 30; relationKey = 'clash'; detailTags.push('토수극(주의)'); }
            else { score += 10; relationKey = 'generating'; detailTags.push('조화'); }
        } else if (c.element === '흙') {
            if (todayElement === '화' || todayElement === '토') { score += 30; relationKey = 'three_harmony'; detailTags.push('토기안정(대길)'); }
            else if (todayElement === '목') { score -= 25; relationKey = 'wonjin'; detailTags.push('목극토(신중)'); }
            else { score += 10; relationKey = 'generating'; detailTags.push('결실'); }
        } else if (c.element === '공기') {
            if (todayElement === '수' || todayElement === '목') { score += 25; relationKey = 'six_harmony'; detailTags.push('풍기유연(대길)'); }
            else if (todayElement === '금') { score -= 20; relationKey = 'wonjin'; detailTags.push('금기긴장(주의)'); }
            else { score += 10; relationKey = 'generating'; detailTags.push('소통'); }
        }

        return {
            label: `${c.name}`,
            zodiacEmoji: c.emoji + ' ',
            score,
            relationKey,
            detailTag: detailTags.join(' · '),
            element: c.element,
            seed: `CONST_${c.name}`
        };
    }

    // (3) 12지신 띠 확인
    let branchIdx = null;
    if (ZODIAC_NAME_TO_IDX[clean] !== undefined) {
        branchIdx = ZODIAC_NAME_TO_IDX[clean];
    } else if (ZODIAC_ALIASES[clean] !== undefined) {
        branchIdx = ZODIAC_ALIASES[clean];
    }

    if (branchIdx !== null) {
        const userBranch = BRANCHES[branchIdx];
        let score = 0;
        let relationKey = 'neutral';
        let detailTags = [];

        // 지지 육합
        if (SIX_HARMONIES.some(([a, b]) => (a === branchIdx && b === today.branchIdx) || (b === branchIdx && a === today.branchIdx))) {
            score += 35;
            relationKey = 'six_harmony';
            detailTags.push('육합길운(六合)');
        }
        // 지지 삼합
        else if (THREE_HARMONIES.some(group => group.includes(branchIdx) && group.includes(today.branchIdx))) {
            score += 30;
            relationKey = 'three_harmony';
            detailTags.push('삼합길운(三合)');
        }
        // 지지 상충
        else if (SIX_CLASHES.some(([a, b]) => (a === branchIdx && b === today.branchIdx) || (b === branchIdx && a === today.branchIdx))) {
            score -= 35;
            relationKey = 'clash';
            detailTags.push('일진상충(相沖)');
        }
        // 지지 원진
        else if (WONJIN_PAIRS.some(([a, b]) => (a === branchIdx && b === today.branchIdx) || (b === branchIdx && a === today.branchIdx))) {
            score -= 25;
            relationKey = 'wonjin';
            detailTags.push('원진주의(怨嗔)');
        }
        // 오행 상생/상극
        else {
            if (ELEMENT_RELATIONS[userBranch.element].generates === today.branch.element ||
                ELEMENT_RELATIONS[today.branch.element].generates === userBranch.element) {
                score += 15;
                relationKey = 'generating';
                detailTags.push('오행상생(相生)');
            } else if (ELEMENT_RELATIONS[userBranch.element].overcomes === today.branch.element ||
                       ELEMENT_RELATIONS[today.branch.element].overcomes === userBranch.element) {
                score -= 15;
                relationKey = 'wonjin';
                detailTags.push('오행상극(相剋)');
            } else {
                score += 5;
                detailTags.push('비견평온');
            }
        }

        return {
            label: `${userBranch.animal}띠`,
            zodiacEmoji: userBranch.emoji + ' ',
            score,
            relationKey,
            detailTag: detailTags.join(' · '),
            element: userBranch.element,
            seed: `ZODIAC_${userBranch.animal}`
        };
    }

    // (4) 일반 이름 (한글 초성 발음오행 성명학)
    const nameElement = getHangulElement(clean);
    let score = 0;
    let relationKey = 'neutral';
    let detailTags = [`발음오행(${nameElement})`];

    if (ELEMENT_RELATIONS[nameElement].generates === today.branch.element ||
        ELEMENT_RELATIONS[today.branch.element].generates === nameElement) {
        score += 20;
        relationKey = 'generating';
        detailTags.push('오행상생');
    } else if (ELEMENT_RELATIONS[nameElement].overcomes === today.branch.element ||
               ELEMENT_RELATIONS[today.branch.element].overcomes === nameElement) {
        score -= 20;
        relationKey = 'wonjin';
        detailTags.push('오행상극');
    } else {
        score += 5;
        detailTags.push('안정');
    }

    return {
        label: `${clean}님`,
        zodiacEmoji: '🔮 ',
        score,
        relationKey,
        detailTag: detailTags.join(' · '),
        element: nameElement,
        seed: `NAME_${clean}`
    };
}

// ─── 8. 행운의 요소 (용신/희신 오행 기반) ───────────────────────────────────
const ELEMENT_LUCK_ITEMS = {
    '목': { color: '초록색', num: 3, dir: '동쪽' },
    '화': { color: '빨강색', num: 7, dir: '남쪽' },
    '토': { color: '노랑색', num: 5, dir: '중앙' },
    '금': { color: '흰색', num: 9, dir: '서쪽' },
    '수': { color: '파랑색', num: 1, dir: '북쪽' },
    '불': { color: '주황색', num: 2, dir: '남쪽' },
    '물': { color: '하늘색', num: 6, dir: '북쪽' },
    '흙': { color: '갈색', num: 10, dir: '중앙' },
    '공기': { color: '보라색', num: 8, dir: '동남쪽' },
};

function getLuckyAttributes(target, today) {
    // 나를 생해주는 오행(희신) 또는 당일 조화 오행
    let targetElem = target.element;
    let luckAttr = ELEMENT_LUCK_ITEMS[targetElem] || ELEMENT_LUCK_ITEMS['토'];
    return luckAttr;
}

// ─── 9. 정통 운세 생성 메인 함수 ─────────────────────────────────────────────
function generateFortune(rawArg) {
    const today = getTodayIljin();
    const target = evaluateTarget(rawArg, today);

    // 점수에 따른 운 등급 결정
    let luck;
    if (target.score >= 25) {
        luck = { star: '★★★★★', label: '대길(大吉)', color: '🌟' };
    } else if (target.score >= 10) {
        luck = { star: '★★★★☆', label: '길(吉)', color: '⭐' };
    } else if (target.score >= -10) {
        luck = { star: '★★★☆☆', label: '보통', color: '🌙' };
    } else if (target.score >= -25) {
        luck = { star: '★★☆☆☆', label: '주의', color: '⚠️' };
    } else {
        luck = { star: '★☆☆☆☆', label: '흉(凶)', color: '🌧️' };
    }

    // 명리학적 풀이 텍스트 선택
    const pool = FORTUNES_BY_RELATION[target.relationKey] || FORTUNES_BY_RELATION['neutral'];
    // 날짜+시드 기반 해시로 동일한 날 동일 대상에 일관된 텍스트 선택
    let hash = 0;
    const str = `${today.seedBase}|${target.seed}`;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
    const fortuneText = pool[Math.abs(hash) % pool.length];

    const luckAttr = getLuckyAttributes(target, today);

    return {
        label: target.label,
        zodiacEmoji: target.zodiacEmoji,
        iljin: today.ganjiStr,
        detailTag: target.detailTag,
        luck,
        fortuneText,
        luckyColor: luckAttr.color,
        luckyNumber: luckAttr.num,
        luckyDir: luckAttr.dir
    };
}

module.exports = {
    name: 'fortune',
    group: 'fortune',
    icon: '🔮',
    aliases: ['!운세', '!사주', '!오늘운세', '!fortune', '!호로스코프'],
    description: '정통 만세력 일진 및 명리학/점성술 기반 오늘의 운세 조회',

    web: {
        title: '오늘의 운세 (만세력)',
        icon: '🔮',
        description: '만세력 일진(오늘의 간지)과 12지신(띠), 출생연도(생년 간지), 12별자리(4대 원소) 상생/상극/합충 기반 오늘의 운세를 조회합니다.',
        category: 'Commands',
        badge: 'Command'
    },

    async execute({ cmd, args, displayName, _input, ctx }) {
        const rawArg = (args && args.length > 0 && typeof args[0] === 'string')
            ? args.join(' ').trim()
            : '';

        // args 없음 → 경고
        if (!rawArg) {
            const usageMsg = msg.fortune && msg.fortune.missing_target
                ? msg.fortune.missing_target
                : `⚠️ 이름, 띠, 별자리 또는 출생연도를 입력하세요. (예: !운세 홍길동, !운세 호랑이, !운세 사자자리, !운세 1995년생)`;
            return ctx.returnWarning(usageMsg, cmd, _input);
        }

        // 입력값 안전 제한 (100자 초과 시 차단)
        if (rawArg.length > 100) {
            return ctx.returnWarning('⚠️ 입력값이 너무 깁니다. (100자 이내로 입력해 주세요)', cmd, _input);
        }

        ctx.setCooldown(cmd, 0, _input);
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        const f = generateFortune(rawArg);

        if (msg.fortune && msg.fortune.result) {
            return msg.fortune.result(f, cooldownMsg);
        }

        const tagStr = f.detailTag ? ` (${f.detailTag})` : '';
        return `${f.zodiacEmoji}[${f.label} 오늘의 운세 · ${f.iljin}] ${f.luck.color} ${f.luck.star} ${f.luck.label}${tagStr} | ${f.fortuneText} | 🍀 행운색: ${f.luckyColor} / 행운수: ${f.luckyNumber} / 행운방향: ${f.luckyDir} ${cooldownMsg}`.trim();
    }
};
