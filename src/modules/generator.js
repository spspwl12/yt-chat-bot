/**
 * 편성표 이미지 및 텍스트 생성 모듈
 *
 * 1~293화 편성표를 canvas로 이미지화 및 텍스트 생성.
 * 현재 사이클(1~293화)과 다음 사이클(1~293화)의 시간표 계산.
 */
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const search_lib = require('../video-matcher/search.js');
const { getEpisodeInfo } = require('../tracker.js');
const { formatDate, roundUpTime } = require('../func.js');
const configManager = require('../config-manager.js');
const { cfg } = configManager;

const videoInfo = search_lib.videoInfo;
function getEpisodeStart() { return (cfg.episode && cfg.episode.start !== undefined) ? cfg.episode.start : 1; }
function getEpisodeEnd() { return (cfg.episode && cfg.episode.end !== undefined) ? cfg.episode.end : 293; }

// 이미지 저장 디렉토리
const OUTPUT_DIR = path.join(__dirname, '../../data', 'schedule-images');

/**
 * 활성 에피소드만 필터링 (disable 제외, alias 범위 내)
 */
function getActiveEpisodes() {
    const epStart = getEpisodeStart();
    const epEnd = getEpisodeEnd();
    return videoInfo.filter(e => !e.disable && parseInt(e.alias) >= epStart && parseInt(e.alias) <= epEnd);
}

/**
 * 현재 방영 중인 에피소드의 alias(화 번호)를 반환
 */
function getCurrentEpisodeAlias() {
    const rtn = getEpisodeInfo();
    if (!rtn) return null;
    const info = videoInfo[rtn.index];
    return info ? parseInt(info.alias) : null;
}

/**
 * 전체 1~293화 사이클의 총 스트리밍 시간(ms) 계산
 */
function getTotalCycleDurationMs() {
    const activeEps = getActiveEpisodes();
    let totalSec = 0;
    for (const ep of activeEps) {
        totalSec += (ep._streamDurationSec || ep._durationSec || 0);
    }
    return totalSec * 1000;
}

/**
 * 현재 사이클 편성표 데이터 생성
 */
function buildCurrentCycleData(rtn) {
    if (!rtn) return [];

    const activeEps = getActiveEpisodes();
    const currentInfo = videoInfo[rtn.index];
    const currentAlias = currentInfo ? parseInt(currentInfo.alias) : 1;
    const totalCycleMs = getTotalCycleDurationMs();
    const entries = [];

    for (const ep of activeEps) {
        const alias = parseInt(ep.alias);
        if (isNaN(alias)) continue;

        const futureDate = roundUpTime(search_lib.getFutureDate(ep, rtn, 0));

        let cycleDate;
        if (alias >= currentAlias) {
            cycleDate = futureDate;
        } else {
            cycleDate = new Date(futureDate.getTime() - totalCycleMs);
        }

        entries.push({
            alias: ep.alias,
            title: ep.title,
            shorten: ep.shorten,
            date: cycleDate,
        });
    }

    entries.sort((a, b) => parseInt(a.alias) - parseInt(b.alias));
    return entries;
}

/**
 * 다음 사이클 편성표 데이터 생성
 */
function buildNextCycleData(rtn) {
    if (!rtn) return [];

    const activeEps = getActiveEpisodes();
    const currentInfo = videoInfo[rtn.index];
    const currentAlias = currentInfo ? parseInt(currentInfo.alias) : 1;
    const totalCycleMs = getTotalCycleDurationMs();
    const entries = [];

    for (const ep of activeEps) {
        const alias = parseInt(ep.alias);
        if (isNaN(alias)) continue;

        const futureDate = roundUpTime(search_lib.getFutureDate(ep, rtn, 0));

        let cycleDate;
        if (alias >= currentAlias) {
            cycleDate = new Date(futureDate.getTime() + totalCycleMs);
        } else {
            cycleDate = futureDate;
        }

        entries.push({
            alias: ep.alias,
            title: ep.title,
            shorten: ep.shorten,
            date: cycleDate,
        });
    }

    entries.sort((a, b) => parseInt(a.alias) - parseInt(b.alias));
    return entries;
}

