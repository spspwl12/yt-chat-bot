const CHOSUNG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const JUNGSUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONGSUNG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

// charCode/jamo -> small integer id
const JAMO_ID = new Map();
let _nextId = 1;
function _regId(ch) {
    if (!JAMO_ID.has(ch)) JAMO_ID.set(ch, _nextId++);
    return JAMO_ID.get(ch);
}
const CHO_IDS = CHOSUNG.map(_regId);
const JUNG_IDS = JUNGSUNG.map(_regId);
const JONG_IDS = JONGSUNG.map(c => c ? _regId(c) : 0);

/** 문자열 -> 자모 id Int32Array */
function getJamoIds(str) {
    const buf = new Int32Array(str.length * 3);
    let p = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code >= 0xAC00 && code <= 0xD7A3) {
            const c = code - 0xAC00;
            buf[p++] = CHO_IDS[(c / 588) | 0];
            buf[p++] = JUNG_IDS[((c % 588) / 28) | 0];
            const jo = JONG_IDS[c % 28];
            if (jo) buf[p++] = jo;
        } else {
            let id = JAMO_ID.get(code);
            if (id === undefined) { id = _nextId++; JAMO_ID.set(code, id); }
            buf[p++] = id;
        }
    }
    return buf.subarray(0, p);
}

/** 문자열 -> charCode Int32Array */
function getCharIds(str) {
    const buf = new Int32Array(str.length);
    for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
    return buf;
}

/** Int32Array에서 bloom filter(32-bit) 계산 */
function computeBloom(arr) {
    let b = 0;
    for (let i = 0; i < arr.length; i++) b |= (1 << (arr[i] & 31));
    return b >>> 0;
}

// DP 버퍼 (재사용)
let _prev = new Int32Array(2048);
let _curr = new Int32Array(2048);
function _ensureDP(size) {
    if (_prev.length < size) {
        const n = 1 << Math.ceil(Math.log2(size));
        _prev = new Int32Array(n);
        _curr = new Int32Array(n);
    }
}

// 결합 타겟(t2) 버퍼 (재사용)
let _t2buf = new Int32Array(4096);
function _getCombined(a, b) {
    const need = a.length + b.length;
    if (_t2buf.length < need) {
        const n = 1 << Math.ceil(Math.log2(need));
        _t2buf = new Int32Array(n);
    }
    _t2buf.set(a, 0);
    _t2buf.set(b, a.length);
    return _t2buf.subarray(0, need);
}

/**
 * q가 t의 부분문자열로 매칭될 때 최소 편집거리.
 * maxDist 초과가 확실해지면 조기 종료 (maxDist+1 반환).
 */
