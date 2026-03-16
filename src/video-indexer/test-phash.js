/**
 * test-phash.js — pHash 모듈 기본 검증
 *
 * sharp로 테스트 이미지를 동적 생성하여 pHash 정확성 확인
 *   node src/test-phash.js
 */
const sharp = require('sharp');
const { computeHash, hammingDistance, similarityPercent } = require('./phash');
const { config } = require('./extractor');

async function createTestImage(width, height, r, g, b) {
    return sharp({
        create: {
            width, height,
            channels: 3,
            background: { r, g, b }
        }
    }).png().toBuffer();
}

async function createGradientImage(width, height, startR, endR) {
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const t = x / width;
            const idx = (y * width + x) * 3;
            pixels[idx] = Math.round(startR + (endR - startR) * t);
            pixels[idx + 1] = 50;
            pixels[idx + 2] = 100;
        }
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function main() {
    const hashBits = config.phash.lowFreqSize * config.phash.lowFreqSize - 1; // DC 제외
    let passed = 0;
    let failed = 0;

    function assert(name, condition) {
        if (condition) {
            console.log(`  ✅ ${name}`);
            passed++;
        } else {
            console.log(`  ❌ ${name}`);
            failed++;
        }
    }

    console.log('\n🧪 pHash 테스트\n');

    // 테스트 1: 동일 이미지 → distance 0
    console.log('--- 테스트 1: 동일한 이미지 ---');
    const img1 = await createTestImage(200, 200, 100, 150, 200);
    const hash1a = await computeHash(img1);
    const hash1b = await computeHash(img1);
    const dist1 = hammingDistance(hash1a, hash1b);
    assert(`동일 이미지 Hamming Distance = ${dist1} (예상: 0)`, dist1 === 0);

    // 테스트 2: 약간 다른 색상 → 낮은 distance
    console.log('\n--- 테스트 2: 약간 다른 색상 ---');
    const img2a = await createTestImage(200, 200, 100, 150, 200);
    const img2b = await createTestImage(200, 200, 110, 145, 195); // 약간 다른 색
    const hash2a = await computeHash(img2a);
    const hash2b = await computeHash(img2b);
    const dist2 = hammingDistance(hash2a, hash2b);
    assert(`약간 다른 색상 Hamming Distance = ${dist2} (예상: ≤ 10)`, dist2 <= 10);
    console.log(`       유사도: ${similarityPercent(dist2, hashBits)}%`);

    // 테스트 3: 완전히 다른 이미지 → 높은 distance
    console.log('\n--- 테스트 3: 완전히 다른 이미지 ---');
    const img3a = await createGradientImage(200, 200, 0, 255);
    const img3b = await createTestImage(200, 200, 50, 50, 50);
    const hash3a = await computeHash(img3a);
    const hash3b = await computeHash(img3b);
    const dist3 = hammingDistance(hash3a, hash3b);
    assert(`완전히 다른 이미지 Hamming Distance = ${dist3} (예상: > 30)`, dist3 > 30);
    console.log(`       유사도: ${similarityPercent(dist3, hashBits)}%`);

    // 테스트 4: 밝기만 다른 이미지
    console.log('\n--- 테스트 4: 밝기 변화 ---');
    const img4a = await createGradientImage(200, 200, 50, 200);
    const img4b = await createGradientImage(200, 200, 70, 220); // 밝기 변화
    const hash4a = await computeHash(img4a);
    const hash4b = await computeHash(img4b);
    const dist4 = hammingDistance(hash4a, hash4b);
    assert(`밝기 변화 Hamming Distance = ${dist4} (예상: ≤ 20)`, dist4 <= 20);
    console.log(`       유사도: ${similarityPercent(dist4, hashBits)}%`);

    // 테스트 5: 크기가 다른 동일 내용
    console.log('\n--- 테스트 5: 다른 해상도, 같은 내용 ---');
    const img5a = await createGradientImage(640, 480, 30, 180);
    const img5b = await createGradientImage(320, 240, 30, 180);
    const hash5a = await computeHash(img5a);
    const hash5b = await computeHash(img5b);
    const dist5 = hammingDistance(hash5a, hash5b);
    assert(`다른 해상도 Hamming Distance = ${dist5} (예상: ≤ 15)`, dist5 <= 15);
    console.log(`       유사도: ${similarityPercent(dist5, hashBits)}%`);

    // 요약
    console.log(`\n${'='.repeat(40)}`);
    console.log(`  결과: ${passed} 통과 / ${failed} 실패`);
    console.log(`${'='.repeat(40)}\n`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('❌ 테스트 오류:', err);
    process.exit(1);
});
