/**
 * extractor.js — FFmpeg 프레임 추출 모듈
 */
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const config = require('./config/config.json');

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
 * @param {number} [videoWidth] - 원본 영상 너비
 * @param {number} [videoHeight] - 원본 영상 높이
 * @returns {Promise<string[]>} 추출된 프레임 파일 경로 배열
 */
function extractFrames(videoPath, outputDir, fps, videoWidth, videoHeight) {
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
        // 원본 영상 해상도(iw, ih)를 넘어서는 크롭 방지 (Javascript 내장 Math 활용)
        // extractFrames가 videoWidth, videoHeight를 인자로 받는다고 가정 (없으면 기본값 99999로 회피)
        const iw = videoWidth || 99999;
        const ih = videoHeight || 99999;
        const cx = Math.min(crop.x, iw);
        const cy = Math.min(crop.y, ih);
        const cw = Math.min(crop.w, iw - cx);
        const ch = Math.min(crop.h, ih - cy);
        
        filters.push(`crop=${cw}:${ch}:${cx}:${cy}`);
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
            .on('error', (err, stdout, stderr) => {
                let errMsg = err.message;
                if (stderr) {
                    const lines = stderr.split('\n').filter(l => l.trim().length > 0);
                    if (lines.length > 0) {
                        errMsg += `\n[FFmpeg 로그] ${lines[lines.length - 1]}`;
                    }
                }
                reject(new Error(`프레임 추출 실패 [${videoPath}]: ${errMsg}`));
            })
            .run();
    });
}

/**
 * 영상의 메타데이터(길이, 해상도) 반환
 * @param {string} videoPath
 * @returns {Promise<{duration: number, width: number, height: number}>}
 */
function getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) return reject(err);
            const duration = metadata.format.duration || 0;
            let width = 0;
            let height = 0;
            if (metadata.streams) {
                const vStream = metadata.streams.find(s => s.codec_type === 'video');
                if (vStream) {
                    width = vStream.width || 0;
                    height = vStream.height || 0;
                }
            }
            resolve({ duration, width, height });
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

module.exports = { extractFrames, getVideoInfo, cleanupFrames, config };
