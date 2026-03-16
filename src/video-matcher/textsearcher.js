const Fuse = require('fuse.js');

// ─── 한글 유니코드 상수 ─────────────────────────────────────
const HANGUL_START = 0xAC00;
const HANGUL_END = 0xD7A3;
const JUNG_COUNT = 21;
const JONG_COUNT = 28;

const CHO_LIST = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG_LIST = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG_LIST = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

// ─── 한글 분해 유틸 ──────────────────────────────────────────

function isHangulSyllable(ch) {
    const code = ch.charCodeAt(0);
    return code >= HANGUL_START && code <= HANGUL_END;
}

function decompose(ch) {
    const code = ch.charCodeAt(0) - HANGUL_START;
    const cho = Math.floor(code / (JUNG_COUNT * JONG_COUNT));
    const jung = Math.floor((code % (JUNG_COUNT * JONG_COUNT)) / JONG_COUNT);
    const jong = code % JONG_COUNT;
    return { cho, jung, jong };
}

function toJamo(str) {
    let result = '';
    for (const ch of str) {
        if (isHangulSyllable(ch)) {
            const d = decompose(ch);
            result += CHO_LIST[d.cho] + JUNG_LIST[d.jung];
            if (d.jong > 0) result += JONG_LIST[d.jong];
        } else {
            result += ch;
        }
    }
    return result;
}

// ─── 발음 정규화 (연음/거센소리/ㅎ탈락) ─────────────────────

const JONG_TO_CHO = {
    1: 0, 2: 1, 4: 2, 7: 3, 8: 5, 16: 6, 17: 7,
    19: 9, 20: 10, 21: 11, 22: 12, 23: 14, 24: 15, 25: 16, 26: 17, 27: 18,
};

const DOUBLE_JONG = {
    3: [1, 9], 5: [4, 12], 6: [4, 18],
    9: [8, 0], 10: [8, 6], 11: [8, 7], 12: [8, 9], 13: [8, 16], 14: [8, 17], 15: [8, 18],
    18: [17, 9],
};

const H_ASPIRATE = { 0: 15, 3: 16, 7: 16, 12: 14 };

function toPronunciationJamo(str) {
    const chars = [...str];
    const syllables = [];

    for (const ch of chars) {
        if (isHangulSyllable(ch)) {
            const d = decompose(ch);
            syllables.push({ cho: d.cho, jung: d.jung, jong: d.jong });
        } else {
            syllables.push({ raw: ch });
        }
    }

    for (let i = 0; i < syllables.length - 1; i++) {
        const curr = syllables[i];
        const next = syllables[i + 1];
        if (curr.jong === undefined || curr.jong === 0) continue;
        if (next.cho === undefined) continue;

        const isNextSilent = (next.cho === 11);

        if (DOUBLE_JONG[curr.jong]) {
            const [frontJong, backCho] = DOUBLE_JONG[curr.jong];
            if (isNextSilent) {
                curr.jong = frontJong;
                next.cho = backCho;
                continue;
            }
        }

        if (isNextSilent) {
            const choIdx = JONG_TO_CHO[curr.jong];
            if (choIdx !== undefined) {
                next.cho = choIdx;
                curr.jong = 0;
            }
        } else if (curr.jong === 27) {
            const aspirated = H_ASPIRATE[next.cho];
            if (aspirated !== undefined) {
                next.cho = aspirated;
                curr.jong = 0;
            } else if (next.cho === 11) {
                curr.jong = 0;
            }
        } else if (next.cho === 18 && JONG_TO_CHO[curr.jong] !== undefined) {
            const choOfJong = JONG_TO_CHO[curr.jong];
            const aspirated = H_ASPIRATE[choOfJong];
            if (aspirated !== undefined) {
                next.cho = aspirated;
                curr.jong = 0;
            }
        }
    }

    let result = '';
    for (const s of syllables) {
        if (s.raw !== undefined) {
            result += s.raw;
        } else {
            result += CHO_LIST[s.cho] + JUNG_LIST[s.jung];
            if (s.jong > 0) result += JONG_LIST[s.jong];
        }
    }
    return result;
}