/**
 * 특정 사이클 오프셋 편성표 데이터 생성
 * cycleOffset = 0: 이번 사이클
 * cycleOffset = 1: 다음 사이클
 * cycleOffset = 2: 다다음 사이클
 */
function buildCycleData(rtn, cycleOffset = 0) {
    if (!rtn) return [];

    const activeEps = getActiveEpisodes();
    const currentInfo = videoInfo[rtn.index];
    const currentAlias = currentInfo ? parseInt(currentInfo.alias) : 1;
    const totalCycleMs = getTotalCycleDurationMs();
    const entries = [];

    for (const ep of activeEps) {
        const alias = parseInt(ep.alias);
        if (isNaN(alias)) continue;

        const futureDate = roundUpTime(search_lib.getFutureDate(ep, rtn, 0));

        let cycleDate;
        if (alias >= currentAlias) {
            cycleDate = new Date(futureDate.getTime() + (totalCycleMs * cycleOffset));
        } else {
            cycleDate = new Date(futureDate.getTime() + (totalCycleMs * (cycleOffset - 1)));
        }

        entries.push({
            alias: ep.alias,
            title: ep.title,
            shorten: ep.shorten,
            date: cycleDate,
            durationSec: ep._streamDurationSec || ep._durationSec || 0
        });
    }

    entries.sort((a, b) => parseInt(a.alias) - parseInt(b.alias));
    return entries;
}

/**
 * 텍스트 형태의 시간표 생성
 */
function generateScheduleText(cycleOffset = 0) {
    const rtn = getEpisodeInfo();
    if (!rtn) return null;

    const data = buildCycleData(rtn, cycleOffset);
    if (!data || data.length === 0) return null;

    const firstEp = data[0];
    const y = firstEp.date.getFullYear();
    const m = firstEp.date.getMonth() + 1;
    const d = firstEp.date.getDate();

    let text = `${y}년 ${m}월 ${d}일 시간표 입니다.\n\n`;

    let currentChunk = [];
    let startAlias = 1;
    let endAlias = 20;
    let chunkStartDate = null;
    let pdate = null;

    for (let i = 0; i < data.length; i++) {
        const ep = data[i];
        const alias = parseInt(ep.alias);

        if (currentChunk.length === 0) {
            chunkStartDate = ep.date;
        }

        if (!pdate) {
            pdate = ep.date;
        }

        const timeStr = formatDate(ep.date, pdate, true).replace(/ /g, '');
        currentChunk.push(`[${timeStr}]${ep.shorten}`);

        pdate = ep.date;

        if (alias === endAlias || i === data.length - 1) {
            const chunkEndDate = new Date(ep.date.getTime() + ep.durationSec * 1000);

            const sM = chunkStartDate.getMonth() + 1;
            const sD = chunkStartDate.getDate();
            const sH = String(chunkStartDate.getHours()).padStart(2, '0');
            const sMin = String(chunkStartDate.getMinutes()).padStart(2, '0');
            const chunkStartTimeStr = `${sM}월 ${sD}일 ${sH}:${sMin}`;

            const eM = chunkEndDate.getMonth() + 1;
            const eD = chunkEndDate.getDate();
            const eH = String(chunkEndDate.getHours()).padStart(2, '0');
            const eMin = String(chunkEndDate.getMinutes()).padStart(2, '0');
            const chunkEndTimeStr = `${eM}월 ${eD}일 ${eH}:${eMin}`;

            text += `${startAlias}화 ~ ${alias}화 (${chunkStartTimeStr} ~ ${chunkEndTimeStr})\n`;
            text += currentChunk.join('→') + '\n\n';
            currentChunk = [];
            startAlias = alias + 1;
            endAlias = startAlias + 19;
        }
    }

    return text.trim();
}

// ═══════════════════════════════════════
//  Canvas 이미지 렌더링
// ═══════════════════════════════════════

