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
    if (!hm || hm.length <= 0) return "🕐";

    const clockEmojis = {
        full: ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"],
        half: ["🕜", "🕝", "🕞", "🕟", "🕠", "🕡", "🕢", "🕣", "🕤", "🕥", "🕦", "🕧"]
    };

    try {
        const [h, m] = hm[0].split(":").map(x => parseInt(x, 10));
        if (isNaN(h) || isNaN(m) || h < 0 || h > 24)
            return "🕒";

        const normalizedHour = h === 24 ? 0 : h;
        const index = normalizedHour === 0 ? 11 : (normalizedHour - 1) % 12;

        if (m < 15)
            return clockEmojis.full[index]; // 정각 근사
        else if (m < 45)
            return clockEmojis.half[index]; // 30분 근사
        else
            return clockEmojis.full[(index + 1) % 12]; // 다음 정각 근사
    } catch {
        return "🕒";
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

function roundUpTime(originalTime) {
    if (originalTime instanceof Date) {
        let d = new Date(originalTime.getTime());
        if (d.getSeconds() >= 50) {
            d.setMinutes(d.getMinutes() + 1);
            d.setSeconds(d.getSeconds() - 50);
        }
        return d;
    }
    return originalTime;
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

    numStr = '' + numStr;
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

    numStr = '' + numStr;
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

function parseKoreanDate(input) {
    if (!input) return null;
    input = input.trim();
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    let date = now.getDate();
    let hours = now.getHours();
    let minutes = now.getMinutes();

    let hasDate = false;
    let hasTime = false;

    // YYYY년 MM월 DD일 or YYYY-MM-DD or YYYY.MM.DD
    const dateRegex1 = /(\d{4})[\s년\-\.]+(\d{1,2})[\s월\-\.]+(\d{1,2})[일]?/;
    // MM월 DD일 or MM/DD or MM.DD (lookbehind avoided for compatibility)
    const dateRegex2 = /(?:^|[^\d])(\d{1,2})[\s월/\.]+(\d{1,2})[일]?/;

    let pmamMatch = input.match(/(오전|오후|am|pm|낮|밤|저녁|새벽|아침)/i);
    let isPM = null;
    if (pmamMatch) {
        isPM = /오후|pm|낮|저녁|밤/i.test(pmamMatch[1]);
    }

    const timeRegex1 = /(?:^|[^\d])(\d{1,2}):(\d{1,2})/;
    const timeRegex2 = /(?:^|[^\d])(\d{1,2})시\s*(?:(\d{1,2})분)?/;

    let m = input.match(dateRegex1);
    if (m) {
        year = parseInt(m[1], 10); month = parseInt(m[2], 10); date = parseInt(m[3], 10);
        hasDate = true;
        input = input.replace(m[0], '');
    } else {
        m = input.match(dateRegex2);
        if (m) {
            month = parseInt(m[1], 10); date = parseInt(m[2], 10);
            hasDate = true;
            input = input.replace(m[0], '');
        }
    }

    let t = input.match(timeRegex1);
    if (t) {
        hours = parseInt(t[1], 10); minutes = parseInt(t[2], 10);
        hasTime = true;
    } else {
        t = input.match(timeRegex2);
        if (t) {
            hours = parseInt(t[1], 10);
            minutes = t[2] ? parseInt(t[2], 10) : 0;
            hasTime = true;
        }
    }

    if (!hasDate && !hasTime) {
        return null;
    }

    if (isPM !== null && hasTime) {
        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;
        if (pmamMatch && pmamMatch[1] === '밤' && hours === 12) {
            hours = 0; // '밤 12시'는 예외적으로 0시(자정)로 처리
        }
    }

    if (!hasDate && hasTime) {
        let targetDate = new Date(year, month - 1, date, hours, minutes, 0);
        if (targetDate.getTime() < now.getTime() - 60000) {
            targetDate.setDate(targetDate.getDate() + 1);
        }
        return { startDate: targetDate, endDate: targetDate, hasTime: true, hasDate: false };
    }

    if (hasDate && !hasTime) {
        let startDate = new Date(year, month - 1, date, 0, 0, 0);
        let endDate = new Date(year, month - 1, date, 23, 59, 59);

        // 연도 표기 없이 날짜만 있는데 31일 이상 과거인 경우, 다음 연도로 추정 (선택적)
        if (!m || (m.length < 4 && !m[0].match(/\d{4}/))) {
            if (startDate.getTime() < now.getTime() - 86400000 * 31) {
                startDate.setFullYear(year + 1);
                endDate.setFullYear(year + 1);
            }
        }
        return { startDate, endDate, hasTime: false, hasDate: true };
    }

    let targetDate = new Date(year, month - 1, date, hours, minutes, 0);
    return { startDate: targetDate, endDate: targetDate, hasTime: true, hasDate: true };
}

module.exports = {
    runWithoutLogs,
    removeDummy,
    toHHMMSS,
    fromHHMMSS,
    getClockEmoji,
    formatDate,
    roundUpTime,
    toUnicodeNumber,
    toUnicodeNumber2,
    insertSpaces,
    filterText,
    shortenTextByRatio,
    parseKoreanDate
};
