const fs = require("fs");
const path = require("path");

// VTT 파서 (자막 인덱스 포함)
function parseVTT(content) {
  const lines = content.split(/\r?\n/);
  const cues = [];
  let cue = null;
  let index = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // 숫자 인덱스 라인 (예: 1, 2, 3 ...)
    if (/^\d+$/.test(line)) {
      index = parseInt(line, 10);
    }
    // 시간 라인
    else if (line.includes("-->")) {
      if (cue) cues.push(cue);
      const [start, end] = line.split("-->").map(s => s.trim());
      cue = { index, start, end, text: "" };
    }
    // 자막 텍스트
    else if (cue) {
      cue.text += (cue.text ? " " : "") + line;
    }
  }

  if (cue) cues.push(cue);
  return cues;
}

// 폴더 내 모든 vtt 파일을 JSON으로 변환
function convertFolderVTTtoJSON(folderPath) {
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith(".vtt"));
  const allData = {};

  files.forEach(file => {
    const filePath = path.join(folderPath, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseVTT(content);
    const name = file.replace(/.vtt/g, "");
    allData[name] = parsed;
    console.log(`✅ ${file} 변환 완료 (${parsed.length}개 cue)`);
  });

  const outputPath = path.join(folderPath, `subtitles${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(allData), "utf-8");
  console.log(`📁 subtitles.json 생성 완료`);
}

// 실행
//const folderPath = path.join(__dirname, "vtt"); // vtt 파일들이 있는 폴더
const folderPath = path.join(__dirname); // vtt 파일들이 있는 폴더
convertFolderVTTtoJSON(folderPath);