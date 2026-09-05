const cfg = require('../../data/config-youtube.js');
const msg = require('../../data/config-messages.js');
const statsTracker = require('../stats-db.js');
const { maskProfanity } = require('../func.js');

function buildRankMessage(title, rows, valExtractor, cmd, ctx, attempt = 0) {
    const limitLength = (cfg.stats && (cfg.stats.rank_chat_len_limit || cfg.stats.chat_len_limit)) || 160;
    const maxNickLen = (cfg.stats && cfg.stats.rank_chat_nick_len_limit) || 10;
    const cooldownMsg = ctx.getCooldownMsg(cmd);

    const header = msg.stats && msg.stats.rank_header ? msg.stats.rank_header(title) : `🏆 [${title}] `;
    let itemsStr = "";

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rank = i + 1;
        const rankStr = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}위`;

        let cleanName = maskProfanity(row.display_name || '시청자');
        if (cleanName.length > maxNickLen) {
            cleanName = cleanName.slice(0, maxNickLen) + '...';
        }
        const valStr = valExtractor(row);

        const itemStr = msg.stats && msg.stats.rank_item
            ? msg.stats.rank_item(rankStr, cleanName, valStr)
            : `${rankStr} ${cleanName}(${valStr})`;

        const sep = itemsStr ? (msg.stats && msg.stats.rank_separator ? msg.stats.rank_separator : " ") : "";
        const candidate = itemsStr + sep + itemStr;

        const fullMsgTest = msg.stats && msg.stats.rank_list
            ? msg.stats.rank_list(title, candidate, cooldownMsg)
            : `${header}${candidate} ${cooldownMsg}`.trim();

        if (fullMsgTest.length > limitLength && itemsStr.length > 0) {
            break;
        }
        itemsStr = candidate;
    }

    if (!itemsStr) {
        itemsStr = "기록이 없습니다.";
    }

    const finalRaw = msg.stats && msg.stats.rank_list
        ? msg.stats.rank_list(title, itemsStr, cooldownMsg)
        : `${header}${itemsStr} ${cooldownMsg}`.trim();

    const spaces = " ".repeat(attempt);
    return `${finalRaw}${spaces}`;
}

let chatListener = null;
let boundEventBus = null;

module.exports = {
    name: 'stats',
    group: 'stats',
    aliases: ['!스탯', '!스텟', '!내정보', '!내스탯', '!내스텟', '!stats', '!stat'],
    description: '유저 통계, 전체 요약 및 부문별 랭킹 조회',

    // 모듈 라이프사이클 훅 (완전 독립형 이벤트 바인딩)
    init({ eventBus }) {
        if (!eventBus) return;
        // 이전 리스너가 있으면 이전에 바인딩된 eventBus에서 제거 (누수 방지)
        if (chatListener && boundEventBus) {
            boundEventBus.off('chat', chatListener);
            chatListener = null;
        }
        boundEventBus = eventBus;
        chatListener = (msg) => {
            if (msg && msg.text && msg.channelId) {
                statsTracker.recordChatMessage(msg);
            }
        };
        eventBus.on('chat', chatListener);
    },

    destroy() {
        if (boundEventBus && chatListener) {
            boundEventBus.off('chat', chatListener);
            chatListener = null;
        }
        try {
            statsTracker.close();
        } catch { }
    },

    // 독립적 웹 뷰 및 웹소켓 액션 정의
    web: {
        id: 'stats',
        name: 'stats',
        title: '유저 통계 DB (User Statistics Viewer)',
        icon: '📈',
        description: '실시간 유저 채팅 수, 라이브 참여시간, 일자별 출석 및 종합 랭킹 조회',
        category: 'Database & Analytics',
        badge: 'DB',

        styles: `
            .stats-layout-wrap { display: grid; grid-template-columns: 1fr; gap: 20px; align-items: start; transition: all 0.3s ease; }
            .stats-layout-wrap.has-detail { grid-template-columns: 1fr 380px; }
            @media (max-width: 1080px) { .stats-layout-wrap.has-detail { grid-template-columns: 1fr; } }
            .stats-data-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
            .stats-data-table th { padding: 10px 14px; font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; background: rgba(15,23,42,0.95); position: sticky; top: 0; z-index: 2; border-bottom: 1px solid var(--surface-border); white-space: nowrap; }
            .stats-data-table td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
            .stats-data-table tr:hover td { background: rgba(255,255,255,0.03); }
            .stats-rank-badge { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; font-weight: 700; font-size: 0.75rem; background: rgba(255,255,255,0.06); color: var(--text-dim); }
            .stats-rank-1 { background: linear-gradient(135deg, #fbbf24, #d97706); color: #000; box-shadow: 0 0 10px rgba(251,191,36,0.4); }
            .stats-rank-2 { background: linear-gradient(135deg, #cbd5e1, #94a3b8); color: #000; box-shadow: 0 0 8px rgba(203,213,225,0.3); }
            .stats-rank-3 { background: linear-gradient(135deg, #f97316, #c2410c); color: #fff; box-shadow: 0 0 8px rgba(249,115,22,0.3); }
            .stats-user-row { cursor: pointer; transition: background 0.15s ease; }
            .stats-user-row.selected td { background: rgba(139,92,246,0.15) !important; }
            .stats-metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
            .stats-metric-box { background: rgba(15,23,42,0.6); border: 1px solid var(--surface-border); border-radius: 10px; padding: 12px; text-align: center; transition: transform 0.15s ease; }
            .stats-metric-box:hover { transform: translateY(-2px); border-color: rgba(139,92,246,0.3); }
            .stats-metric-box .metric-label { font-size: 0.72rem; color: var(--text-dim); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
            .stats-metric-box .metric-value { font-size: 1.1rem; font-weight: 700; margin-bottom: 2px; }
            .stats-metric-box .metric-rank { font-size: 0.72rem; color: var(--text-dim); }
        `,

        panel: `
            <!-- Overview Cards -->
            <div class="status-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 20px;">
                <div class="status-card glass">
                    <h3>👥 총 등록 유저</h3>
                    <p id="stats-ov-users" style="background: linear-gradient(90deg,#38bdf8,#0284c7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">0명</p>
                </div>
                <div class="status-card glass">
                    <h3>💬 총 누적 채팅</h3>
                    <p id="stats-ov-msgs" style="background: linear-gradient(90deg,#f472b6,#ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">0개</p>
                </div>
                <div class="status-card glass">
                    <h3>📅 오늘 활동 유저</h3>
                    <p id="stats-ov-today-users" style="background: linear-gradient(90deg,#fbbf24,#f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">0명</p>
                </div>
                <div class="status-card glass">
                    <h3>💬 오늘 채팅 수</h3>
                    <p id="stats-ov-today-msgs" style="background: linear-gradient(90deg,#a78bfa,#8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">0개</p>
                </div>
            </div>

            <!-- Search & Filter -->
            <div class="section-card glass" style="margin-bottom: 20px; padding: 16px;">
                <div style="display: flex; gap: 12px; align-items: center; width: 100%;">
                    <div style="flex: 1;">
                        <input type="text" id="stats-search-input" class="form-input" placeholder="🔍 닉네임 또는 채널 ID 검색" oninput="statsModule.onSearchInput()" onkeydown="if(event.key==='Enter') statsModule.search(1)" style="width: 100%;">
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                        <label style="font-size: 0.82rem; color: var(--text-dim); white-space: nowrap;">정렬:</label>
                        <select id="stats-sort-by" class="form-input" style="width: auto; min-width: 170px; padding: 8px 12px; cursor: pointer;" onchange="statsModule.search(1)">
                            <option value="total_messages">💬 총 채팅 많은순</option>
                            <option value="total_watch_seconds">⏱️ 총 참여시간 긴순</option>
                            <option value="today_messages">💬 오늘 채팅 많은순</option>
                            <option value="today_watch_seconds">⏱️ 오늘 참여시간 긴순</option>
                            <option value="active_days">📅 출석 일수 많은순</option>
                            <option value="last_chat_time">🕒 최근 활동순</option>
                        </select>
                        <button class="btn" onclick="statsModule.search(1)" style="white-space: nowrap;">검색</button>
                    </div>
                </div>
            </div>

            <!-- Split View -->
            <div class="stats-layout-wrap">
                <div class="section-card glass" style="padding: 0; overflow: hidden; display: flex; flex-direction: column;">
                    <div style="padding: 14px 18px; border-bottom: 1px solid var(--surface-border); display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 0.95rem; font-weight: 600;">📋 유저 목록 (<span id="stats-user-count">0</span>명)</h3>
                        <span id="stats-search-status" style="font-size: 0.8rem; color: var(--text-dim);"></span>
                    </div>
                    <div style="max-height: 520px; overflow-y: auto;">
                        <table class="stats-data-table" id="stats-users-table">
                            <thead><tr>
                                <th style="width:50px; text-align:center;">순위</th>
                                <th>유저명 / 채널 ID</th>
                                <th style="text-align:right;">총 채팅</th>
                                <th style="text-align:right;">총 참여시간</th>
                                <th style="text-align:right;">오늘 채팅</th>
                                <th style="text-align:right;">오늘 시청</th>
                                <th style="text-align:center;">출석</th>
                                <th style="text-align:center;">최근 활동</th>
                                <th style="text-align:center;">상세</th>
                            </tr></thead>
                            <tbody id="stats-users-tbody">
                                <tr><td colspan="9" style="text-align:center; color:var(--text-dim); padding:40px;">데이터를 불러오는 중...</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div style="padding: 10px 16px; border-top: 1px solid var(--surface-border); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.15); flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; gap: 6px; align-items: center;">
                            <span style="font-size:0.8rem; color:var(--text-dim);">표시 단위:</span>
                            <select id="stats-page-limit" class="form-input" style="width:auto; padding:4px 8px; font-size:0.8rem; cursor:pointer;" onchange="statsModule.onChangePageLimit()">
                                <option value="50">50명씩</option>
                                <option value="100" selected>100명씩</option>
                                <option value="200">200명씩</option>
                            </select>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <button class="btn btn-sm" id="btn-stats-prev" onclick="statsModule.changePage(-1)" style="padding:4px 10px; font-size:0.8rem;">◀ 이전</button>
                            <span id="stats-page-info" style="font-size:0.82rem; color:var(--text-main); font-weight:500;">1 / 1</span>
                            <button class="btn btn-sm" id="btn-stats-next" onclick="statsModule.changePage(1)" style="padding:4px 10px; font-size:0.8rem;">다음 ▶</button>
                        </div>
                    </div>
                </div>

                <!-- Detail Card -->
                <div class="section-card glass" id="stats-detail-card" style="padding: 20px; display: none;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                        <div>
                            <h3 id="stats-detail-name" style="margin:0 0 4px 0; font-size:1.2rem; color:#fcd34d; font-weight:700;">--</h3>
                            <div id="stats-detail-channel" style="font-size:0.75rem; color:var(--text-dim); font-family:monospace; word-break:break-all;">--</div>
                        </div>
                        <button class="btn btn-sm" onclick="statsModule.closeDetail()" style="background:rgba(255,255,255,0.1); border:1px solid var(--surface-border);">✕ 닫기</button>
                    </div>
                    <div class="stats-metric-grid">
                        <div class="stats-metric-box"><div class="metric-label">총 채팅 메시지</div><div class="metric-value" id="stats-detail-total-msgs" style="color:#f472b6;">--</div><div class="metric-rank" id="stats-detail-total-msgs-rank">전체 --위</div></div>
                        <div class="stats-metric-box"><div class="metric-label">총 라이브 참여시간</div><div class="metric-value" id="stats-detail-total-watch" style="color:#34d399;">--</div><div class="metric-rank" id="stats-detail-total-watch-rank">전체 --위</div></div>
                        <div class="stats-metric-box"><div class="metric-label">오늘 채팅 메시지</div><div class="metric-value" id="stats-detail-today-msgs" style="color:#a78bfa;">--</div><div class="metric-rank" id="stats-detail-today-msgs-rank">오늘 --위</div></div>
                        <div class="stats-metric-box"><div class="metric-label">오늘 라이브 참여시간</div><div class="metric-value" id="stats-detail-today-watch" style="color:#fbbf24;">--</div><div class="metric-rank" id="stats-detail-today-watch-rank">오늘 --위</div></div>
                        <div class="stats-metric-box"><div class="metric-label">총 출석 일수</div><div class="metric-value" id="stats-detail-active-days" style="color:#60a5fa;">--일</div><div class="metric-rank">24시간 기준</div></div>
                        <div class="stats-metric-box"><div class="metric-label">최근 활동 시각</div><div class="metric-value" id="stats-detail-last-active" style="font-size:0.88rem; color:var(--text-main);">--</div><div class="metric-rank" id="stats-detail-last-date">--</div></div>
                    </div>
                    <h4 style="margin:16px 0 10px 0; font-size:0.88rem; color:var(--text-dim);">📅 최근 일자별 활동 이력 (최대 60일)</h4>
                    <div style="max-height:220px; overflow-y:auto; border:1px solid var(--surface-border); border-radius:8px;">
                        <table class="stats-data-table" style="font-size:0.8rem;">
                            <thead><tr><th>날짜</th><th style="text-align:right;">채팅 수</th><th style="text-align:right;">참여시간</th></tr></thead>
                            <tbody id="stats-detail-daily-tbody"><tr><td colspan="3" style="text-align:center; color:var(--text-dim); padding:15px;">기록 없음</td></tr></tbody>
                        </table>
                    </div>
                </div>
            </div>
        `,

        scripts: `
            window.statsModule = (function() {
                let _ws = null;
                let currentPage = 1;
                let pageLimit = 100;
                let totalCount = 0;
                let debounceTimer = null;
                let selectedChannelId = null;

                function setWs(ws) { _ws = ws; }
                function getWs() { return _ws || window.ws; }
                function send(obj) {
                    const socket = getWs();
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify(obj));
                    } else {
                        console.warn('[statsModule] WebSocket is not open, retrying...');
                        setTimeout(() => {
                            const retrySocket = getWs();
                            if (retrySocket && retrySocket.readyState === WebSocket.OPEN) {
                                retrySocket.send(JSON.stringify(obj));
                            }
                        }, 500);
                    }
                }
                function setTxt(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
                function esc(str) { if (!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

                function loadOverview() { send({ action: 'getUserStatsOverview' }); }
                function search(page) {
                    currentPage = page || 1;
                    const input = document.getElementById('stats-search-input');
                    const sortSel = document.getElementById('stats-sort-by');
                    const query = input ? input.value.trim() : '';
                    const sortBy = sortSel ? sortSel.value : 'total_messages';
                    const statusEl = document.getElementById('stats-search-status');
                    if (statusEl) statusEl.textContent = '검색 중...';
                    const offset = (currentPage - 1) * pageLimit;
                    send({ action: 'searchUserStats', payload: { query, sortBy, sortOrder: 'DESC', limit: pageLimit, offset } });
                }
                function onSearchInput() {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => search(1), 250);
                }
                function changePage(delta) {
                    const maxPage = Math.max(1, Math.ceil(totalCount / pageLimit));
                    const target = Math.max(1, Math.min(maxPage, currentPage + delta));
                    if (target !== currentPage) search(target);
                }
                function onChangePageLimit() {
                    const sel = document.getElementById('stats-page-limit');
                    if (sel) { pageLimit = parseInt(sel.value, 10) || 100; search(1); }
                }
                function refresh() { loadOverview(); search(currentPage); }

                function renderOverview(data) {
                    if (!data) return;
                    setTxt('stats-ov-users', (data.totalUsers || 0).toLocaleString() + '명');
                    setTxt('stats-ov-msgs', (data.totalMessages || 0).toLocaleString() + '개');
                    setTxt('stats-ov-today-users', (data.todayUsers || 0).toLocaleString() + '명');
                    setTxt('stats-ov-today-msgs', (data.todayMessages || 0).toLocaleString() + '개');
                }

                function renderSearchResults(data) {
                    const statusEl = document.getElementById('stats-search-status');
                    const countEl = document.getElementById('stats-user-count');
                    const tbody = document.getElementById('stats-users-tbody');
                    if (!tbody) return;
                    if (statusEl) statusEl.textContent = '';
                    totalCount = data.total || 0;
                    if (countEl) countEl.textContent = totalCount.toLocaleString();
                    const maxPage = Math.max(1, Math.ceil(totalCount / pageLimit));
                    setTxt('stats-page-info', currentPage + ' / ' + maxPage + ' (총 ' + totalCount.toLocaleString() + '명)');
                    const prevBtn = document.getElementById('btn-stats-prev');
                    const nextBtn = document.getElementById('btn-stats-next');
                    if (prevBtn) prevBtn.disabled = currentPage <= 1;
                    if (nextBtn) nextBtn.disabled = currentPage >= maxPage;
                    const users = data.users || [];
                    if (users.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-dim); padding:40px;">' + (data.query ? '검색 결과가 없습니다.' : '기록된 유저가 없습니다.') + '</td></tr>';
                        return;
                    }
                    const sortBy = data.sortBy || 'total_messages';
                    tbody.innerHTML = users.map((u, idx) => {
                        let displayRank = (currentPage - 1) * pageLimit + idx + 1;
                        if (sortBy === 'total_messages') displayRank = u.totalMessagesRank;
                        else if (sortBy === 'total_watch_seconds') displayRank = u.totalWatchRank;
                        else if (sortBy === 'today_messages') displayRank = u.todayMessagesRank;
                        else if (sortBy === 'today_watch_seconds') displayRank = u.todayWatchRank;
                        let rankClass = 'stats-rank-badge';
                        if (displayRank === 1) rankClass += ' stats-rank-1';
                        else if (displayRank === 2) rankClass += ' stats-rank-2';
                        else if (displayRank === 3) rankClass += ' stats-rank-3';
                        const rankIcon = displayRank === 1 ? '🥇' : (displayRank === 2 ? '🥈' : (displayRank === 3 ? '🥉' : displayRank));
                        const isSelected = u.channelId === selectedChannelId ? 'selected' : '';
                        const lastDate = u.lastChatDate || '--';
                        return '<tr class="stats-user-row ' + isSelected + '" data-cid="' + esc(u.channelId) + '" onclick="statsModule.showDetail(this.dataset.cid)">'
                            + '<td style="text-align:center;"><span class="' + rankClass + '">' + rankIcon + '</span></td>'
                            + '<td><div style="font-weight:600; color:#fcd34d; font-size:0.9rem;">' + esc(u.displayName) + '</div><div style="font-size:0.72rem; color:var(--text-dim); font-family:monospace;">' + esc(u.channelId) + '</div></td>'
                            + '<td style="text-align:right; font-weight:600; color:#f472b6;">' + (u.totalMessages || 0).toLocaleString() + '개<div style="font-size:0.7rem; color:var(--text-dim); font-weight:400;">' + (u.totalMessagesRank || 1).toLocaleString() + '위</div></td>'
                            + '<td style="text-align:right; font-weight:600; color:#34d399;">' + (u.totalWatchStr || '0분') + '<div style="font-size:0.7rem; color:var(--text-dim); font-weight:400;">' + (u.totalWatchRank || 1).toLocaleString() + '위</div></td>'
                            + '<td style="text-align:right; font-weight:500; color:#a78bfa;">' + (u.todayMessages || 0).toLocaleString() + '개<div style="font-size:0.7rem; color:var(--text-dim); font-weight:400;">' + (u.todayMessagesRank || 1).toLocaleString() + '위</div></td>'
                            + '<td style="text-align:right; font-weight:500; color:#fbbf24;">' + (u.todayWatchStr || '0분') + '<div style="font-size:0.7rem; color:var(--text-dim); font-weight:400;">' + (u.todayWatchRank || 1).toLocaleString() + '위</div></td>'
                            + '<td style="text-align:center; color:#60a5fa; font-weight:600;">' + (u.activeDays || 0).toLocaleString() + '일</td>'
                            + '<td style="text-align:center; font-size:0.75rem; color:var(--text-dim);">' + lastDate + '</td>'
                            + '<td style="text-align:center;"><button class="btn btn-sm" onclick="event.stopPropagation(); statsModule.showDetail(this.parentElement.parentElement.dataset.cid)" style="padding:3px 8px; font-size:0.72rem; background:rgba(139,92,246,0.2); border:1px solid rgba(139,92,246,0.3); color:#c084fc;">조회</button></td>'
                            + '</tr>';
                    }).join('');
                }

                function showDetail(channelId) {
                    if (!channelId) return;
                    selectedChannelId = channelId;
                    document.querySelectorAll('.stats-user-row').forEach(tr => {
                        if (tr.dataset && tr.dataset.cid === channelId) {
                            tr.classList.add('selected');
                        } else {
                            tr.classList.remove('selected');
                        }
                    });
                    const card = document.getElementById('stats-detail-card');
                    const layout = document.querySelector('.stats-layout-wrap');
                    if (card) card.style.display = 'block';
                    if (layout) layout.classList.add('has-detail');
                    send({ action: 'getUserStatsDetail', payload: { channelId } });
                }

                function closeDetail() {
                    selectedChannelId = null;
                    document.querySelectorAll('.stats-user-row').forEach(tr => tr.classList.remove('selected'));
                    const card = document.getElementById('stats-detail-card');
                    const layout = document.querySelector('.stats-layout-wrap');
                    if (card) card.style.display = 'none';
                    if (layout) layout.classList.remove('has-detail');
                }

                function renderDetail(data) {
                    if (!data) return;
                    setTxt('stats-detail-name', data.displayName || '시청자');
                    setTxt('stats-detail-channel', data.channelId || '--');
                    setTxt('stats-detail-total-msgs', (data.totalMessages || 0).toLocaleString() + '개');
                    setTxt('stats-detail-total-msgs-rank', '전체 ' + (data.totalMessagesRank || 1).toLocaleString() + '위');
                    setTxt('stats-detail-total-watch', data.totalWatchStr || '0분');
                    setTxt('stats-detail-total-watch-rank', '전체 ' + (data.totalWatchRank || 1).toLocaleString() + '위');
                    setTxt('stats-detail-today-msgs', (data.todayMessages || 0).toLocaleString() + '개');
                    setTxt('stats-detail-today-msgs-rank', '오늘 ' + (data.todayMessagesRank || 1).toLocaleString() + '위');
                    setTxt('stats-detail-today-watch', data.todayWatchStr || '0분');
                    setTxt('stats-detail-today-watch-rank', '오늘 ' + (data.todayWatchRank || 1).toLocaleString() + '위');
                    setTxt('stats-detail-active-days', (data.daysCount || 0).toLocaleString() + '일');
                    if (data.lastChatTime) {
                        const d = new Date(data.lastChatTime);
                        setTxt('stats-detail-last-active', d.toLocaleTimeString('ko-KR'));
                        setTxt('stats-detail-last-date', data.lastChatDate || d.toLocaleDateString('ko-KR'));
                    } else {
                        setTxt('stats-detail-last-active', '--');
                        setTxt('stats-detail-last-date', '--');
                    }
                    const historyTbody = document.getElementById('stats-detail-daily-tbody');
                    if (historyTbody) {
                        const list = data.dailyHistory || [];
                        if (list.length === 0) {
                            historyTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-dim); padding:15px;">활동 이력이 없습니다.</td></tr>';
                        } else {
                            historyTbody.innerHTML = list.map(item =>
                                '<tr><td style="font-weight:500; color:var(--text-main); font-family:monospace;">' + item.date + '</td>'
                                + '<td style="text-align:right; color:#a78bfa; font-weight:600;">' + (item.messageCount || 0).toLocaleString() + '개</td>'
                                + '<td style="text-align:right; color:#34d399; font-weight:600;">' + (item.watchStr || '0분') + '</td></tr>'
                            ).join('');
                        }
                    }
                }

                return { setWs, refresh, search, onSearchInput, changePage, onChangePageLimit, showDetail, closeDetail, renderOverview, renderSearchResults, renderDetail };
            })();
        `,

        actions: {
            getUserStatsOverview: async () => {
                return statsTracker ? statsTracker.getGlobalOverview() : null;
            },
            searchUserStats: async (payload) => {
                const { query, sortBy, sortOrder, limit, offset } = payload || {};
                return statsTracker
                    ? statsTracker.searchUsers({ query, sortBy, sortOrder, limit: limit || 50, offset: offset || 0 })
                    : { users: [], total: 0 };
            },
            getUserStatsDetail: async (payload) => {
                const { channelId } = payload || {};
                return statsTracker ? statsTracker.getUserDetail(channelId) : null;
            }
        }
    },

    async execute({ cmd, args, displayName, _input, ctx }) {
        if (cfg.stats && !cfg.stats.enable) {
            return ctx.returnWarning(msg.error.stats_disabled, cmd, _input);
        }

        const rawArg = (args && args.length > 0 && typeof args[0] === 'string') ? args[0].trim() : "";

        // 인자가 없는 경우: 기존 내 스탯 조회
        if (!rawArg) {
            const channelId = _input && _input.channelId;
            if (!channelId) {
                return ctx.returnWarning(msg.error.stats_not_found, cmd, _input);
            }

            const stats = statsTracker.getUserStats(channelId, displayName);
            if (!stats) {
                return ctx.returnWarning(msg.error.stats_not_found, cmd, _input);
            }

            ctx.setCooldown(cmd, 0, _input);

            const cleanName = maskProfanity(stats.name);

            const makeMsg = (attempt) => {
                const spaces = " ".repeat(attempt);
                const builtMsg = msg.stats.user_stats(
                    cleanName,
                    stats.totalMsgs,
                    stats.totalRank,
                    stats.daysCount,
                    stats.todayMsgs,
                    stats.todayRank,
                    stats.todayWatchStr,
                    stats.todayWatchRank,
                    stats.totalWatchStr,
                    stats.totalWatchRank,
                    ctx.getCooldownMsg(cmd)
                );
                return `${builtMsg}${spaces}`;
            };

            return {
                msg: makeMsg(0),
                proc: (attempt) => makeMsg(attempt)
            };
        }

        // 1. 전체 통계: '전체'
        if (rawArg === '전체' || rawArg.toLowerCase() === 'all') {
            const overview = statsTracker.getGlobalOverview();
            if (!overview) {
                return ctx.returnWarning(msg.error.stats_not_found, cmd, _input);
            }

            ctx.setCooldown(cmd, 0, _input);

            const makeMsg = (attempt) => {
                const spaces = " ".repeat(attempt);
                const builtMsg = msg.stats.overview(
                    overview.todayUsers.toLocaleString('ko-KR'),
                    overview.todayMessages.toLocaleString('ko-KR'),
                    overview.totalUsers.toLocaleString('ko-KR'),
                    overview.totalMessages.toLocaleString('ko-KR'),
                    overview.top100MsgRatio,
                    overview.totalWatchStr,
                    overview.top100WatchRatio,
                    ctx.getCooldownMsg(cmd)
                );
                return `${builtMsg}${spaces}`;
            };

            return {
                msg: makeMsg(0),
                proc: (attempt) => makeMsg(attempt)
            };
        }

        // 2. 총시간: 전체 참여시간 랭킹
        if (rawArg === '총시간' || rawArg === '전체시간') {
            ctx.setCooldown(cmd, 0, _input);
            const rows = statsTracker.getTopTotalWatch(30);
            return {
                msg: buildRankMessage('총 참여시간 순위', rows, (r) => statsTracker.formatWatchTime(r.total_watch_seconds), cmd, ctx, 0),
                proc: (attempt) => buildRankMessage('총 참여시간 순위', rows, (r) => statsTracker.formatWatchTime(r.total_watch_seconds), cmd, ctx, attempt)
            };
        }

        // 3. 총채팅: 전체 채팅수 랭킹
        if (rawArg === '총채팅' || rawArg === '전체채팅') {
            ctx.setCooldown(cmd, 0, _input);
            const rows = statsTracker.getTopTotalMessages(30);
            return {
                msg: buildRankMessage('총 채팅 순위', rows, (r) => `${r.total_messages.toLocaleString('ko-KR')}개`, cmd, ctx, 0),
                proc: (attempt) => buildRankMessage('총 채팅 순위', rows, (r) => `${r.total_messages.toLocaleString('ko-KR')}개`, cmd, ctx, attempt)
            };
        }

        // 4. 오늘채팅 / 채팅: 오늘 채팅수 랭킹
        if (rawArg === '오늘채팅' || rawArg === '채팅') {
            ctx.setCooldown(cmd, 0, _input);
            const rows = statsTracker.getTopTodayMessages(30);
            return {
                msg: buildRankMessage('오늘 채팅 순위', rows, (r) => `${r.message_count.toLocaleString('ko-KR')}개`, cmd, ctx, 0),
                proc: (attempt) => buildRankMessage('오늘 채팅 순위', rows, (r) => `${r.message_count.toLocaleString('ko-KR')}개`, cmd, ctx, attempt)
            };
        }

        // 5. 오늘시간 / 시간: 오늘 참여시간 랭킹
        if (rawArg === '오늘시간' || rawArg === '시간') {
            ctx.setCooldown(cmd, 0, _input);
            const rows = statsTracker.getTopTodayWatch(30);
            return {
                msg: buildRankMessage('오늘 참여시간 순위', rows, (r) => statsTracker.formatWatchTime(r.watch_seconds), cmd, ctx, 0),
                proc: (attempt) => buildRankMessage('오늘 참여시간 순위', rows, (r) => statsTracker.formatWatchTime(r.watch_seconds), cmd, ctx, attempt)
            };
        }

        // 5개 인자 이외의 입력 시 경고
        return ctx.returnWarning(msg.stats.invalid_arg, cmd, _input);
    }
};
