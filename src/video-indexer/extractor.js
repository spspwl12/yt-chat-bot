/**
 * extractor.js — FFmpeg 프레임 추출 모듈
 */
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const config = require('../data/config-search.js');

// --- FFmpeg 실행 파일 경로 설정 ---
if (config.ffmpeg.ffmpegPath) {
    ffmpeg.setFfmpegPath(config.ffmpeg.ffmpegPath);
}
if (config.ffmpeg.ffprobePath) {
    ffmpeg.setFfprobePath(config.ffmpeg.ffprobePath);
}

/**
 * 영상에서 지정된 fps로 프레임 추출
 * @param {string} videoPath - 영상 파일 경로
 * @param {string} outputDir - 프레임 저장 디렉토리
 * @param {number} [fps] - 초당 프레임 수 (config 기본값 사용)
 * @returns {Promise<string[]>} 추출된 프레임 파일 경로 배열
 */
function extractFrames(videoPath, outputDir, fps) {
    const extractFps = fps || config.extraction.fps;
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const framesDir = path.join(outputDir, videoName);

    if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
    }

    // vf 필터 체인 조합: crop → fps → scale
    const filters = [];

    // 1) 영역 크롭 (원본에서 특정 부분만 잘라내기)
    const crop = config.extraction.crop;
    if (crop && crop.enabled && crop.w && crop.h) {
        filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
    }

    // 2) fps 추출
    filters.push(`fps=${extractFps}`);

    // 3) 리사이즈
    const { width, height } = config.extraction;
    if (width && height) {
        filters.push(`scale=${width}:${height}`);
    }

    const vfFilter = filters.join(',');

    return new Promise((resolve, reject) => {
        const cmd = ffmpeg(videoPath);

        // 추가 입력 옵션
        if (config.ffmpeg.inputOptions && config.ffmpeg.inputOptions.length > 0) {
            cmd.inputOptions(config.ffmpeg.inputOptions);
        }

        cmd
            .outputOptions([`-vf`, vfFilter, `-f`, `image2`])
            .output(path.join(framesDir, 'frame_%06d.png'))
            .on('end', () => {
                const files = fs.readdirSync(framesDir)
                    .filter(f => f.endsWith('.png'))
                    .sort()
                    .map(f => path.join(framesDir, f));
                resolve(files);
            })
            .on('error', (err) => {
                reject(new Error(`프레임 추출 실패 [${videoPath}]: ${err.message}`));
            })
            .run();
    });
}

/**
 * 영상의 길이를 초 단위로 반환
 * @param {string} videoPath
 * @returns {Promise<number>}
 */
function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration || 0);
        });
    });
}

/**
 * 디렉토리 삭제 (프레임 정리용)
 * @param {string} dirPath
 */
function cleanupFrames(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

module.exports = { extractFrames, getVideoDuration, cleanupFrames, config };