const COLORS = {
    bg: '#1a1a2e',
    headerBg: '#16213e',
    titleText: '#ffffff',
    subtitleText: '#a8b2d1',
    rowText: '#ccd6f6',
    dateText: '#64ffda',
    borderColor: '#233554',
    accentLine: '#e94560',
    rowEven: '#16213e',
    rowOdd: '#1a1a2e',
};

const LAYOUT = {
    pageWidth: 1200,
    headerHeight: 100,
    rowHeight: 32,
    colAlias: 60,
    colTitle: 560,
    colDate: 300,
    padding: 20,
    headerFontSize: 28,
    subHeaderFontSize: 16,
};

function renderScheduleImage(scheduleData, title) {
    if (!scheduleData || scheduleData.length === 0) return null;

    const rows = scheduleData.length;
    const tableHeaderHeight = 40;
    const totalHeight = LAYOUT.headerHeight + tableHeaderHeight + (rows * LAYOUT.rowHeight) + LAYOUT.padding * 2 + 40;

    const canvas = createCanvas(LAYOUT.pageWidth, totalHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, LAYOUT.pageWidth, totalHeight);

    const gradient = ctx.createLinearGradient(0, 0, LAYOUT.pageWidth, LAYOUT.headerHeight);
    gradient.addColorStop(0, '#0f3460');
    gradient.addColorStop(1, '#16213e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, LAYOUT.pageWidth, LAYOUT.headerHeight);

    ctx.fillStyle = COLORS.accentLine;
    ctx.fillRect(0, LAYOUT.headerHeight - 4, LAYOUT.pageWidth, 4);

    ctx.fillStyle = COLORS.titleText;
    ctx.font = `bold ${LAYOUT.headerFontSize}px "Malgun Gothic", "맑은 고딕", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(title, LAYOUT.pageWidth / 2, 45);

    const now = new Date();
    const genTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 생성`;
    ctx.fillStyle = COLORS.subtitleText;
    ctx.font = `${LAYOUT.subHeaderFontSize}px "Malgun Gothic", "맑은 고딕", sans-serif`;
    ctx.fillText(genTime, LAYOUT.pageWidth / 2, 75);

    const tableStartY = LAYOUT.headerHeight + LAYOUT.padding;
    const colStartX = LAYOUT.padding;

    ctx.fillStyle = '#0d1b3e';
    ctx.fillRect(0, tableStartY, LAYOUT.pageWidth, tableHeaderHeight);

    ctx.fillStyle = '#64ffda';
    ctx.font = `bold 15px "Malgun Gothic", "맑은 고딕", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('화', colStartX + 15, tableStartY + 26);
    ctx.fillText('제목', colStartX + LAYOUT.colAlias + 15, tableStartY + 26);
    ctx.fillText('방영 시간', colStartX + LAYOUT.colAlias + LAYOUT.colTitle + 15, tableStartY + 26);

    ctx.strokeStyle = COLORS.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, tableStartY + tableHeaderHeight);
    ctx.lineTo(LAYOUT.pageWidth, tableStartY + tableHeaderHeight);
    ctx.stroke();

    const dataStartY = tableStartY + tableHeaderHeight;

    for (let i = 0; i < scheduleData.length; i++) {
        const entry = scheduleData[i];
        const y = dataStartY + (i * LAYOUT.rowHeight);

        ctx.fillStyle = i % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
        ctx.fillRect(0, y, LAYOUT.pageWidth, LAYOUT.rowHeight);

        const textY = y + LAYOUT.rowHeight - 9;

        ctx.fillStyle = '#e2e2e2';
        ctx.font = `bold 14px "Malgun Gothic", "맑은 고딕", sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(entry.alias, colStartX + LAYOUT.colAlias - 5, textY);

        ctx.fillStyle = COLORS.rowText;
        ctx.textAlign = 'left';
        const titleText = entry.title.length > 50 ? entry.title.substring(0, 50) + '...' : entry.title;
        ctx.fillText(titleText, colStartX + LAYOUT.colAlias + 15, textY);

        ctx.fillStyle = COLORS.dateText;
        ctx.font = `13px "Malgun Gothic", "맑은 고딕", sans-serif`;
        ctx.fillText(formatScheduleDate(entry.date), colStartX + LAYOUT.colAlias + LAYOUT.colTitle + 15, textY);

        if (i < scheduleData.length - 1) {
            ctx.strokeStyle = '#1e2d4d';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(LAYOUT.padding, y + LAYOUT.rowHeight);
            ctx.lineTo(LAYOUT.pageWidth - LAYOUT.padding, y + LAYOUT.rowHeight);
            ctx.stroke();
        }
    }

    const footerY = dataStartY + (scheduleData.length * LAYOUT.rowHeight) + 15;
    ctx.fillStyle = COLORS.subtitleText;
    ctx.font = `12px "Malgun Gothic", "맑은 고딕", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`총 ${scheduleData.length}화 | ${getEpisodeStart()}화 ~ ${getEpisodeEnd()}화 | 자동 생성`, LAYOUT.pageWidth / 2, footerY);

    return canvas.toBuffer('image/png');
}

function formatScheduleDate(date) {
    if (!date) return '-';
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const w = weekdays[date.getDay()];
    return `${y}-${m}-${d} (${w}) ${hh}:${mm}`;
}

function generateScheduleImages() {
    const rtn = getEpisodeInfo();
    if (!rtn) {
        console.log('⚠️ [편성표] 에피소드 정보 없음 — 이미지 생성 불가');
        return null;
    }

    const thisCycle = buildCurrentCycleData(rtn);
    const nextCycle = buildNextCycleData(rtn);

    if (thisCycle.length === 0) {
        console.log('⚠️ [편성표] 편성 데이터 없음');
        return null;
    }

    const currentImage = renderScheduleImage(thisCycle, `📺 편성표 — 현재 사이클 (${getEpisodeStart()}화 ~ ${getEpisodeEnd()}화)`);
    const nextImage = renderScheduleImage(nextCycle, `📺 편성표 — 다음 사이클 (${getEpisodeStart()}화 ~ ${getEpisodeEnd()}화)`);

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const timestamp = Date.now();
    const currentPath = path.join(OUTPUT_DIR, `schedule_current_${timestamp}.png`);
    const nextPath = path.join(OUTPUT_DIR, `schedule_next_${timestamp}.png`);

    fs.writeFileSync(currentPath, currentImage);
    fs.writeFileSync(nextPath, nextImage);

    console.log(`📊 [편성표] 현재 사이클 이미지: ${currentPath}`);
    console.log(`📊 [편성표] 다음 사이클 이미지: ${nextPath}`);

    // 오래된 이미지 자동 정리 (디스크 누수 방지)
    cleanupOldImages(4);

    return { currentImage, nextImage, currentPath, nextPath };
}

function cleanupOldImages(keepCount = 4) {
    if (!fs.existsSync(OUTPUT_DIR)) return;

    const files = fs.readdirSync(OUTPUT_DIR)
        .filter(f => f.endsWith('.png'))
        .map(f => ({
            name: f,
            path: path.join(OUTPUT_DIR, f),
            time: fs.statSync(path.join(OUTPUT_DIR, f)).mtimeMs
        }))
        .sort((a, b) => b.time - a.time);

    for (let i = keepCount; i < files.length; i++) {
        try {
            fs.unlinkSync(files[i].path);
        } catch (e) { /* 무시 */ }
    }
}

module.exports = {
    name: 'generator',
    icon: '🖼️',
    description: '1~293화 편성표 텍스트 및 Canvas 이미지 생성기',

    web: {
        title: '편성표 생성기',
        icon: '🖼️',
        description: '1~293화 편성표 텍스트 및 Canvas 이미지 생성 모듈',
        category: 'Schedule',
        badge: 'Generator'
    },
    generateScheduleImages,
    generateScheduleText,
    buildCycleData,
    getActiveEpisodes,
    getCurrentEpisodeAlias,
    getTotalCycleDurationMs,
    cleanupOldImages,
    OUTPUT_DIR,
};
