/**
 * phash.js — Perceptual Hash 모듈
 * DCT 기반 64x64 → 저주파 해시 생성 + Hamming Distance 비교
 *
 * 색상/밝기 변화에 강건한 이유:
 *   1) 그레이스케일 변환 → 색상 채널 제거
 *   2) 픽셀 정규화 (mean 제거 + stddev 나누기) → 밝기/대비 불변
 *   3) DC 성분 제외 → 평균 밝기 불변
 *   4) Dead zone → 노이즈 수준의 작은 계수 무시
 */
const sharp = require('sharp');
const { config } = require('./extractor');

const { resizeWidth, resizeHeight, dctSize, lowFreqSize } = config.phash;

// --- 사전 계산: DCT 계수 테이블 ---
const cosTable = new Float64Array(dctSize * dctSize);
for (let i = 0; i < dctSize; i++) {
  for (let j = 0; j < dctSize; j++) {
    cosTable[i * dctSize + j] = Math.cos(((2 * j + 1) * i * Math.PI) / (2 * dctSize));
  }
}

// --- 사전 계산: popcount 룩업 테이블 (256 엔트리) ---
const POPCOUNT_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  POPCOUNT_LUT[i] = POPCOUNT_LUT[i >> 1] + (i & 1);
}

/**
 * 이미지 버퍼(파일 경로 또는 Buffer)에서 pHash 계산
 * @param {string|Buffer} input - 이미지 파일 경로 또는 Buffer
 * @returns {Promise<string>} hex 해시 문자열
 */
async function computeHash(input) {
  // 1) 64x64 그레이스케일로 리사이즈
  const { data, info } = await sharp(input)
    .resize(resizeWidth, resizeHeight, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const totalPixels = w * h;

  // 2) 정규화: mean 제거 + stddev 나누기
  let mean = 0;
  for (let i = 0; i < totalPixels; i++) mean += data[i];
  mean /= totalPixels;

  let variance = 0;
  for (let i = 0; i < totalPixels; i++) variance += (data[i] - mean) ** 2;
  const stddev = Math.sqrt(variance / totalPixels) || 1;

  const normalized = new Float64Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    normalized[i] = (data[i] - mean) / stddev;
  }

  // 3) 2D DCT 계산 (행 → 열 순서)
  const rowDCT = new Float64Array(h * dctSize);
  for (let y = 0; y < h; y++) {
    for (let u = 0; u < lowFreqSize; u++) {
      let sum = 0;
      for (let x = 0; x < w; x++) {
        sum += normalized[y * w + x] * cosTable[u * dctSize + x];
      }
      rowDCT[y * dctSize + u] = sum;
    }
  }

  const dctMatrix = new Float64Array(lowFreqSize * lowFreqSize);
  for (let u = 0; u < lowFreqSize; u++) {
    for (let v = 0; v < lowFreqSize; v++) {
      let sum = 0;
      for (let y = 0; y < h; y++) {
        sum += rowDCT[y * dctSize + u] * cosTable[v * dctSize + y];
      }
      dctMatrix[v * lowFreqSize + u] = sum;
    }
  }

  // 4) DC 성분 제외, AC 성분만 사용
  const acCount = lowFreqSize * lowFreqSize - 1;
  const acValues = new Float64Array(acCount);
  for (let i = 0; i < acCount; i++) {
    acValues[i] = dctMatrix[i + 1];
  }

  const sorted = Array.from(acValues).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // MAD 기반 dead zone
  const absDeviations = sorted.map(v => Math.abs(v - median));
  absDeviations.sort((a, b) => a - b);
  const mad = absDeviations[Math.floor(absDeviations.length / 2)];
  const deadZone = mad * 0.5;

  // 5) 해시 생성
  const hashBits = acCount;
  const hashBytes = Math.ceil(hashBits / 8);
  const hash = Buffer.alloc(hashBytes);

  for (let i = 0; i < hashBits; i++) {
    const val = acValues[i];
    if (val > median + deadZone) {
      hash[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
    }
  }

  return hash.toString('hex');
}

/**
 * hex 해시 문자열의 Hamming Distance (편의용, 단발 비교)
 */
function hammingDistance(hashA, hashB) {
  const bufA = Buffer.from(hashA, 'hex');
  const bufB = Buffer.from(hashB, 'hex');
  return hammingDistanceBuf(bufA, bufB);
}

/**
 * Buffer 간의 Hamming Distance (고속, 룩업 테이블 사용)
 * 대량 비교 시 반드시 이 함수 사용 (Buffer 재할당 없음)
 * @param {Buffer|Uint8Array} bufA
 * @param {Buffer|Uint8Array} bufB
 * @returns {number}
 */
function hammingDistanceBuf(bufA, bufB) {
  const len = Math.min(bufA.length, bufB.length);
  let distance = 0;
  for (let i = 0; i < len; i++) {
    distance += POPCOUNT_LUT[bufA[i] ^ bufB[i]];
  }
  return distance;
}

/**
 * Hamming Distance를 유사도 퍼센트로 변환
 */
function similarityPercent(distance, totalBits) {
  return ((1 - distance / totalBits) * 100).toFixed(2);
}

module.exports = { computeHash, hammingDistance, hammingDistanceBuf, similarityPercent, POPCOUNT_LUT };