function substringDistance(q, t, maxDist) {
    const qLen = q.length, tLen = t.length;
    if (qLen === 0) return 0;
    if (tLen === 0) return qLen <= maxDist ? qLen : maxDist + 1;
    if (maxDist === undefined || maxDist < 0) maxDist = qLen;

    _ensureDP(tLen + 1);
    let prev = _prev, curr = _curr;

    for (let j = 0; j <= tLen; j++) prev[j] = 0;

    for (let i = 1; i <= qLen; i++) {
        curr[0] = i;
        const qc = q[i - 1];
        let rowMin = curr[0];
        for (let j = 1; j <= tLen; j++) {
            const cost = qc === t[j - 1] ? 0 : 1;
            const a = prev[j - 1] + cost;
            const b = curr[j - 1] + 1;
            const c = prev[j] + 1;
            let v = a < b ? a : b;
            if (c < v) v = c;
            curr[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > maxDist) {
            _prev = prev; _curr = curr;
            return maxDist + 1;
        }
        const tmp = prev; prev = curr; curr = tmp;
    }

    let globalMin = qLen;
    for (let j = 0; j <= tLen; j++) if (prev[j] < globalMin) globalMin = prev[j];
    _prev = prev; _curr = curr;
    return globalMin;
}

/** Int32Array 부분수열 포함 여부 */
function arrIncludes(hay, needle) {
    const hLen = hay.length, nLen = needle.length;
    if (nLen === 0) return true;
    if (nLen > hLen) return false;
    const first = needle[0];
    const end = hLen - nLen;
    outer: for (let i = 0; i <= end; i++) {
        if (hay[i] !== first) continue;
        for (let j = 1; j < nLen; j++) {
            if (hay[i + j] !== needle[j]) continue outer;
        }
        return true;
    }
    return false;
}

/** id 배열 해시 키 (dedup용) */
function idsHash(arr) {
    let h = 2166136261 | 0;
    for (let i = 0; i < arr.length; i++) {
        h ^= arr[i];
        h = Math.imul(h, 16777619);
    }
    return h + ':' + arr.length;
}

// ── 스코어링 상수 ──
const CHAR_EXACT_SCORE = 100;  // Tier 1: 글자 완전 포함
const CHAR_FUZZY_CAP   = 85;  // Tier 2: 글자 퍼지 매칭 상한
const JAMO_CAP         = 60;  // Tier 3: 자모 매칭 상한
const THRESHOLD        = 30;  // 결과 포함 최소 점수

class KoreanSubSearchEngine {
    constructor(data) {
        this.sentences = [];
        for (const key in data) {
            for (const sub of data[key]) {
                const cleanText = sub.text.toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
                if (!cleanText) continue;
                const jamo = getJamoIds(cleanText);
                const charIds = getCharIds(cleanText);
                this.sentences.push({
                    key,
                    index: sub.index,
                    text: sub.text,
                    clean: cleanText,
                    charIds,
                    charBloom: computeBloom(charIds),
                    jamo,
                    bloom: computeBloom(jamo)
                });
            }
        }
        // 같은 key의 다음 문장 인덱스
        const n = this.sentences.length;
        this._nextSameKey = new Int32Array(n);
        for (let i = 0; i < n; i++) {
            this._nextSameKey[i] = (i + 1 < n && this.sentences[i + 1].key === this.sentences[i].key) ? i + 1 : -1;
        }
    }

    search(query) {
        const cleanQ = query.toLowerCase().replace(/[^가-힣a-z0-9\s]/g, '').trim();
        if (!cleanQ) return [];

        const qNoSpace = cleanQ.replace(/\s+/g, '');

        // ── 자모 데이터 ──
        const qFull = getJamoIds(qNoSpace);
        if (qFull.length === 0) return [];
        const qFullBloom = computeBloom(qFull);
        const qFullLen = qFull.length;

        // 단어별 자모
        const words = cleanQ.split(/\s+/).filter(w => w);
        const qWords = [];
        const qWordBlooms = [];
        const wordSeen = new Set();
        for (const w of words) {
            const wj = getJamoIds(w);
            if (wj.length === 0) continue;
            const wk = idsHash(wj);
            if (wordSeen.has(wk)) continue;
            wordSeen.add(wk);
            qWords.push(wj);
            qWordBlooms.push(computeBloom(wj));
        }

        // ── 글자 데이터 ──
        const qCharIds = getCharIds(qNoSpace);
        const qCharBloom = computeBloom(qCharIds);
        const qCharLen = qCharIds.length;

        // 단어별 글자
        const qCharWords = [];
        const qCharWordBlooms = [];
        for (const w of words) {
            const wc = getCharIds(w);
            if (wc.length === 0) continue;
            qCharWords.push(wc);
            qCharWordBlooms.push(computeBloom(wc));
        }

        // ── 최대 편집거리 ──
        // Tier 2 (글자): score > THRESHOLD 조건에서 역산
        const charMaxDist = Math.max(1, Math.floor(qCharLen * 0.4));
        const charWordMaxDist = qCharWords.map(w => Math.max(1, Math.floor(w.length * 0.35)));

        // Tier 3 (자모)
        const jamoMaxDist = Math.floor(qFullLen * 0.4666) + 1;
        const jamoWordMaxDist = qWords.map(w => Math.floor(w.length * 0.4666) + 1);

        // ── Tier 2 글자 퍼지 스코어 계산 ──
        const computeCharScore = (target, targetBloom) => {
            let fullScore = 0;
            if ((targetBloom & qCharBloom) === qCharBloom || target.length >= qCharLen * 0.3) {
                const d = substringDistance(qCharIds, target, charMaxDist);
                if (d <= charMaxDist) {
                    fullScore = Math.max(0, qCharLen - d * 1.5);
                }
            }

            let wordSum = 0;
            for (let wi = 0; wi < qCharWords.length; wi++) {
                const wc = qCharWords[wi];
                const wb = qCharWordBlooms[wi];
                if ((targetBloom & wb) !== wb) continue;
                const wd = substringDistance(wc, target, charWordMaxDist[wi]);
                if (wd <= charWordMaxDist[wi]) {
                    wordSum += Math.max(0, wc.length - wd * 1.5);
                }
            }

            let raw = fullScore;
            if (wordSum > fullScore) {
                raw = fullScore + (wordSum - fullScore) * 0.7;
            }
            const lengthPenalty = Math.min(15, Math.max(0, target.length - qCharLen * 3) * 0.15);
            let sc = Math.round((raw / qCharLen) * CHAR_FUZZY_CAP - lengthPenalty);
            if (sc > CHAR_FUZZY_CAP) sc = CHAR_FUZZY_CAP;
            if (sc < 0) sc = 0;
            return sc;
        };

        // ── Tier 3 자모 퍼지 스코어 계산 ──
        const computeJamoScore = (target, targetBloom) => {
            let fullScore = 0;
            if ((targetBloom & qFullBloom) === qFullBloom || target.length >= qFullLen * 0.3) {
                const d = substringDistance(qFull, target, jamoMaxDist);
                if (d <= jamoMaxDist) {
                    fullScore = Math.max(0, qFullLen - d * 1.5);
                }
            }

            let wordSum = 0;
            for (let wi = 0; wi < qWords.length; wi++) {
                const wArr = qWords[wi];
                const wBloom = qWordBlooms[wi];
                if ((targetBloom & wBloom) !== wBloom) continue;
                const wd = substringDistance(wArr, target, jamoWordMaxDist[wi]);
                if (wd <= jamoWordMaxDist[wi]) {
                    wordSum += Math.max(0, wArr.length - wd * 1.5);
                }
            }

            let raw = fullScore;
            if (wordSum > fullScore) {
                raw = fullScore + (wordSum - fullScore) * 0.7;
            }
            const lengthPenalty = Math.min(15, Math.max(0, target.length - qFullLen * 3) * 0.15);
            let sc = Math.round((raw / qFullLen) * JAMO_CAP - lengthPenalty);
            if (sc > JAMO_CAP) sc = JAMO_CAP;
            if (sc < 0) sc = 0;
            return sc;
        };

        const resultsMap = new Map();
        const sentences = this.sentences;
        const nextSameKey = this._nextSameKey;
        const sLen = sentences.length;

        for (let i = 0; i < sLen; i++) {
            const s = sentences[i];
            let bestScore = 0;

            // ===== Tier 1: 글자 완전 포함 =====
            if (qCharLen <= s.clean.length && s.clean.includes(qNoSpace)) {
                bestScore = CHAR_EXACT_SCORE;
            }

            // ===== Tier 2: 글자 퍼지 매칭 =====
            if (bestScore < CHAR_EXACT_SCORE) {
                const cs = computeCharScore(s.charIds, s.charBloom);
                if (cs > bestScore) bestScore = cs;
            }

            // ===== Tier 3: 자모 매칭 (capped) =====
            if (bestScore < JAMO_CAP) {
                // 자모 완전 포함
                if ((s.bloom & qFullBloom) === qFullBloom && qFullLen <= s.jamo.length) {
                    if (arrIncludes(s.jamo, qFull)) {
                        bestScore = JAMO_CAP;
                    }
                }
                // 자모 퍼지
                if (bestScore < JAMO_CAP) {
                    const js = computeJamoScore(s.jamo, s.bloom);
                    if (js > bestScore) bestScore = js;
                }
            }

            // ===== 결합 문장 (다음 문장과 합쳐서 검사) =====
            if (bestScore < CHAR_EXACT_SCORE) {
                const ni = nextSameKey[i];
                if (ni !== -1) {
                    const nxt = sentences[ni];

                    // Tier 1 결합: 글자 완전 포함
                    if (bestScore < CHAR_EXACT_SCORE) {
                        const combined = s.clean + nxt.clean;
                        if (combined.includes(qNoSpace)) {
                            bestScore = CHAR_EXACT_SCORE;
                        }
                    }

                    // Tier 2 결합: 글자 퍼지
                    if (bestScore < CHAR_FUZZY_CAP) {
                        const t2c = _getCombined(s.charIds, nxt.charIds);
                        const cb = s.charBloom | nxt.charBloom;
                        const cs2 = computeCharScore(t2c, cb);
                        if (cs2 > bestScore) bestScore = cs2;
                    }

                    // Tier 3 결합: 자모
                    if (bestScore < JAMO_CAP) {
                        const combinedBloom = s.bloom | nxt.bloom;
                        if ((combinedBloom & qFullBloom) === qFullBloom) {
                            const t2j = _getCombined(s.jamo, nxt.jamo);
                            if (arrIncludes(t2j, qFull)) {
                                bestScore = JAMO_CAP;
                            } else {
                                const js2 = computeJamoScore(t2j, combinedBloom);
                                if (js2 > bestScore) bestScore = js2;
                            }
                        }
                    }
                }
            }

            if (bestScore > THRESHOLD) {
                const existing = resultsMap.get(s.key);
                if (existing) {
                    existing.matchedIndices.push(s.index);
                    if (bestScore > existing.score) existing.score = bestScore;
                } else {
                    resultsMap.set(s.key, {
                        key: s.key,
                        score: bestScore,
                        matchedIndices: [s.index],
                    });
                }
            }
        }

        for (const res of resultsMap.values()) {
            if (res.score < CHAR_EXACT_SCORE) {
                const matchBonus = Math.min(10, Math.floor((res.matchedIndices.length - 1) * 0.4));
                res.score = Math.min(CHAR_FUZZY_CAP, res.score + matchBonus);
            }
        }

        const results = Array.from(resultsMap.values());
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, 50);
    }
}

module.exports = KoreanSubSearchEngine;