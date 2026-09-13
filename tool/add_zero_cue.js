/**
 * add_zero_cue.js
 * 
 * VTT 파일 중 00:00:00.000 --> 00:00:00.000 메타데이터 큐가 없는 파일을 찾아
 * 1번 큐로 00:00:00.000 --> 00:00:00.000 을 생성하고 기존 큐 번호들을 순차적으로 재정렬(renumbering)하는 스크립트.
 */

const fs = require('fs');
const path = require('path');

function processVttFiles(targetDir = '.', backupDir = 'backup_vtt') {
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.vtt')).sort();
    console.log(`=== VTT 00:00:00 메타데이터 큐 검사 및 생성 시작 ===`);
    console.log(`대상 디렉터리: ${path.resolve(targetDir)}`);
    console.log(`총 VTT 파일 수: ${files.length}개\n`);

    const missingFiles = [];
    const alreadyValidFiles = [];

    // 1. 대상 파일 식별
    for (const f of files) {
        const filePath = path.join(targetDir, f);
        const raw = fs.readFileSync(filePath, 'utf8');
        const hasZeroCue = /00:00:00[\.\d]*\s*-->\s*00:00:00[\.\d]*/.test(raw);
        if (!hasZeroCue) {
            missingFiles.push(f);
        } else {
            alreadyValidFiles.push(f);
        }
    }

    console.log(`이미 00:00:00 큐가 존재하는 파일: ${alreadyValidFiles.length}개`);
    console.log(`00:00:00 큐가 누락된 파일: ${missingFiles.length}개 (${missingFiles.join(', ') || '없음'})\n`);

    if (missingFiles.length === 0) {
        console.log('모든 파일에 00:00:00 큐가 이미 존재합니다. 수정할 파일이 없습니다.');
        return { updated: [], count: 0 };
    }

    // 2. 누락된 파일에 00:00:00 큐 생성 및 큐 번호 재부여
    const updatedFiles = [];

    for (const f of missingFiles) {
        const filePath = path.join(targetDir, f);
        const raw = fs.readFileSync(filePath, 'utf8');
        const cleanRaw = raw.replace(/^\uFEFF/, '');

        // backup_vtt에서 메타데이터 텍스트 확인
        let metaText = ' ';
        const backupPath = path.join(backupDir, f);
        if (fs.existsSync(backupPath)) {
            const bRaw = fs.readFileSync(backupPath, 'utf8').replace(/^\uFEFF/, '');
            const bBlocks = bRaw.split(/\r?\n\r?\n/).map(b => b.trim()).filter(b => b && !b.startsWith('WEBVTT'));
            if (bBlocks.length > 0 && /00:00:00[\.\d]*\s*-->\s*00:00:00[\.\d]*/.test(bBlocks[0])) {
                const bLines = bBlocks[0].split(/\r?\n/);
                const text = bLines.slice(2).join('\n').trim();
                if (text) {
                    metaText = text;
                }
            }
        }

        // 기존 큐 블록 분리
        const blocks = cleanRaw.split(/\r?\n\r?\n/).map(b => b.trim()).filter(b => b && !b.startsWith('WEBVTT'));

        const newBlocks = [];
        // 1번 큐 생성
        newBlocks.push(['1', '00:00:00.000 --> 00:00:00.000', metaText].join('\n'));

        // 기존 큐들을 2번부터 순차 재부여
        for (let i = 0; i < blocks.length; i++) {
            const lines = blocks[i].split(/\r?\n/);
            lines[0] = String(i + 2);
            newBlocks.push(lines.join('\n'));
        }

        // UTF-8 BOM과 LF 개행으로 파일 작성
        const outputContent = '\uFEFFWEBVTT\n\n' + newBlocks.join('\n\n') + '\n';
        fs.writeFileSync(filePath, outputContent, 'utf8');

        console.log(`[생성 완료] ${f}: 00:00:00 큐 생성 및 큐 재정렬 완료 (총 큐 수: ${blocks.length} -> ${newBlocks.length})`);
        updatedFiles.push(f);
    }

    // 3. 검증
    console.log(`\n=== 최종 검증 진행 ===`);
    let allValid = true;
    for (const f of files) {
        const filePath = path.join(targetDir, f);
        const content = fs.readFileSync(filePath, 'utf8');
        const hasZeroCue = /00:00:00[\.\d]*\s*-->\s*00:00:00[\.\d]*/.test(content);
        if (!hasZeroCue) {
            console.error(`[검증 실패] ${f}에 여전히 00:00:00 큐가 없습니다.`);
            allValid = false;
        }
    }

    if (allValid) {
        console.log(`[검증 성공] 전체 ${files.length}개 VTT 파일 모두에 00:00:00 큐가 정상 존재합니다.`);
    }

    return { updated: updatedFiles, count: updatedFiles.length };
}

if (require.main === module) {
    processVttFiles();
}

module.exports = { processVttFiles };
