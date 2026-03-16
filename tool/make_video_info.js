const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const targetDir = __dirname; // 분석할 폴더
const outputFile = path.join(__dirname, 'video-info.json');

// 지원할 확장자 목록
const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.ts'];

function toHHMMSS(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ffprobe 실행 함수
function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    execFile(targetDir + "/ffprobe.exe", [
      '-v', 'error',
      '-show_entries', 'format=start_time,duration',
      '-of', 'json',
      filePath
    ], (err, stdout) => {
      if (err) return reject(err);
      try {
        const data = JSON.parse(stdout);
        const start = parseFloat(data.format.start_time || 0);
        const duration = parseFloat(data.format.duration || 0);
        const end = start + duration;

        resolve({
          name: path.basename(filePath, path.extname(filePath)),
          alias: path.basename(filePath, path.extname(filePath)), // 확장자 제거한 이름
          start_time: toHHMMSS(start),
          end_time: toHHMMSS(end),
          duration: end,
          title: "",
          shorten: ""
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// 메인 실행
(async () => {
  try {
    const files = fs.readdirSync(targetDir)
      .filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase()));

    const results = [];
    for (const file of files) {
      const info = await getVideoInfo(path.join(targetDir, file));
      results.push(info);
    }
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`✅ 결과 저장 완료: ${outputFile}`);
  } catch (err) {
    console.error('❌ 오류 발생:', err);
  }
})();