// ─── N-gram 유사도 유틸 ─────────────────────────────────────

function ngramCoverage(query, target, n) {
    if (query.length < n) return query.length > 0 && target.includes(query) ? 1 : 0;
    let total = 0, hits = 0;
    for (let i = 0; i <= query.length - n; i++) {
        total++;
        if (target.includes(query.substring(i, i + n))) hits++;
    }
    return total === 0 ? 0 : hits / total;
}

function getNgrams(str, n) {
    const ngrams = new Set();
    for (let i = 0; i <= str.length - n; i++) {
        ngrams.add(str.substring(i, i + n));
    }
    return ngrams;
}

function ngramSimilarity(a, b, n = 2) {
    if (a.length < n || b.length < n) {
        if (a.length === 0 || b.length === 0) return 0;
        return a === b ? 1 : 0;
    }
    const ngramsA = getNgrams(a, n);
    const ngramsB = getNgrams(b, n);
    let intersection = 0;
    for (const ng of ngramsA) {
        if (ngramsB.has(ng)) intersection++;
    }
    const union = ngramsA.size + ngramsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

// ─── 토큰 커버리지 (문자+자모+발음 3중) ────────────────────

function tokenCoverage(token, target) {
    if (token.length <= 1) return target.includes(token) ? 1 : 0;

    const charCov2 = ngramCoverage(token, target, 2);
    const charCov3 = ngramCoverage(token, target, 3);
    const charScore = charCov2 * 0.4 + charCov3 * 0.6;

    const jamoToken = toJamo(token);
    const jamoTarget = toJamo(target);
    const jamoCov3 = ngramCoverage(jamoToken, jamoTarget, 3);
    const jamoCov4 = ngramCoverage(jamoToken, jamoTarget, 4);
    const jamoScore = jamoCov3 * 0.4 + jamoCov4 * 0.6;

    const pronToken = toPronunciationJamo(token);
    const pronTarget = toPronunciationJamo(target);
    const pronCov3 = ngramCoverage(pronToken, pronTarget, 3);
    const pronCov4 = ngramCoverage(pronToken, pronTarget, 4);
    const pronScore = pronCov3 * 0.4 + pronCov4 * 0.6;

    return Math.max(charScore, jamoScore, pronScore);
}

// ─── 텍스트 유사도 (통합) ───────────────────────────────────

function normalizeText(text) {
    return text.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '').toLowerCase();
}

// 문자열 내 부분문자열 등장 횟수
function countOccurrences(str, sub) {
    let count = 0, pos = 0;
    while ((pos = str.indexOf(sub, pos)) !== -1) {
        count++;
        pos += 1;
    }
    return count;
}

