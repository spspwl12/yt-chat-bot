const fs = require('fs');
const path = require('path');

async function runWithoutLogs(fn, ...args) {
    const methods = Object.keys(console).filter(key => typeof console[key] === 'function');
    const backups = {};
    methods.forEach(key => backups[key] = console[key]);
    methods.forEach(key => console[key] = () => { });

    try {
        return await fn(...args);
    } finally {
        methods.forEach(key => console[key] = backups[key]);
    }
}

async function removeDummy(dir) {
    const targetDir = path.join(__dirname, dir);
    try {
        const files = await fs.promises.readdir(targetDir);
        await Promise.all(
            files
                .filter(file => /^\d+-(.*?)\.js$/.test(file))
                .map(file => fs.promises.unlink(path.join(targetDir, file)).catch(() => { }))
        );
    } catch {
    }
}

function toHHMMSS(seconds) {
    if (!seconds)
        return "00:00:00";
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(seconds % 60)).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function fromHHMMSS(timeStr) {
    if (!timeStr)
        return 0;
    const parts = timeStr.split(":").map(Number);
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
}

function getClockEmoji(time) {
    const hm = time.match(/\d{2}:\d{2}/);

    if (!hm || hm.length <= 0)
        return "🕐";

    const clockEmojis = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];

    try {
        const parts = hm[0].split(":");
        if (parts.length !== 2)
            return "🕐";

        const hour = parseInt(parts[0], 10);
        const minute = parseInt(parts[1], 10);

        if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 24) {
            return "🕐";
        }
        const normalizedHour = hour === 24 ? 0 : hour;
        const index = normalizedHour === 0 ? 11 : (normalizedHour - 1) % 12;
        return clockEmojis[index];
    } catch {
        return "🕐";
    }
}

function formatDate(date, now, hideWeek) {
    const nowDate = now == null ? new Date() : now;
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-based → +1
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const weekday = weekdays[date.getDay()];

    let datePart = "";

    if (nowDate.getFullYear() !== year)
        datePart += `${year}년 `;
    if (nowDate.getMonth() !== month)
        datePart += `${month + 1}월 `;
    if (nowDate.getDate() !== day)
        datePart += `${day}일 ${hideWeek ? '' : `(${weekday})`} `;

    return `${datePart}${hours}:${minutes}`;
}

function toUnicodeNumber(numStr) {
    const map = {
        '0': '𝟶',
        '1': '𝟷',
        '2': '𝟸',
        '3': '𝟹',
        '4': '𝟺',
        '5': '𝟻',
        '6': '𝟼',
        '7': '𝟽',
        '8': '𝟾',
        '9': '𝟿'
    };

    return numStr.split('').map(ch => map[ch] || ch).join('');
}

function toUnicodeNumber2(numStr) {
    const map = {
        "0": "0️⃣",
        "1": "1️⃣",
        "2": "2️⃣",
        "3": "3️⃣",
        "4": "4️⃣",
        "5": "5️⃣",
        "6": "6️⃣",
        "7": "7️⃣",
        "8": "8️⃣",
        "9": "9️⃣"
    };

    return numStr.split('').map(ch => map[ch] || ch).join('');
}



function insertSpaces(text, change) {
    return text.replace(/([가-힣])(?=[가-힣])/g, change);
}

function filterText(text) {
    return text.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '').toLowerCase();
}

function shortenTextByRatio(str, ratio) {
    const len = str.length;

    const partLen = Math.floor(len * ratio);

    const start = str.slice(0, partLen);
    const end = str.slice(-partLen);

    return start + "..." + end;
}

module.exports = {
    runWithoutLogs,
    removeDummy,
    toHHMMSS,
    fromHHMMSS,
    getClockEmoji,
    formatDate,
    toUnicodeNumber,
    toUnicodeNumber2,
    insertSpaces,
    filterText,
    shortenTextByRatio
};