function textSimilarity(query, target) {
    const normQ = normalizeText(query);
    const normT = normalizeText(target);
    if (normQ === normT) return 1.0;
    if (normQ.length === 0 || normT.length === 0) return 0;

    const jamoQ = toJamo(normQ);
    const jamoT = toJamo(normT);
    const pronQ = toPronunciationJamo(normQ);
    const pronT = toPronunciationJamo(normT);

    // 1. 문자 n-gram 커버리지
    const charCov = (ngramCoverage(normQ, normT, 2) * 0.25)
        + (ngramCoverage(normQ, normT, 3) * 0.35)
        + (ngramCoverage(normQ, normT, 4) * 0.40);

    // 2. 자모 n-gram 커버리지
    const jamoCov = (ngramCoverage(jamoQ, jamoT, 3) * 0.3)
        + (ngramCoverage(jamoQ, jamoT, 4) * 0.35)
        + (ngramCoverage(jamoQ, jamoT, 5) * 0.35);

    // 3. 발음 자모 n-gram 커버리지
    const pronCov = (ngramCoverage(pronQ, pronT, 3) * 0.3)
        + (ngramCoverage(pronQ, pronT, 4) * 0.35)
        + (ngramCoverage(pronQ, pronT, 5) * 0.35);

    const overallCoverage = Math.max(charCov, jamoCov, pronCov);

    // 4. 토큰별 AND 매칭
    const rawTokens = query.split(/[\s,.!?;:·\-—–'"()\[\]{}<>\/\\…]+/).filter(Boolean);
    const tokens = rawTokens.map(t => normalizeText(t)).filter(t => t.length >= 2);

    let andScore = overallCoverage;
    let tokenInclusionBonus = 0;

    if (tokens.length >= 2) {
        const perToken = tokens.map(t => tokenCoverage(t, normT));
        const maxCov = Math.max(...perToken);
        const avgCov = perToken.reduce((a, b) => a + b, 0) / perToken.length;

        // 핵심 키워드 매칭 우선 (maxCov 가중치 높임)
        andScore = (maxCov * 0.5) + (avgCov * 0.5);

        // 개별 토큰이 타겟에 포함되면 보너스 (핵심 키워드 매칭)
        for (const t of tokens) {
            if (t.length >= 2 && normT.includes(t)) {
                const bonus = Math.min(0.4, 0.15 + t.length * 0.05);
                tokenInclusionBonus = Math.max(tokenInclusionBonus, bonus);
            }
        }
    } else if (tokens.length === 1) {
        andScore = tokenCoverage(tokens[0], normT);
        if (tokens[0].length >= 2 && normT.includes(tokens[0])) {
            tokenInclusionBonus = Math.min(0.4, 0.15 + tokens[0].length * 0.05);
        }
    }

    // 5. 전체 포함 보너스
    let containsBonus = 0;
    if (normQ.length >= 2 && normT.includes(normQ)) containsBonus = 0.3;

    // 6. Jaccard bigram
    const bigramSim = ngramSimilarity(normQ, normT, 2);

    // 7. 키워드 반복 페널티: 쿼리에서 N번 등장하는 키워드가 타겟에서 N번 미만이면 감점
    let repetitionPenalty = 1.0;
    for (const t of tokens) {
        if (t.length >= 2) {
            const qCount = countOccurrences(normQ, t);
            const tCount = countOccurrences(normT, t);
            if (qCount > 1 && tCount < qCount) {
                repetitionPenalty = Math.min(repetitionPenalty,
                    0.5 + 0.5 * tCount / qCount);
            }
        }
    }

    const combined = (andScore * 0.45) + (overallCoverage * 0.15) + (bigramSim * 0.10)
        + containsBonus + tokenInclusionBonus;
    return Math.min(combined * repetitionPenalty, 1.0);
}

// ─── SearchEngine 클래스 ────────────────────────────────────

class SearchEngine {
    constructor(data) {
        this.originalData = data;
        this.processedData = this.preprocessData(data);
        this.initializeFuse();
    }

    preprocessData(data) {
        const processed = [];
        const sortedKeys = Object.keys(data).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        for (const key of sortedKeys) {
            const items = data[key];

            const itemsWithNormalized = items.map(item => ({
                index: item.index,
                originalText: item.text,
                normalizedText: normalizeText(item.text)
            }));

            const combinedNormalized = itemsWithNormalized.map(i => i.normalizedText).join('');
            const individualTexts = itemsWithNormalized.map(i => i.normalizedText);

            processed.push({
                key,
                combinedText: combinedNormalized,
                items: itemsWithNormalized,
                individualTexts
            });
        }

        return processed;
    }

    initializeFuse() {
        this.fuseCombined = new Fuse(this.processedData, {
            keys: ['combinedText'],
            includeScore: true,
            includeMatches: true,
            threshold: 0.4,
            distance: 1000,
            minMatchCharLength: 2,
            ignoreLocation: true,
            findAllMatches: true
        });
    }

    // ─── 개별 아이템에서 매칭된 인덱스 찾기 (textSimilarity 기반) ──

    findMatchedIndices(items, searchQuery) {
        const matchedResults = [];

        for (const item of items) {
            // textSimilarity로 정밀 점수 계산
            const simScore = textSimilarity(searchQuery, item.originalText);

            if (simScore > 0.1) {
                matchedResults.push({
                    index: item.index,
                    score: Math.round(simScore * 100)
                });
            } else {
                // 폴백: 부분 문자열 매칭
                if (item.normalizedText.includes(normalizeText(searchQuery))) {
                    matchedResults.push({
                        index: item.index,
                        score: Math.round(simScore * 100) || 50
                    });
                }
            }
        }

        return matchedResults;
    }

    // ─── 연속된 텍스트에서 매칭 찾기 ────────────────────────────

    findContinuousMatches(items, query) {
        const matchedIndices = new Set();
        let combinedText = '';
        const indexRanges = [];

        for (const item of items) {
            const start = combinedText.length;
            combinedText += item.normalizedText;
            const end = combinedText.length;
            indexRanges.push({ index: item.index, start, end });
        }

        // 정확한 부분 문자열 매칭
        let searchStart = 0;
        while (true) {
            const pos = combinedText.indexOf(query, searchStart);
            if (pos === -1) break;

            const queryEnd = pos + query.length;
            for (const range of indexRanges) {
                if (pos < range.end && queryEnd > range.start) {
                    matchedIndices.add(range.index);
                }
            }

            searchStart = pos + 1;
        }

        // 자모 기반 퍼지 매칭
        if (matchedIndices.size === 0) {
            const jamoQuery = toJamo(query);
            const jamoCombined = toJamo(combinedText);

            for (let i = 0; i <= jamoCombined.length - jamoQuery.length; i++) {
                let matches = 0;
                for (let j = 0; j < jamoQuery.length; j++) {
                    if (jamoCombined[i + j] === jamoQuery[j]) matches++;
                }
                if (matches / jamoQuery.length >= 0.75) {
                    // 매칭 위치에 해당하는 아이템 인덱스 찾기 (자모 인덱스 → 문자 인덱스 변환 근사)
                    const approxCharPos = Math.floor(i * combinedText.length / jamoCombined.length);
                    const approxCharEnd = Math.floor((i + jamoQuery.length) * combinedText.length / jamoCombined.length);

                    for (const range of indexRanges) {
                        if (approxCharPos < range.end && approxCharEnd > range.start) {
                            matchedIndices.add(range.index);
                        }
                    }
                    break;
                }
            }
        }

        return Array.from(matchedIndices).sort((a, b) => a - b);
    }

    // ─── 메인 검색 ──────────────────────────────────────────────

    search(query) {
        const normalizedQuery = normalizeText(query);

        if (!normalizedQuery) {
            return [];
        }

        // Phase 1: 후보 수집 (Fuse.js + n-gram 커버리지)

        // 1a. Fuse.js 검색
        const combinedResults = this.fuseCombined.search(normalizedQuery);

        // 1b. n-gram 커버리지 기반 추가 후보 (Fuse가 놓칠 수 있는 유사 표현 포착)
        const queryBigrams = [];
        for (let i = 0; i <= normalizedQuery.length - 2; i++) {
            queryBigrams.push(normalizedQuery.substring(i, i + 2));
        }
        const jamoQuery = toJamo(normalizedQuery);
        const jamoTrigrams = [];
        for (let i = 0; i <= jamoQuery.length - 3; i++) {
            jamoTrigrams.push(jamoQuery.substring(i, i + 3));
        }

        const additionalMatches = [];
        if (queryBigrams.length > 0 || jamoTrigrams.length > 0) {
            for (const item of this.processedData) {
                const alreadyFound = combinedResults.some(r => r.item.key === item.key);
                if (alreadyFound) continue;

                // 문자 bigram 히트
                let charHits = 0;
                for (const bg of queryBigrams) {
                    if (item.combinedText.includes(bg)) charHits++;
                }
                const charHitRate = queryBigrams.length > 0 ? charHits / queryBigrams.length : 0;

                // 자모 trigram 히트
                const jamoCombined = toJamo(item.combinedText);
                let jamoHits = 0;
                for (const tg of jamoTrigrams) {
                    if (jamoCombined.includes(tg)) jamoHits++;
                }
                const jamoHitRate = jamoTrigrams.length > 0 ? jamoHits / jamoTrigrams.length : 0;

                const hitRate = Math.max(charHitRate, jamoHitRate);

                if (hitRate >= 0.2) {
                    additionalMatches.push({
                        key: item.key,
                        items: item.items,
                        fuseScore: 1 - hitRate * 0.7 // hitRate를 fuseScore 형태로 변환
                    });
                }
            }
        }

        // 기존 substring/fuzzy 매칭
        const substringMatches = this.processedData.filter(item => {
            const alreadyFound = combinedResults.some(r => r.item.key === item.key);
            if (alreadyFound) return false;
            const alreadyInAdditional = additionalMatches.some(r => r.key === item.key);
            if (alreadyInAdditional) return false;

            return item.combinedText.includes(normalizedQuery);
        });

        // 후보 통합
        const allResults = [
            ...combinedResults.map(r => ({
                key: r.item.key,
                items: r.item.items,
                fuseScore: r.score
            })),
            ...additionalMatches,
            ...substringMatches.map(item => ({
                key: item.key,
                items: item.items,
                fuseScore: 0.3
            }))
        ];

        // Phase 2: textSimilarity 기반 정밀 랭킹

        const finalResults = [];

        for (const result of allResults) {
            const matchedIndicesWithScores = this.findMatchedIndices(
                result.items,
                query
            );

            if (matchedIndicesWithScores.length === 0) {
                const continuousMatches = this.findContinuousMatches(
                    result.items,
                    normalizedQuery
                );

                if (continuousMatches.length > 0) {
                    // 연속 매칭된 아이템의 textSimilarity 최고점 계산
                    let bestSimScore = 0;
                    for (const idx of continuousMatches) {
                        const item = result.items.find(i => i.index === idx);
                        if (item) {
                            const sim = textSimilarity(query, item.originalText);
                            if (sim > bestSimScore) bestSimScore = sim;
                        }
                    }

                    const overallScore = Math.max(
                        Math.round((1 - result.fuseScore) * 100),
                        Math.round(bestSimScore * 100)
                    );

                    finalResults.push({
                        key: result.key,
                        score: Math.min(100, Math.max(1, overallScore)),
                        matchedIndices: continuousMatches
                    });
                }
            } else {
                // 점수별로 그룹화
                const scoreGroups = {};

                for (const match of matchedIndicesWithScores) {
                    if (!scoreGroups[match.score]) {
                        scoreGroups[match.score] = [];
                    }
                    scoreGroups[match.score].push(match.index);
                }

                for (const [score, indices] of Object.entries(scoreGroups)) {
                    finalResults.push({
                        key: result.key,
                        score: parseInt(score),
                        matchedIndices: indices.sort((a, b) => a - b)
                    });
                }
            }
        }

        // Phase 3: textSimilarity로 alpha 재랭킹

        finalResults.forEach(e => {
            if (e.score === 100) {
                e.alpha = 1000;
                return;
            }

            const obj = this.processedData.find(f => f.key === e.key);
            e.alpha = 0;

            e.matchedIndices.forEach(f => {
                const item = obj.items[f - 1];
                if (!item) return;

                const sim = textSimilarity(query, item.originalText);
                const simScore = Math.round(sim * 100);

                if (simScore > e.alpha) e.alpha = simScore;

                // textSimilarity 점수가 기존 score보다 높으면 score도 갱신
                if (simScore > e.score) {
                    e.score = simScore;
                }
            });
        });

        // 정렬: score 내림차순 → alpha 내림차순 → key 순
        finalResults.sort((a, b) => {
            if (b.score !== a.score)
                return b.score - a.score;

            if (b.alpha !== a.alpha)
                return b.alpha - a.alpha;

            return a.key.localeCompare(b.key, undefined, { numeric: true });
        });

        return finalResults;
    }
}

module.exports = SearchEngine;