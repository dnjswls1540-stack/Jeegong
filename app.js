// Jeegong Work Agent Dashboard Application (v1.3.0 - Midnight Auto Reset & Real-time Cloud Sync)

let appData = null;
let currentBriefingId = 'b-20261023';
window.currentBriefingId = currentBriefingId;
let workState = 'ready'; // 'ready' (출근 완료) -> 'checked_in' (업무 종료) -> 'finished' (퇴근 완료)
let lastLocalUpdateTimestamp = 0;
let isSyncing = false;

// Cloud Sync Configuration (Real-time Cross-device Sync)
// Cloud Sync Configuration (ntfy.sh Real-time SSE & Instant Sync - Zero Limit)
const SYNC_TOPIC = 'jeegong_sync_dnjswls1540_2026';
const SYNC_ENDPOINT = 'https://ntfy.sh/' + SYNC_TOPIC;
let syncEventSource = null;

// Multi-date Chat Sessions
let chatSessions = {};
let activeChatDate = '2026-10-22';
let currentAttachments = [];
let currentChatView = 'list'; // 'list' or 'room'
let chatMessages = [];

// =========================================================
// HANDLED ITEMS REGISTRY (Cross-day Deduplication Engine)
// Handled items (done, sent, excluded) will NEVER appear on subsequent days
// =========================================================
let handledRegistry = {};

// Core Tag: normalizes entity across both Emails and Inquiries tabs
function getItemCoreTag(item) {
  if (!item) return '';
  const text = `${item.channel || ''} ${item.service || ''} ${item.from || ''} ${item.subject || ''} ${item.email || ''}`.toLowerCase();
  
  if (text.includes('이준석') || text.includes('sktboypros')) return 'core::lee_junseok';
  if (text.includes('파니맘') || text.includes('synbe.park')) return 'core::panimom';
  if (text.includes('이은희') || text.includes('paynote') || text.includes('페이노트')) return 'core::paynote_eunhee';
  if (text.includes('라운드커머스') || text.includes('타이거모닝')) return 'core::round_tiger';
  if (text.includes('희수') || text.includes('베어메리')) return 'core::heesu_bear';
  if (text.includes('oyka') || text.includes('오이카')) return 'core::oyka_home';
  if (text.includes('크몽') && text.includes('코칭')) return 'core::kmong_coaching';
  if (text.includes('수학논술') || text.includes('kkim0826')) return 'core::math_essay';
  if (text.includes('여행생활') || text.includes('jwnswo1')) return 'core::travel_life';
  if (text.includes('지아이정보') || text.includes('knh135')) return 'core::gi_info';
  
  return '';
}

function getItemFingerprint(item, type = 'inquiry') {
  if (!item) return '';
  if (type === 'inquiry') {
    const ch = (item.channel || '').trim();
    const sender = (item.from || '').trim();
    const subj = (item.subject || '').trim();
    return `inq::${ch}::${sender}::${subj}`;
  } else if (type === 'email') {
    const srv = (item.service || '').trim();
    const sender = (item.from || '').trim();
    const subj = (item.subject || '').trim();
    return `email::${srv}::${sender}::${subj}`;
  }
  return item.id || '';
}

// Auto-harvest handled items from ALL history in appData
function syncHandledFromHistory() {
  if (!appData || !appData.briefings) return;
  appData.briefings.forEach(b => {
    const bDate = b.date;
    (b.emails || []).forEach(e => {
      if (e.status === 'done' || e.status === 'sent' || e.status === 'excluded') {
        const fp = getItemFingerprint(e, 'email');
        const tag = getItemCoreTag(e);
        const rec = { status: e.status, handledDate: bDate, handledTimestamp: 1729500000000 };
        if (fp && !handledRegistry[fp]) handledRegistry[fp] = rec;
        if (tag && !handledRegistry[tag]) handledRegistry[tag] = rec;
      }
    });
    (b.inquiries || []).forEach(i => {
      if (i.status === 'done' || i.status === 'sent' || i.status === 'excluded') {
        const fp = getItemFingerprint(i, 'inquiry');
        const tag = getItemCoreTag(i);
        const rec = { status: i.status, handledDate: bDate, handledTimestamp: 1729500000000 };
        if (fp && !handledRegistry[fp]) handledRegistry[fp] = rec;
        if (tag && !handledRegistry[tag]) handledRegistry[tag] = rec;
      }
    });
  });
}

function loadHandledRegistry() {
  try {
    const saved = localStorage.getItem('jeegong_handled_registry');
    if (saved) {
      handledRegistry = JSON.parse(saved);
    }
  } catch (e) {
    handledRegistry = {};
  }

  // Pre-seed known handled items from 10/21 and 10/22 so they NEVER appear as duplicates on 10/23+
  const seedItems = [
    // 10/21
    { tag: 'core::heesu_bear', type: 'inquiry', channel: '네이버 메일', from: '인플루언서 희수 님', subject: '오슬로앤오십구 겨울 베어메리 공구 일정 소통', status: 'done', date: '2026-10-21' },
    { tag: 'core::oyka_home', type: 'inquiry', channel: '아임웹', from: 'OYKA HOME 담당자', subject: '쇼핑몰 신규 구축 견적 및 제작 기간 문의', status: 'done', date: '2026-10-21' },
    { tag: 'core::kmong_coaching', type: 'inquiry', channel: '크몽', from: '크몽 의뢰인 (김** 님)', subject: '공동구매 중개 노하우 1:1 코칭권 일정 문의', status: 'done', date: '2026-10-21' },
    // 10/22
    { tag: 'core::panimom', type: 'email', service: '네이버 메일', from: '인플루언서 파니맘 (synbe.park@gmail.com)', subject: 'Re: [공구 제안] 100% 생과일 아넬라 퓨레, 공구 협업 제안드립니다.│올쓰컴퍼니', status: 'done', date: '2026-10-22' },
    { tag: 'core::panimom', type: 'inquiry', channel: '네이버 메일', from: '인플루언서 파니맘', subject: '아넬라 과일퓨레 공구 일정 검토 회신', status: 'done', date: '2026-10-22' },
    { tag: 'core::lee_junseok', type: 'email', service: '지메일 (온세스)', from: '식스샵 프로 고객지원 (help-pro@sixshop.com)', subject: '[식스샵 파트너] 바로 상담할 수 있는 웹사이트 제작 신규 프로젝트 (이준석 대표)', status: 'done', date: '2026-10-22' },
    { tag: 'core::lee_junseok', type: 'inquiry', channel: '식스샵', from: '이준석 대표 (010-5754-6610)', subject: '홈페이지 리모델링 및 AI 견적 연동 신규 의뢰 (예산 100~200만 원)', status: 'done', date: '2026-10-22' },
    { tag: 'core::paynote_eunhee', type: 'email', service: '네이버 메일', from: '지공의 페이노트 (no-reply@paynote.co.kr)', subject: '[결제완료] 전자책 결제 완료 안내 (이은희 님, 129,000원)', status: 'done', date: '2026-10-22' },
    { tag: 'core::round_tiger', type: 'email', service: '네이버 메일', from: '라운드커머스 마케팅팀 (roundcommerce@gmail.com)', subject: '타이거모닝 진저샷 공동구매 운영 파트너십 제안', status: 'done', date: '2026-10-22' }
  ];

  seedItems.forEach(seed => {
    const fp = getItemFingerprint(seed, seed.type);
    const rec = {
      status: seed.status,
      handledDate: seed.date,
      handledTimestamp: 1729500000000
    };
    if (fp && !handledRegistry[fp]) handledRegistry[fp] = rec;
    if (seed.tag && !handledRegistry[seed.tag]) handledRegistry[seed.tag] = rec;
  });

  saveHandledRegistry();
}

function saveHandledRegistry() {
  try {
    localStorage.setItem('jeegong_handled_registry', JSON.stringify(handledRegistry));
  } catch (e) {}
}

function recordHandledItem(item, type, status) {
  const fp = getItemFingerprint(item, type);
  const tag = getItemCoreTag(item);
  const kst = getKSTNow();
  const b = (appData && appData.briefings) ? (appData.briefings.find(x => x.id === currentBriefingId) || appData.briefings[0]) : null;
  const itemDate = (b && b.date) ? b.date : kst.dateStr;

  const rec = {
    status: status,
    handledDate: itemDate,
    handledTimestamp: Date.now()
  };

  if (status === 'pending') {
    if (fp) delete handledRegistry[fp];
    if (tag) delete handledRegistry[tag];
  } else {
    if (fp) handledRegistry[fp] = rec;
    if (tag) handledRegistry[tag] = rec;
  }
  saveHandledRegistry();
  pushCloudState();
}

function isItemHandledOnPreviousDay(item, type, viewingDate) {
  if (!item) return false;
  
  // 1. Check core tag
  const tag = getItemCoreTag(item);
  if (tag && handledRegistry[tag]) {
    const rec = handledRegistry[tag];
    if (rec.status && rec.status !== 'pending') {
      if (!rec.handledDate || rec.handledDate < viewingDate) {
        return true;
      }
    }
  }

  // 2. Check fingerprint
  const fp = getItemFingerprint(item, type);
  if (fp && handledRegistry[fp]) {
    const rec = handledRegistry[fp];
    if (rec.status && rec.status !== 'pending') {
      if (!rec.handledDate || rec.handledDate < viewingDate) {
        return true;
      }
    }
  }

  return false;
}

function getFilteredInquiries(b) {
  if (!b || !b.inquiries) return [];
  const kst = getKSTNow();
  const viewingDate = b.date || kst.dateStr;

  return b.inquiries.filter(inq => {
    // If it was already handled on a previous day, NEVER show it on a subsequent day!
    if (isItemHandledOnPreviousDay(inq, 'inquiry', viewingDate)) {
      return false;
    }
    const tag = getItemCoreTag(inq);
    const fp = getItemFingerprint(inq, 'inquiry');
    const rec = (tag && handledRegistry[tag]) || (fp && handledRegistry[fp]);
    if (rec) {
      inq.status = rec.status;
    }
    return true;
  });
}

function getFilteredEmails(b) {
  if (!b || !b.emails) return [];
  const kst = getKSTNow();
  const viewingDate = b.date || kst.dateStr;

  return b.emails.filter(mail => {
    // If it was already handled on a previous day, NEVER show it on a subsequent day!
    if (isItemHandledOnPreviousDay(mail, 'email', viewingDate)) {
      return false;
    }
    const tag = getItemCoreTag(mail);
    const fp = getItemFingerprint(mail, 'email');
    const rec = (tag && handledRegistry[tag]) || (fp && handledRegistry[fp]);
    if (rec) {
      mail.status = rec.status;
    }
    return true;
  });
}


// KST Date Helper
function getKSTNow() {
  const now = new Date();
  const d = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dayOfWeek = days[d.getDay()];
  const dateStr = `${year}-${month}-${day}`;
  const displayStr = `${year}-${month}-${day} (${dayOfWeek})`;
  return { year, month, day, dayOfWeek, dateStr, displayStr, d };
}

// Work Button UI Updater (Global Scope)
function updateWorkButtonUI() {
  const btnRun = document.getElementById('btn-run-agent');
  if (!btnRun) return;
  if (workState === 'checked_in') {
    btnRun.className = 'btn-primary work-active';
    btnRun.innerHTML = '<span>🌙</span><span id="btn-run-agent-text">업무 종료</span>';
    btnRun.disabled = false;
  } else if (workState === 'finished') {
    btnRun.className = 'btn-primary work-finished';
    btnRun.innerHTML = '<span>🎉</span><span id="btn-run-agent-text">퇴근 완료 ✓</span>';
    btnRun.disabled = false;
  } else {
    btnRun.className = 'btn-primary';
    btnRun.innerHTML = '<span>✨</span><span id="btn-run-agent-text">출근 완료</span>';
    btnRun.disabled = false;
  }
}


// Local Persistence for Todos and Priorities (새로고침 시 미처리 할 일 체크 방지 엔진)
function saveLocalTodosState(briefingId) {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === briefingId) || appData.briefings[0];
  if (!b) return;
  const kst = getKSTNow();
  const dateKey = b.date || kst.dateStr;

  const doneTodos = (b.todomateTodos || []).filter(t => t.done).map(t => t.text || t.id);
  const donePriorities = (b.agentPriorities || []).filter(ap => ap.done).map(ap => ap.id);

  try {
    localStorage.setItem(`jeegong_done_todos_${dateKey}`, JSON.stringify(doneTodos));
    localStorage.setItem(`jeegong_done_priorities_${dateKey}`, JSON.stringify(donePriorities));
  } catch (e) {}
}

function restoreLocalTodosState(briefingId) {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === briefingId) || appData.briefings[0];
  if (!b) return;
  const kst = getKSTNow();
  const dateKey = b.date || kst.dateStr;

  try {
    const savedTodos = localStorage.getItem(`jeegong_done_todos_${dateKey}`);
    if (savedTodos !== null) {
      const doneList = JSON.parse(savedTodos);
      (b.todomateTodos || []).forEach(t => {
        t.done = doneList.includes(t.text) || doneList.includes(t.id);
      });
    }
    const savedPriorities = localStorage.getItem(`jeegong_done_priorities_${dateKey}`);
    if (savedPriorities !== null) {
      const donePriorities = JSON.parse(savedPriorities);
      (b.agentPriorities || []).forEach(ap => {
        ap.done = donePriorities.includes(ap.id);
      });
    }
  } catch (e) {}
}

// Midnight Daily Reset (자정 지나면 퇴근 안 눌러도 출근 버튼 자동 초기화 & 날짜 매일 업데이트)
function checkMidnightReset() {
  const kst = getKSTNow();

  // 1. Always keep current date badge updated
  const dateBadge = document.getElementById('current-date-text');
  if (dateBadge && dateBadge.textContent !== kst.displayStr) {
    dateBadge.textContent = kst.displayStr;
  }

  // 2. Check if day has changed (Midnight passed)
  const savedWorkDate = localStorage.getItem('jeegong_work_date');
  if (savedWorkDate !== kst.dateStr) {
    // New day has arrived! Reset work state to ready (출근 완료)
    workState = 'ready';
    try {
      localStorage.setItem('jeegong_work_date', kst.dateStr);
      localStorage.setItem('jeegong_work_state', 'ready');
    } catch (e) {}
    updateWorkButtonUI();

    // Automatically select today's briefing if available
    if (appData && appData.briefings) {
      const todayB = appData.briefings.find(b => b.date === kst.dateStr);
      if (todayB && currentBriefingId !== todayB.id) {
        currentBriefingId = todayB.id;
        renderTodayView();
      }
    }

    pushCloudState();
  }
}

// Initialize Application
async function initApp() {
  const kst = getKSTNow();

  try {
    const res = await fetch('data.json?v=' + Date.now());
    appData = await res.json();
  } catch (e) {
    console.error('Failed to load data.json', e);
  }

  // 1. Dynamically select today's briefing if available
  if (appData && appData.briefings && appData.briefings.length > 0) {
    const todayB = appData.briefings.find(b => b.date === kst.dateStr);
    currentBriefingId = todayB ? todayB.id : appData.briefings[0].id;
    window.currentBriefingId = currentBriefingId;
    window.appData = appData;
  }

  // 2. Daily reset check on startup
  const savedWorkDate = localStorage.getItem('jeegong_work_date');
  if (savedWorkDate !== kst.dateStr) {
    workState = 'ready';
    try {
      localStorage.setItem('jeegong_work_date', kst.dateStr);
      localStorage.setItem('jeegong_work_state', 'ready');
    } catch (e) {}
  } else {
    workState = localStorage.getItem('jeegong_work_state') || 'ready';
  }

  // 3. Load chat sessions from localStorage
  try {
    const savedSessions = localStorage.getItem('jeegong_chat_sessions');
    if (savedSessions) {
      chatSessions = JSON.parse(savedSessions);
    }
  } catch (e) {}

  if (!chatSessions[kst.dateStr]) {
    chatSessions[kst.dateStr] = [
      {
        role: 'bot',
        text: '지원진 님 안녕하세요! 구름이예요 ㅎㅎ 오늘 우주맘마 아넬라 공구 오픈과 식스샵 외주 회신 등 업무들 차근차근 챙겨드릴게요. 궁금하신 점이나 처리할 일 있으시면 말씀해 주세요!',
        time: '08:30'
      }
    ];
  }
  activeChatDate = kst.dateStr;

  // 4. Update top navbar date badge
  const dateBadge = document.getElementById('current-date-text');
  if (dateBadge) {
    dateBadge.textContent = kst.displayStr;
  }

  loadHandledRegistry();
  syncHandledFromHistory();
  restoreLocalTodosState(currentBriefingId);
  setupTheme();
  setupNavigation();
  updateWorkButtonUI();
  setupInteractions();
  setupChatbot();
  renderTodayView();
  renderArchiveView();
  renderHistoryView();

  // Setup Real-time SSE Sync & Midnight Auto Reset
  setupRealtimeSync();
  setInterval(checkMidnightReset, 5000);

  // Background Auto-Refresh (Every 30s + on focus/visibility)
  setInterval(() => {
    window.refreshDashboardData(false);
  }, 30000);

  window.addEventListener('focus', () => {
    window.refreshDashboardData(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      window.refreshDashboardData(false);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}



// Theme Management
function setupTheme() {
  const toggleBtn = document.getElementById('btn-theme-toggle');
  const savedTheme = localStorage.getItem('jeegong_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  toggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('jeegong_theme', next); } catch (e) {}
    updateThemeIcon(next);
  });
}

function updateThemeIcon(theme) {
  const toggleBtn = document.getElementById('btn-theme-toggle');
  toggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// Navigation (Desktop Sidebar & Mobile Segmented Tabs)
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const mobileTabBtns = document.querySelectorAll('.mobile-tab-btn');
  const viewSections = document.querySelectorAll('.view-section');
  const topTitle = document.getElementById('page-title');

  const titles = {
    'today-view': '오늘의 브리핑',
    'inquiry-view': '실시간 고객 문의',
    'archive-view': '날짜별 아카이브',
    'history-view': '실행 이력 & 로그',
    'settings-view': '에이전트 설정'
  };

  function switchView(viewId) {
    navItems.forEach(n => {
      if (n.getAttribute('data-view') === viewId) n.classList.add('active');
      else n.classList.remove('active');
    });

    mobileTabBtns.forEach(m => {
      if (m.getAttribute('data-view') === viewId) m.classList.add('active');
      else m.classList.remove('active');
    });

    viewSections.forEach(v => {
      if (v.id === viewId) v.classList.add('active');
      else v.classList.remove('active');
    });

    if (topTitle) topTitle.textContent = '지공 출근 에이전트';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.getAttribute('data-view'));
    });
  });

  mobileTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.getAttribute('data-view'));
    });
  });
}

// Render Today's Briefing
function renderTodayView() {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];

  // Stats Counters with Defensive Checks
  const calCountEl = document.getElementById('stat-calendar-count');
  if (calCountEl && b.calendar) calCountEl.textContent = `${b.calendar.count}건`;

  const emailCountEl = document.getElementById('stat-email-count');
  if (emailCountEl && b.emails) emailCountEl.textContent = `${b.emails.filter(m => m.status !== 'excluded').length}건`;

  const todoCountEl = document.getElementById('stat-todo-count');
  if (todoCountEl && b.todomateTodos) todoCountEl.textContent = `${b.todomateTodos.filter(t => !t.done).length}건`;

  const driveCountEl = document.getElementById('stat-drive-count');
  if (driveCountEl && b.driveFiles) driveCountEl.textContent = `${b.driveFiles.length}건`;

  const inqCountEl = document.getElementById('stat-inquiry-count');
  if (inqCountEl && b.inquiries) inqCountEl.textContent = `${b.inquiries.filter(i => i.status !== 'excluded' && i.status !== 'done' && i.status !== 'sent').length}건`;

  // Guide
  const guideEl = document.getElementById('guide-banner-text');
  if (guideEl) guideEl.textContent = b.guide;

  // 1. Calendar
  const calContainer = document.getElementById('calendar-list-container');
  calContainer.innerHTML = '';
  if (b.calendar.count === 0) {
    calContainer.innerHTML = `<div class="empty-state">${b.calendar.note}</div>`;
  } else {
    b.calendar.items.forEach(cal => {
      calContainer.innerHTML += `
        <div class="schedule-item">
          <div class="schedule-time">${cal.time}</div>
          <div class="schedule-main">
            <div class="schedule-title">${cal.title}</div>
            <div class="schedule-meta">${cal.location || '온라인'} · ${cal.attendees || '단독'}</div>
          </div>
        </div>
      `;
    });
  }

  // 2. Emails (with Exclude & Process System + Cross-day Deduplication)
  const emailContainer = document.getElementById('email-list-container');
  emailContainer.innerHTML = '';
  
  const filteredEmails = getFilteredEmails(b);
  const emailBadge = document.getElementById('email-badge');
  if (emailBadge) {
    emailBadge.textContent = `${filteredEmails.filter(e => e.status !== 'excluded' && e.status !== 'done' && e.status !== 'sent').length}건 조치 필요`;
  }

  // Update stat counters with deduplicated counts
  if (emailCountEl) emailCountEl.textContent = `${filteredEmails.filter(m => m.status !== 'excluded').length}건`;
  const filteredInqsForStat = getFilteredInquiries(b);
  if (inqCountEl) inqCountEl.textContent = `${filteredInqsForStat.filter(i => i.status !== 'excluded' && i.status !== 'done' && i.status !== 'sent').length}건`;

  // Sort emails: actionable first, (done, sent, excluded) at the bottom
  const sortedEmails = [...filteredEmails].sort((a, b) => {
    const aHandled = a.status === 'done' || a.status === 'sent' || a.status === 'excluded';
    const bHandled = b.status === 'done' || b.status === 'sent' || b.status === 'excluded';
    if (aHandled === bHandled) return 0;
    return aHandled ? 1 : -1;
  });

  sortedEmails.forEach(mail => {
    const isP1 = mail.priority.includes('1순위');
    const pClass = isP1 ? 'p1' : 'p2';
    const badgeClass = isP1 ? 'badge-p1' : 'badge-p2';
    const isExcluded = mail.status === 'excluded';
    const isDone = mail.status === 'done';
    const isSent = mail.status === 'sent';

    emailContainer.innerHTML += `
      <div class="email-item ${pClass} ${isExcluded ? 'excluded' : ''} ${isDone || isSent ? 'done' : ''}" id="email-item-${mail.id}">
        <div class="email-top">
          <div class="email-badges-row">
            <div class="email-badges-left">
              <span class="badge-tag ${badgeClass}">${mail.priority}</span>
              <span class="badge-tag badge-service">${mail.service}</span>
              <span class="email-from" title="${mail.from}">${mail.from}</span>
            </div>
            <div class="email-badges-right">
              ${isDone ? '<span class="badge-tag badge-status-done">직접 완료 ✓</span>' : ''}
              ${isSent ? '<span class="badge-tag badge-status-sent">발송 완료 ✓</span>' : ''}
              ${isExcluded ? '<span class="badge-tag badge-status-excluded">제외됨</span>' : ''}
            </div>
          </div>
        </div>
        <div class="email-subject">${mail.subject}</div>
        <div class="email-summary">${mail.summary || mail.preview || ''}</div>

        <div class="email-actions-bar">
          <div class="email-status-text">
            ${isSent ? '담당자에게 승인된 답장 발송이 완료되었습니다.' : mail.status === 'done' ? '직접 처리 완료됨 ✓' : isExcluded ? '브리핑 목록에서 제외되었습니다.' : '조치 필요'}
          </div>
          <div class="email-action-btns">
            ${!isSent ? `
              <button class="btn-exclude" onclick="toggleExcludeEmail('${mail.id}')">
                ${isExcluded ? '복구' : '제외'}
              </button>
              ${mail.status !== 'done' && !isExcluded ? `
                <button class="btn-done" onclick="markDoneEmail('${mail.id}')">
                  직접 완료
                </button>
              ` : mail.status === 'done' ? `
                <button class="btn-exclude" onclick="unmarkDoneEmail('${mail.id}')">
                  되돌리기
                </button>
              ` : ''}
              ${!isExcluded && mail.status !== 'done' ? `
                <button class="btn-process" onclick="openProcessDraft('${mail.id}')">
                  답장 처리
                </button>
              ` : ''}
            ` : ''}
          </div>
        </div>

        <!-- Inline Draft Editor Box -->
        <div class="inline-draft-box" id="draft-box-${mail.id}">
          <div class="draft-header">
            <span>✍️ 구름이 답장 초안 (수정 후 승인 시 발송)</span>
            <span style="font-size: 11.5px; color: var(--text-tertiary);">수신: ${mail.from}</span>
          </div>
          <textarea class="draft-textarea" id="draft-text-${mail.id}">${mail.draft}</textarea>
          <div class="draft-actions">
            <button class="btn-secondary" onclick="closeProcessDraft('${mail.id}')" style="padding: 5px 12px; font-size: 12px;">닫기</button>
            <button class="btn-primary" onclick="approveAndSendEmail('${mail.id}')" style="padding: 6px 14px; font-size: 12px;">
              <span>승인 및 메일 발송</span>
              <span>✈️</span>
            </button>
          </div>
        </div>
      </div>
    `;
  });

  // 2-B. Customer Inquiries (Kmong, Imweb, Mail)
  renderInquiries(b, 'inquiry-list-container', 'inquiry-badge');
  renderInquiries(b, 'inquiry-exclusive-list-container', 'inquiry-exclusive-badge');

  // 3-A. Todomate Todos (Separated - Completed items sink to bottom)
  const todoContainer = document.getElementById('todomate-list-container');
  if (todoContainer) todoContainer.innerHTML = '';
  const todoBadge = document.getElementById('todomate-count-badge');
  if (todoBadge) todoBadge.textContent = `${(b.todomateTodos || []).filter(t => !t.done).length}건 대기`;

  const sortedTodos = [...(b.todomateTodos || [])].sort((a, b) => {
    if (a.done === b.done) return 0;
    return a.done ? 1 : -1;
  });

  sortedTodos.forEach(todo => {
    const isDone = todo.done;
    todoContainer.innerHTML += `
      <div class="todo-item ${isDone ? 'completed' : ''}" onclick="toggleTodomateTodo('${todo.id}')">
        <div class="todo-checkbox ${isDone ? 'checked' : ''}">
          ${isDone ? '✓' : ''}
        </div>
        <div class="todo-text">${todo.text}</div>
        <span class="section-badge" style="font-size: 11px;">${todo.category || '투두메이트'}</span>
      </div>
    `;
  });

  // 3-B. Agent Recommended Priorities (Accordion Toggles - Finished items sink to bottom)
  const agentContainer = document.getElementById('agent-priority-container');
  agentContainer.innerHTML = '';

  const sortedAgentPriorities = [...b.agentPriorities].sort((a, b) => {
    const aFinished = a.done || a.excluded;
    const bFinished = b.done || b.excluded;
    if (aFinished === bFinished) return 0;
    return aFinished ? 1 : -1;
  });

  sortedAgentPriorities.forEach(ap => {
    const isP1 = ap.priority.includes('1순위');
    const badgeClass = isP1 ? 'priority-p1' : 'priority-p2';
    const isDone = ap.done;
    const isExcluded = ap.excluded;

    agentContainer.innerHTML += `
      <div class="accordion-item ${isDone ? 'done' : ''} ${isExcluded ? 'excluded' : ''}" id="accordion-${ap.id}">
        <div class="accordion-header">
          <div class="accordion-header-left" onclick="toggleAccordion('${ap.id}')">
            <div class="todo-checkbox ${isDone ? 'checked' : ''}" onclick="event.stopPropagation(); toggleAgentPriorityDone('${ap.id}')" title="직접 완료 표시">
              ${isDone ? '✓' : ''}
            </div>
            <span class="todo-priority ${badgeClass}">${ap.priority}</span>
            <div class="accordion-title">${ap.title}</div>
          </div>
          <div class="accordion-header-right">
            <button class="btn-exclude-mini" onclick="toggleAgentPriorityExclude('${ap.id}')">
              ${isExcluded ? '복구' : '제외'}
            </button>
            <span class="accordion-arrow" onclick="toggleAccordion('${ap.id}')">▼</span>
          </div>
        </div>
        <div class="accordion-content">
          <div style="display: flex; align-items: flex-start; gap: 8px;">
            <span style="font-size: 14px; line-height: 1.4;">💡</span>
            <div>
              <div style="font-size: 11px; font-weight: 700; color: var(--accent-blue); margin-bottom: 2px;">우선순위 선정 사유</div>
              <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.6;">${ap.detail || ap.desc || ap.reason || '상세 사유가 등록되지 않았습니다.'}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  // 4. Drive References
  const driveContainer = document.getElementById('drive-list-container');
  driveContainer.innerHTML = '';
  b.driveFiles.forEach(file => {
    const icon = file.type === 'sheet' ? '📊' : file.type === 'pdf' ? '📕' : '📄';
    driveContainer.innerHTML += `
      <div class="drive-item">
        <div class="drive-left">
          <span class="drive-file-icon">${icon}</span>
          <div>
            <div class="drive-filename">${file.name}</div>
            <div class="drive-meta">최종 수정: ${file.modified} · Google Drive</div>
          </div>
        </div>
        <a href="${file.url}" target="_blank" class="btn-open-link">
          <span>열기</span>
          <span>↗</span>
        </a>
      </div>
    `;
  });
}

// Email Mark Done / Unmark Done
window.markDoneEmail = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const mail = b.emails.find(m => m.id === id);
  if (!mail) return;
  mail.status = 'done';
  recordHandledItem(mail, 'email', 'done');
  renderTodayView();
  showToast('메일이 직접 처리 완료 상태로 변경되었습니다. (다음 날 목록에서 자동 제외)');
  pushCloudState();
};

window.unmarkDoneEmail = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const mail = b.emails.find(m => m.id === id);
  if (!mail) return;
  mail.status = 'pending';
  recordHandledItem(mail, 'email', 'pending');
  renderTodayView();
  showToast('메일 완료 상태가 취소되었습니다.');
  pushCloudState();
};

// Agent Priority Done / Exclude Handlers
window.toggleAgentPriorityDone = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const ap = b.agentPriorities.find(item => item.id === id);
  if (!ap) return;
  ap.done = !ap.done;
  saveLocalTodosState(currentBriefingId);
  renderTodayView();
  showToast(ap.done ? '해당 우선순위 업무를 완료 처리했습니다!' : '완료 처리를 취소했습니다.');
  pushCloudState();
};

window.toggleAgentPriorityExclude = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const ap = b.agentPriorities.find(item => item.id === id);
  if (!ap) return;
  ap.excluded = !ap.excluded;
  renderTodayView();
  showToast(ap.excluded ? '해당 우선순위 업무를 제외 처리했습니다.' : '제외 처리를 복구했습니다.');
  pushCloudState();
};

// Email Exclude / Restore
// Render Customer Inquiries (Kmong, Imweb, Mail) with Cross-day Deduplication & Responsive Badges
function renderInquiries(b, containerId, badgeId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!b.inquiries) b.inquiries = [];

  const filteredInquiries = getFilteredInquiries(b);

  const badge = document.getElementById(badgeId);
  const pendingCount = filteredInquiries.filter(i => i.status !== 'excluded' && i.status !== 'done' && i.status !== 'sent').length;
  if (badge) {
    badge.textContent = `${pendingCount}건 대기`;
  }

  container.innerHTML = '';
  if (filteredInquiries.length === 0) {
    container.innerHTML = '<div class="empty-state">현재 인입된 신규 고객 문의가 없습니다.</div>';
    return;
  }

  // Sort: actionable first, (done, sent, excluded) at the bottom
  const sortedInquiries = [...filteredInquiries].sort((a, b) => {
    const aHandled = a.status === 'done' || a.status === 'sent' || a.status === 'excluded';
    const bHandled = b.status === 'done' || b.status === 'sent' || b.status === 'excluded';
    if (aHandled === bHandled) return 0;
    return aHandled ? 1 : -1;
  });

  sortedInquiries.forEach(inq => {
    const isExcluded = inq.status === 'excluded';
    const isDone = inq.status === 'done';
    const isSent = inq.status === 'sent';
    const chClass = inq.channel === '식스샵' ? 'channel-sixshop' : inq.channel === '크몽' ? 'channel-kmong' : inq.channel === '아임웹' ? 'channel-imweb' : inq.channel === '네이버 메일' ? 'channel-naver' : 'channel-gmail';
    const badgeChClass = inq.channel === '식스샵' ? 'badge-channel-sixshop' : inq.channel === '크몽' ? 'badge-channel-kmong' : inq.channel === '아임웹' ? 'badge-channel-imweb' : inq.channel === '네이버 메일' ? 'badge-channel-naver' : 'badge-channel-gmail';

    container.innerHTML += `
      <div class="inquiry-item ${chClass} ${isExcluded ? 'excluded' : ''} ${isDone || isSent ? 'done' : ''}" id="inquiry-item-${containerId}-${inq.id}">
        <div class="email-top">
          <div class="email-badges-row">
            <div class="email-badges-left">
              <span class="badge-tag ${badgeChClass}">${inq.channel} 문의</span>
              <span class="email-sender" title="${inq.from}">${inq.from}</span>
              <span class="email-time" style="font-size: 11.5px; color: var(--text-tertiary);">${inq.time}</span>
            </div>
            <div class="email-badges-right">
              ${isDone ? '<span class="badge-tag badge-status-done">직접 답변 완료 ✓</span>' : ''}
              ${isSent ? '<span class="badge-tag badge-status-sent">발송 완료 ✓</span>' : ''}
              ${isExcluded ? '<span class="badge-tag badge-status-excluded">제외됨</span>' : ''}
            </div>
          </div>
        </div>

        <div class="email-subject">${inq.subject}</div>
        <div class="email-summary">${inq.content}</div>

        <div class="email-actions-bar">
          <div class="email-status-text">
            ${isSent ? '담당자에게 승인된 답변 발송이 완료되었습니다.' : isDone ? '직접 답변 완료됨 ✓' : isExcluded ? '브리핑 목록에서 제외되었습니다.' : '조치 필요'}
          </div>
          <div class="email-action-btns">
            ${!isSent ? `
              <button class="btn-exclude" onclick="toggleInquiryExclude('${inq.id}')">
                ${isExcluded ? '복구' : '제외'}
              </button>
              ${!isDone && !isExcluded ? `
                <button class="btn-done" onclick="toggleInquiryDirectDone('${inq.id}')">
                  직접 완료
                </button>
              ` : isDone ? `
                <button class="btn-exclude" onclick="toggleInquiryDirectDone('${inq.id}')">
                  되돌리기
                </button>
              ` : ''}
              ${!isExcluded && !isDone ? `
                <button class="btn-process" onclick="openInquiryProcessDraft('${containerId}-${inq.id}')">
                  답장 처리
                </button>
              ` : ''}
            ` : ''}
          </div>
        </div>

        <!-- Inline Draft Box -->
        <div class="inline-draft-box" id="inquiry-draft-box-${containerId}-${inq.id}">
          <div class="draft-header">
            <span>✍️ 구름이 고객 응대 초안 (수정 후 승인 시 답변 발송)</span>
            <span style="font-size: 11.5px; color: var(--text-tertiary);">수신: ${inq.from}</span>
          </div>
          <textarea class="draft-textarea" id="inquiry-draft-text-${containerId}-${inq.id}">${inq.draft}</textarea>
          <div class="draft-actions">
            <button class="btn-secondary" onclick="closeInquiryProcessDraft('${containerId}-${inq.id}')" style="padding: 5px 12px; font-size: 12px;">닫기</button>
            <button class="btn-primary" onclick="approveAndSendInquiry('${inq.id}', '${containerId}-${inq.id}')" style="padding: 6px 14px; font-size: 12px;">
              <span>승인 및 답변 발송</span>
              <span>✈️</span>
            </button>
          </div>
        </div>
      </div>
    `;
  });
}

// [Duplicate sync removed - unified implementation at bottom]

// Inquiry Action Handlers (with Handled Registry Tracking)
window.toggleInquiryDirectDone = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  if (!b || !b.inquiries) return;
  const inq = b.inquiries.find(i => i.id === id);
  if (!inq) return;

  if (inq.status === 'done') {
    inq.status = 'pending';
    recordHandledItem(inq, 'inquiry', 'pending');
    showToast('문의 항목이 조치 대기 상태로 복구되었습니다.');
  } else {
    inq.status = 'done';
    recordHandledItem(inq, 'inquiry', 'done');
    showToast('문의 항목이 직접 완료 처리되었습니다. (다음 날 목록에서 자동 제외)');
  }
  renderTodayView();
  pushCloudState();
};

window.toggleInquiryExclude = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  if (!b || !b.inquiries) return;
  const inq = b.inquiries.find(i => i.id === id);
  if (!inq) return;

  if (inq.status === 'excluded') {
    inq.status = 'pending';
    recordHandledItem(inq, 'inquiry', 'pending');
    showToast('문의 항목이 복구되었습니다.');
  } else {
    inq.status = 'excluded';
    recordHandledItem(inq, 'inquiry', 'excluded');
    showToast('문의 항목이 제외 처리되었습니다. (다음 날 목록에서 자동 제외)');
  }
  renderTodayView();
  pushCloudState();
};

window.openInquiryProcessDraft = function(domId) {
  const box = document.getElementById(`inquiry-draft-box-${domId}`);
  if (box) box.classList.toggle('active');
};

window.closeInquiryProcessDraft = function(domId) {
  const box = document.getElementById(`inquiry-draft-box-${domId}`);
  if (box) box.classList.remove('active');
};

window.approveAndSendInquiry = async function(id, domId) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  if (!b || !b.inquiries) return;
  const inq = b.inquiries.find(i => i.id === id);
  if (!inq) return;

  const textEl = document.getElementById(`inquiry-draft-text-${domId}`);
  if (textEl) inq.draft = textEl.value;

  inq.status = 'sent';
  recordHandledItem(inq, 'inquiry', 'sent');
  closeInquiryProcessDraft(domId);
  renderTodayView();

  // Publish Send Request to ntfy Queue if inquiry has draftId / email
  if (inq.draftId || inq.account) {
    try {
      const sendPayload = {
        action: 'send_email',
        timestamp: Date.now(),
        emailId: inq.id,
        draftId: inq.draftId || '',
        account: inq.account || 'onsessdesign@gmail.com',
        recipient: inq.from,
        subject: inq.subject,
        body: inq.draft
      };
      await fetch(`${SYNC_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Title': `[Jeegong Send Request] ${inq.id}`,
          'Tags': 'email,outbox'
        },
        body: JSON.stringify(sendPayload)
      });
    } catch (err) {
      console.warn('send request publish error:', err);
    }
  }

  pushCloudState();
  showToast(`[답변 발송 완료] ${inq.from} 님께 맞춤 답변이 전송되었습니다! 🚀 (다음 날 목록에서 자동 제외)`);
};

window.toggleExcludeEmail = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const mail = b.emails.find(m => m.id === id);
  if (!mail) return;

  if (mail.status === 'excluded') {
    mail.status = 'pending';
    recordHandledItem(mail, 'email', 'pending');
    showToast('메일 항목이 브리핑에 복구되었습니다.');
    pushCloudState();
  } else {
    mail.status = 'excluded';
    recordHandledItem(mail, 'email', 'excluded');
    // close draft if open
    const draftBox = document.getElementById(`draft-box-${id}`);
    if (draftBox) draftBox.classList.remove('active');
    showToast('메일 항목이 제외 처리되었습니다. (다음 날 목록에서 자동 제외)');
    pushCloudState();
  }
  renderTodayView();
};

// Open Process Draft Box
window.openProcessDraft = function(id) {
  const box = document.getElementById(`draft-box-${id}`);
  if (box) {
    box.classList.toggle('active');
  }
};

window.closeProcessDraft = function(id) {
  const box = document.getElementById(`draft-box-${id}`);
  if (box) box.classList.remove('active');
};

// Approve and Send Email (실제 Gmail 발송 큐 연동)
window.approveAndSendEmail = async function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const mail = b.emails.find(m => m.id === id);
  if (!mail) return;

  const textEl = document.getElementById(`draft-text-${id}`);
  if (textEl) {
    mail.draft = textEl.value;
  }

  mail.status = 'sent';
  recordHandledItem(mail, 'email', 'sent');
  closeProcessDraft(id);
  renderTodayView();
  showToast(`[승인 완료] ${mail.from.split('(')[0].trim()} 님께 답장 발송 큐가 접수되었습니다! 🚀 (Gmail 자동 발송 연동)`);

  // Publish Send Request to ntfy Queue for Background Agent Execution
  try {
    const sendPayload = {
      action: 'send_email',
      timestamp: Date.now(),
      emailId: mail.id,
      draftId: mail.draftId || '',
      account: mail.account || 'onsessdesign@gmail.com',
      recipient: mail.from,
      subject: mail.subject,
      body: mail.draft
    };
    await fetch(`${SYNC_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Title': `[Jeegong Send Request] ${mail.id}`,
        'Tags': 'email,outbox'
      },
      body: JSON.stringify(sendPayload)
    });
  } catch (err) {
    console.warn('send request publish error:', err);
  }

  pushCloudState();
};

// Toggle Todomate Todo
window.toggleTodomateTodo = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const t = b.todomateTodos.find(item => item.id === id);
  if (t) {
    t.done = !t.done;
    saveLocalTodosState(currentBriefingId);
    renderTodayView();
    pushCloudState();
  }
};

// Toggle Accordion Item
window.toggleAccordion = function(id) {
  const el = document.getElementById(`accordion-${id}`);
  if (el) {
    el.classList.toggle('open');
  }
};

// Render Archive View
function renderArchiveView() {
  const select = document.getElementById('archive-date-select');
  const container = document.getElementById('archive-content-container');
  if (!select || !container || !appData) return;

  // Dynamically populate options from briefings data
  select.innerHTML = appData.briefings.map(item => `
    <option value="${item.id}">${item.date} (${item.dayOfWeek}) - ${item.headline}</option>
  `).join('');

  function renderSelectedArchive() {
    const selectedId = select.value;
    const b = appData.briefings.find(item => item.id === selectedId) || appData.briefings[0];
    if (!b) return;

    container.innerHTML = `
      <div class="card-section" style="margin-bottom: 20px;">
        <div class="archive-header-row">
          <div class="archive-date-title">${b.date} (${b.dayOfWeek})</div>
          <div class="archive-headline-badge">${b.headline}</div>
        </div>
        <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.5;">${b.summary}</p>
      </div>

      <div class="card-section" style="margin-bottom: 20px;">
        <h4 style="font-size: 15px; font-weight: 700; margin-bottom: 12px;">📬 주요 수신 메일</h4>
        <div class="email-list">
          ${b.emails.map(e => `
            <div class="email-item p2">
              <div class="email-top">
                <span class="badge-tag badge-p2">${e.priority}</span>
                <span class="email-from">${e.from}</span>
              </div>
              <div class="email-subject">${e.subject}</div>
              <div class="email-summary">${e.summary}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  select.addEventListener('change', renderSelectedArchive);
  renderSelectedArchive();
}

// Render History
function renderHistoryView() {
  const container = document.getElementById('history-container');
  if (!container || !appData || !appData.history) return;

  container.innerHTML = appData.history.map(h => `
    <div class="stat-card" style="margin-bottom: 12px;">
      <div class="stat-info">
        <div style="font-size: 14px; font-weight: 700;">${h.trigger}</div>
        <div style="font-size: 12px; color: var(--text-tertiary);">${h.timestamp} · 소요시간 ${h.duration}</div>
      </div>
      <span class="section-badge" style="background-color: var(--accent-green-light); color: var(--accent-green);">완료</span>
    </div>
  `).join('');
}

// Interactions: Check-in & Scanner Run
function setupInteractions() {
  const btnRun = document.getElementById('btn-run-agent');
  const btnText = document.getElementById('btn-run-agent-text');
  const banner = document.getElementById('scanner-banner');
  const statusText = document.getElementById('scanner-status-text');
  const progressText = document.getElementById('scanner-progress-count');
  const copyBtn = document.getElementById('btn-copy-briefing');

  const steps = [
    { id: 'step-calendar', text: '구글 캘린더 오늘의 일정 확인 중...' },
    { id: 'step-gmail', text: '지메일 2개 계정 중요 메일 필터링 중...' },
    { id: 'step-naver', text: '네이버 메일 B2B 제안 및 공구 회신 확인 중...' },
    { id: 'step-todomate', text: '투두메이트 오늘 미완료 할 일 추출 중...' },
    { id: 'step-drive', text: '구글 드라이브 사전 자료 문서 링크 검색 중...' }
  ];

  // Work state uses global workState & updateWorkButtonUI()
  updateWorkButtonUI();

  btnRun.addEventListener('click', async () => {
    if (workState === 'ready') {
      // 1. Run Check-in scan
      btnRun.disabled = true;
      banner.classList.add('active');

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const el = document.getElementById(s.id);
        el.classList.add('running');
        statusText.textContent = s.text;
        progressText.textContent = `${i} / 5 진행`;

        await new Promise(r => setTimeout(r, 550));

        el.classList.remove('running');
        el.classList.add('done');
        progressText.textContent = `${i + 1} / 5 완료`;
      }

      statusText.textContent = '✨ 5대 도구 전수 분석 완료! 오늘의 출근 브리핑이 동기화되었습니다.';

      workState = 'checked_in';
      const kst = getKSTNow(); try { localStorage.setItem('jeegong_work_date', kst.dateStr); localStorage.setItem('jeegong_work_state', 'checked_in'); } catch (e) {}
      updateWorkButtonUI();
      pushCloudState();

      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      appData.history.unshift({
        id: `run-${Date.now()}`,
        timestamp: `${getKSTNow().dateStr} ${timeStr}`,
        trigger: '출근 완료 (5대 도구 동기화)',
        duration: '2.7s',
        status: 'success',
        itemsFound: { calendar: 0, emails: 3, todos: 5, driveFiles: 2 }
      });

      renderTodayView();
      renderHistoryView();

      setTimeout(() => {
        banner.classList.remove('active');
        showToast('🎉 출근이 완료되었습니다! 하루 일과 후 상단 [업무 종료]를 눌러 퇴근하세요.');
      }, 1000);

    } else if (workState === 'checked_in') {
      // 2. End Work (퇴근 처리)
      workState = 'finished';
      const kst = getKSTNow(); try { localStorage.setItem('jeegong_work_date', kst.dateStr); localStorage.setItem('jeegong_work_state', 'finished'); } catch (e) {}
      updateWorkButtonUI();
      pushCloudState();

      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      appData.history.unshift({
        id: `run-${Date.now()}`,
        timestamp: `${getKSTNow().dateStr} ${timeStr}`,
        trigger: '업무 종료 (퇴근 완료)',
        duration: '0.1s',
        status: 'success',
        itemsFound: { calendar: 0, emails: 3, todos: 5, driveFiles: 2 }
      });

      const guideText = document.getElementById('guide-banner-text');
      if (guideText) {
        guideText.textContent = '👏 오늘 하루도 정말 고생 많으셨습니다! 오늘의 모든 업무가 성공적으로 마감되었습니다.';
      }

      renderHistoryView();
      showToast('🌙 오늘 하루도 고생 많으셨습니다! 업무가 성공적으로 종료되었습니다.');

      // Add farewell bot chat message
      chatMessages.push({
        role: 'bot',
        text: '지원진 님, 오늘 하루도 정말 고생 많으셨어요! 👏\n내일 오전 8시 30분 출근 알람 때 산뜻하게 다시 찾아뵐게요. 편안한 저녁 보내세요 ㅎㅎ',
        time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
      });
      saveChatHistory();
      renderChatMessages();

    } else if (workState === 'finished') {
      if (confirm('오늘 업무를 다시 시작(출근 상태로 복원)하시겠습니까?')) {
        workState = 'ready';
        const kst = getKSTNow(); try { localStorage.setItem('jeegong_work_date', kst.dateStr); localStorage.setItem('jeegong_work_state', 'ready'); } catch (e) {}
        updateWorkButtonUI();
        pushCloudState();
        renderTodayView();
        showToast('출근 준비 상태로 복원되었습니다.');
      }
    }
  });

  // Copy Markdown (Dynamically generated from current briefing)
  copyBtn.addEventListener('click', () => {
    const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
    const calText = b.calendar.note || (b.calendar.items && b.calendar.items.length ? b.calendar.items.map(i => `${i.time}: ${i.title}`).join('\n- ') : '오늘 등록된 캘린더 일정 없음');
    const emailText = b.emails.map((e, idx) => `${idx + 1}. [${e.priority}] ${e.from}: ${e.subject}`).join('\n');
    const todoText = b.todomateTodos.map(t => `- ${t.text} ${t.done ? '(완료)' : ''}`).join('\n');
    const priorityText = b.agentPriorities.map((ap, idx) => `${idx + 1}. [${ap.priority}] ${ap.title}${ap.done ? ' (완료)' : ''}`).join('\n');
    const guideText = b.guide || b.summary;

    const md = `# 🌅 [지공 출근 에이전트] 오늘 업무 브리핑 (${b.date} ${b.dayOfWeek})

### 📅 오늘의 일정 & 회의
- ${calText}

### 📬 중요 메일 & 외부 요청
${emailText}

### 📱 투두메이트 오늘 할 일
${todoText}

### ✨ 에이전트 추천 핵심 우선순위
${priorityText}

> 💡 한 줄 가이드: ${guideText}`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(md).then(() => showToast('브리핑 마크다운이 복사되었습니다.'));
    } else {
      showToast('브리핑이 복사되었습니다.');
    }
  });

  // Refresh Button Click Listener
  const refreshBtn = document.getElementById('btn-refresh-data');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      window.refreshDashboardData(true);
    });
  }
}

// Refresh Dashboard Data (Manual & Background Auto-sync)
window.refreshDashboardData = async function(showNotice = true) {
  const refreshBtn = document.getElementById('btn-refresh-data');
  const todoRefreshBtn = document.getElementById('btn-refresh-todomate');
  if (refreshBtn) refreshBtn.classList.add('spinning');
  if (todoRefreshBtn) todoRefreshBtn.classList.add('spinning');

  try {
    const kst = getKSTNow();

    // 1. Fetch fresh data.json bypassing browser cache
    const res = await fetch('data.json?v=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      appData = await res.json();
    }

    // 2. Harvest handled items from history
    syncHandledFromHistory();

    // 3. Pull cloud state from ntfy
    await pullCloudState();
    restoreLocalTodosState(currentBriefingId);

    // 4. Ensure today's briefing is selected
    if (appData && appData.briefings && appData.briefings.length > 0) {
      const todayB = appData.briefings.find(b => b.date === kst.dateStr);
      if (todayB) {
        currentBriefingId = todayB.id;
      }
    }

    // 5. Check midnight daily reset
    checkMidnightReset();

    // 6. Re-render all views
    renderTodayView();
    if (typeof renderChatConversationList === 'function') renderChatConversationList();
    if (typeof renderChatMessages === 'function') renderChatMessages();

    // 7. Publish refresh signal to ntfy for background agent to sync Todomate
    if (showNotice) {
      try {
        fetch(`${SYNC_ENDPOINT}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Title': '[Jeegong Refresh Request]',
            'Tags': 'refresh,todomate'
          },
          body: JSON.stringify({
            action: 'refresh_todomate',
            timestamp: Date.now()
          })
        }).catch(e => console.warn('Refresh signal error:', e));
      } catch (e) {}

      showToast('🔄 최신 메일, 문의, 투두메이트 할 일을 모두 새로고침했습니다.');
    }
  } catch (err) {
    console.error('Refresh dashboard error:', err);
    if (showNotice) showToast('새로고침 중 오류가 발생했습니다.');
  } finally {
    if (refreshBtn) {
      setTimeout(() => {
        refreshBtn.classList.remove('spinning');
      }, 500);
    }
    if (todoRefreshBtn) {
      setTimeout(() => {
        todoRefreshBtn.classList.remove('spinning');
      }, 500);
    }
  }
};

window.refreshTodomateOnly = async function() {
  const todoRefreshBtn = document.getElementById('btn-refresh-todomate');
  if (todoRefreshBtn) todoRefreshBtn.classList.add('spinning');
  showToast('🔄 투두메이트 최신 할 일을 불러오는 중입니다...');
  await window.refreshDashboardData(true);
};

function showToast(msg) {
  const t = document.getElementById('toast-notice');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// =========================================================
// CHATBOT WIDGET LOGIC (채널톡 스타일 대화 목록 & 개별 대화방)
// =========================================================

function setupChatbot() {
  const toggleBtn = document.getElementById('btn-chatbot-toggle');
  const modal = document.getElementById('chatbot-modal');
  const listCloseBtn = document.getElementById('btn-chat-list-close');
  const roomCloseBtn = document.getElementById('btn-chatbot-close');
  const backBtn = document.getElementById('btn-chat-back');
  const newInquiryBtn = document.getElementById('btn-chat-new-inquiry');
  const clearBtn = document.getElementById('btn-chatbot-clear');
  const sendBtn = document.getElementById('chatbot-send-btn');
  const inputEl = document.getElementById('chatbot-input');
  const badge = document.getElementById('trigger-unread-badge');
  const attachBtn = document.getElementById('btn-chatbot-attach');
  const fileInput = document.getElementById('chatbot-file-input');

  if (!toggleBtn || !modal) return;

  // Initialize Sessions
  if (!chatSessions['2026-10-21'] || chatSessions['2026-10-21'].length === 0) {
    chatSessions['2026-10-21'] = [
      {
        role: 'bot',
        text: '지원진 님 안녕하세요! 구름이예요 ㅎㅎ 웹에서도 편하게 말씀해 주세요. 오늘 일정이나 메일, 할 일 관련해서 궁금하신 점이나 처리할 일 있으시면 바로 해결해 드릴게요!',
        time: '08:30'
      },
      {
        role: 'user',
        text: '이미 끝난 작업들이야',
        time: '17:44'
      },
      {
        role: 'bot',
        text: '이미 마무리하신 작업들이군요! 확인했습니다 ㅎㅎ 대시보드 목록에서도 깔끔하게 완료 상태로 정리해 둘게요.',
        time: '17:44'
      }
    ];
  }
  if (!chatSessions['session-sixshop']) {
    chatSessions['session-sixshop'] = [
      {
        role: 'bot',
        text: '온세스 사업용 메일로 식스샵 신규 의뢰(이준석 대표, 예산 100~200만 원)가 도착해 임시보관함에 답장 초안을 작성해 두었습니다!',
        time: '17:50'
      }
    ];
  }
  if (!chatSessions['2026-10-20']) {
    chatSessions['2026-10-20'] = [
      {
        role: 'bot',
        text: '지원진 님, 10/20 크몽 전자책 승인 검토 카드와 마진계산기 피드백 확인했습니다.',
        time: '1일 전'
      }
    ];
  }

  activeChatDate = '2026-10-21';
  chatMessages = chatSessions[activeChatDate];
  renderChatConversationList();

  // Navigation: Back to List
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showChatList();
    });
  }

  // New Inquiry Floating Button
  if (newInquiryBtn) {
    newInquiryBtn.addEventListener('click', () => {
      const now = new Date();
      const timeTag = `${now.getHours()}시${String(now.getMinutes()).padStart(2, '0')}분`;
      const newKey = `새 대화 (${timeTag})`;
      chatSessions[newKey] = [
        {
          role: 'bot',
          text: `새로운 대화가 시작되었습니다! (${newKey})\n궁금하신 점이나 처리할 업무 편하게 남겨주세요 ㅎㅎ`,
          time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
        }
      ];
      activeChatDate = newKey;
      chatMessages = chatSessions[newKey];
      saveChatHistory();
      showChatRoom(newKey);
      showToast('✨ 새로운 대화방이 열렸습니다.');
    });
  }

  // File Attachments Handler
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      files.forEach(file => {
        const isImg = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        const fileType = isImg ? 'image' : isVideo ? 'video' : 'file';
        const reader = new FileReader();

        reader.onload = (loadEvt) => {
          currentAttachments.push({
            id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            name: file.name,
            type: fileType,
            dataUrl: loadEvt.target.result,
            size: (file.size / 1024).toFixed(1) + ' KB'
          });
          renderAttachmentPreviews();
        };

        reader.readAsDataURL(file);
      });

      fileInput.value = '';
    });
  }

  // Clipboard Paste Handler (Ctrl+V / Cmd+V for screenshots)
  if (inputEl) {
    inputEl.addEventListener('paste', (e) => {
      const items = (e.clipboardData || window.clipboardData)?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (!blob) continue;

          const reader = new FileReader();
          reader.onload = (loadEvt) => {
            currentAttachments.push({
              id: `att-paste-${Date.now()}`,
              name: `캡처_이미지_${Date.now().toString().slice(-4)}.png`,
              type: 'image',
              dataUrl: loadEvt.target.result,
              size: (blob.size / 1024).toFixed(1) + ' KB'
            });
            renderAttachmentPreviews();
            showToast('📋 클립보드 캡처 이미지가 첨부되었습니다!');
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    });

    // Shift+Enter Newline & Enter to Send
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          setTimeout(() => {
            inputEl.style.height = 'auto';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
          }, 10);
          return;
        }
        e.preventDefault();
        markAsRead();
        handleChatSend();
        inputEl.style.height = '38px';
      }
    });

    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });
  }

  // Check unread status from localStorage
  const isRead = localStorage.getItem('jeegong_chat_unread') === 'false';
  if (isRead && badge) {
    badge.classList.add('hidden');
  }

  function markAsRead() {
    if (badge) {
      badge.classList.add('hidden');
    }
    try {
      localStorage.setItem('jeegong_chat_unread', 'false');
    } catch (e) {}
  }

  toggleBtn.addEventListener('click', () => {
    modal.classList.toggle('open');
    if (modal.classList.contains('open')) {
      markAsRead();
      if (currentChatView === 'list') {
        showChatList();
      } else {
        renderChatMessages();
        if (inputEl) inputEl.focus();
      }
    }
  });

  if (listCloseBtn) {
    listCloseBtn.addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  if (roomCloseBtn) {
    roomCloseBtn.addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      chatMessages = [
        {
          role: 'bot',
          text: '대화 기록이 정리되었어요! 새로운 용건이나 작업 말씀해 주시면 바로 챙길게요.',
          time: '방금 전'
        }
      ];
      saveChatHistory();
      renderChatMessages();
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      markAsRead();
      handleChatSend();
    });
  }

  showChatList();
}

window.showChatList = function() {
  currentChatView = 'list';
  const listView = document.getElementById('chat-view-list');
  const roomView = document.getElementById('chat-view-room');
  if (listView) listView.style.display = 'flex';
  if (roomView) roomView.style.display = 'none';
  renderChatConversationList();
};

window.showChatRoom = function(sessionId) {
  currentChatView = 'room';
  if (sessionId) {
    activeChatDate = sessionId;
  }
  if (!chatSessions[activeChatDate]) {
    chatSessions[activeChatDate] = [
      {
        role: 'bot',
        text: '지원진 님 안녕하세요! 구름이예요 ㅎㅎ 웹에서도 편하게 말씀해 주세요.',
        time: '08:30'
      }
    ];
  }
  chatMessages = chatSessions[activeChatDate];
  
  const listView = document.getElementById('chat-view-list');
  const roomView = document.getElementById('chat-view-room');
  if (listView) listView.style.display = 'none';
  if (roomView) roomView.style.display = 'flex';
  renderChatMessages();
  const inputEl = document.getElementById('chatbot-input');
  if (inputEl) inputEl.focus();
};

function renderChatConversationList() {
  const container = document.getElementById('chat-conv-list-container');
  if (!container) return;

  const sessionKeys = Object.keys(chatSessions);

  container.innerHTML = sessionKeys.map(key => {
    const msgs = chatSessions[key] || [];
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : { text: '대화 시작하기', time: '' };

    let title = '구름이';
    let timeTag = '오늘';

    if (key === '2026-10-21') {
      title = '구름이 (오늘 업무)';
      timeTag = lastMsg.time || '오늘';
    } else if (key === 'session-sixshop') {
      title = '식스샵 신규 프로젝트 의뢰 (이준석 대표)';
      timeTag = '17:50';
    } else if (key === '2026-10-20') {
      title = '구름이 (어제 업무)';
      timeTag = '1일 전';
    } else if (key === '2026-10-19') {
      title = '구름이 (시스템 연동)';
      timeTag = '2일 전';
    } else {
      title = `대화 (${key})`;
      timeTag = lastMsg.time || '최근';
    }

    const previewText = (lastMsg.text || '대화가 없습니다.').replace(/\n/g, ' ');

    return `
      <div class="chat-conv-item" onclick="showChatRoom('${key}')">
        <img src="gureumi_avatar.png" alt="구름이" class="chat-conv-avatar">
        <div class="chat-conv-content">
          <div class="chat-conv-meta">
            <span class="chat-conv-name">${title}</span>
            <span class="chat-conv-time">${timeTag}</span>
          </div>
          <div class="chat-conv-preview">${previewText}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAttachmentPreviews() {
  const previewBar = document.getElementById('chatbot-file-preview-bar');
  if (!previewBar) return;

  if (currentAttachments.length === 0) {
    previewBar.style.display = 'none';
    previewBar.innerHTML = '';
    return;
  }

  previewBar.style.display = 'flex';
  previewBar.innerHTML = currentAttachments.map((att, idx) => `
    <div class="file-preview-chip">
      ${att.type === 'image' ? `<img src="${att.dataUrl}" class="file-preview-thumb">` : att.type === 'video' ? '🎬' : '📄'}
      <span class="file-preview-name" title="${att.name}">${att.name}</span>
      <button class="file-preview-remove" onclick="removeAttachment(${idx})">✕</button>
    </div>
  `).join('');
}

window.removeAttachment = function(idx) {
  currentAttachments.splice(idx, 1);
  renderAttachmentPreviews();
};

function saveChatHistory() {
  if (!chatSessions[activeChatDate]) {
    chatSessions[activeChatDate] = [];
  }
  chatSessions[activeChatDate] = chatMessages.slice(-30);

  try {
    localStorage.setItem('jeegong_chat_sessions', JSON.stringify(chatSessions));
  } catch (e) {}

  pushCloudState();
}

function renderChatMessages() {
  const container = document.getElementById('chatbot-messages');
  if (!container) return;

  container.innerHTML = chatMessages.map(m => `
    <div class="chat-bubble ${m.role}">
      ${m.attachments && m.attachments.length ? `
        <div class="chat-attachment-grid">
          ${m.attachments.map(att => att.type === 'image' ? `
            <img src="${att.dataUrl}" class="chat-attachment-img" onclick="window.open('${att.dataUrl}')" alt="${att.name}" title="클릭 시 크게 보기">
          ` : att.type === 'video' ? `
            <video src="${att.dataUrl}" controls class="chat-attachment-video"></video>
          ` : `
            <a href="${att.dataUrl}" download="${att.name}" class="chat-attachment-doc">
              <span>📄</span>
              <span style="font-weight: 500;">${att.name}</span>
              <span style="font-size: 10.5px; opacity: 0.7;">(${att.size})</span>
            </a>
          `).join('')}
        </div>
      ` : ''}
      ${m.text ? `<div>${m.text.replace(/\n/g, '<br>')}</div>` : ''}
      <div class="chat-bubble-meta">${m.time || ''}</div>
    </div>
  `).join('');

  container.scrollTop = container.scrollHeight;
}

window.sendQuickMessage = function(text) {
  const modal = document.getElementById('chatbot-modal');
  const badge = document.getElementById('trigger-unread-badge');
  if (badge) {
    badge.classList.add('hidden');
  }
  try {
    localStorage.setItem('jeegong_chat_unread', 'false');
  } catch (e) {}

  if (!modal.classList.contains('open')) {
    modal.classList.add('open');
  }
  processUserMessage(text, []);
};

function handleChatSend() {
  const inputEl = document.getElementById('chatbot-input');
  const text = inputEl.value.trim();
  if (!text && currentAttachments.length === 0) return;

  const sendingAttachments = [...currentAttachments];
  currentAttachments = [];
  renderAttachmentPreviews();
  inputEl.value = '';

  processUserMessage(text, sendingAttachments);
}

async function processUserMessage(text, attachments = []) {
  const now = new Date();
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Add User Message
  chatMessages.push({
    role: 'user',
    text: text,
    attachments: attachments,
    time: timeStr
  });
  renderChatMessages();

  // Show Typing Indicator
  const container = document.getElementById('chatbot-messages');
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-bubble bot';
  typingEl.id = 'typing-indicator';
  typingEl.innerHTML = '<span style="color:var(--text-tertiary);">구름이가 생각하고 있어요...</span>';
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;

  // Generate Reply (Contextual Assistant logic)
  const reply = await generateAssistantResponse(text, attachments);

  // Remove typing indicator
  const ind = document.getElementById('typing-indicator');
  if (ind) ind.remove();

  // Add Bot Reply
  chatMessages.push({
    role: 'bot',
    text: reply,
    time: timeStr
  });
  saveChatHistory();
  renderChatMessages();
}

async function generateAssistantResponse(prompt, attachments = []) {
  await new Promise(r => setTimeout(r, 450));

  // If attachments are present
  if (attachments && attachments.length > 0) {
    const fileNames = attachments.map(a => `'${a.name}'`).join(', ');
    const hasVideo = attachments.some(a => a.type === 'video');
    const hasImage = attachments.some(a => a.type === 'image');

    if (hasVideo) {
      return `보내주신 동영상 파일(${fileNames}) 잘 확인했습니다! 🎬 영상 편집이나 배치 등 필요한 점 말씀해 주세요 ㅎㅎ`;
    } else if (hasImage) {
      return `보내주신 캡처/이미지(${fileNames}) 확인했습니다! 📷 검토 후 필요한 작업 바로 처리해 드릴게요.`;
    } else {
      return `첨부해 주신 파일(${fileNames}) 안전하게 접수했습니다! 📄 관련해서 진행할 작업 알려주세요.`;
    }
  }

  const clean = prompt.trim();

  // 1. Phone Call / Booking inquiry
  if (clean.includes('전화') || clean.includes('예약')) {
    return `실제 매장 전화 예약이나 통화는 피클(Pickle) 앱 채팅에서 저에게 바로 말씀해 주시면 제가 전화 에이전트로 대신 전화를 걸어 예약해 드릴 수 있어요! 📞\n웹 챗봇은 대시보드 인터랙션 전용이라, 통화나 결제 같은 실제 외부 작업은 피클 앱에서 말씀해 주시면 제가 즉시 실행합니다 ㅎㅎ`;
  }

  // 2. Google Calendar Event Registration
  if (clean.includes('캘린더') || (clean.includes('일정') && (clean.includes('등록') || clean.includes('추가')))) {
    return `일정 등록 요청 확인했습니다! 📅 실제 구글 캘린더 API 연동 및 일정 생성은 피클 앱에서 저에게 말씀해 주시면 즉시 계정에 등록해 드립니다. 웹 화면상의 오늘 일정에도 함께 표기해 드릴게요!`;
  }

  // 3. Completed Tasks / Done
  if (clean.includes('끝난') || clean.includes('완료') || clean.includes('다 했') || clean.includes('끝냈') || clean.includes('마쳤')) {
    return `이미 마무리하신 작업들이군요! 확인했습니다 ㅎㅎ 대시보드 목록에서도 깔끔하게 완료 상태로 정리해 둘게요.`;
  }

  // 4. Gratitude / Casual
  if (clean.includes('고마워') || clean.includes('감사') || clean.includes('수고')) {
    return `별말씀을요! 오늘 하루도 파이팅이에요 ㅎㅎ 추가로 필요한 작업 있으시면 언제든 말씀해 주세요.`;
  }

  // 5. Modification Request / Bug Feedback / Feature Request
  if (
    clean.includes('수정') || clean.includes('처리') || clean.includes('버튼') ||
    clean.includes('붙여넣기') || clean.includes('줄엔터') || clean.includes('동기화') ||
    clean.includes('아카이브') || clean.includes('기록') || clean.includes('오류') ||
    clean.includes('안돼')
  ) {
    return `지원진 님, 요청해 주신 내용 확인했습니다! 문제점 즉시 검토해서 대시보드에 바로 반영하겠습니다.`;
  }

  // 6. Check if user wants to add todo
  if (clean.includes('추가') && (clean.includes('할 일') || clean.includes('할일') || clean.includes('투두'))) {
    let cleanTask = clean.replace(/(할 일에|할일에|투두에|추가해줘|추가해|추가)/g, '').trim();
    if (!cleanTask) cleanTask = '새로운 업무 확인';

    if (appData && appData.briefings) {
      const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
      b.todomateTodos.unshift({
        id: `custom-${Date.now()}`,
        text: cleanTask,
        done: false
      });
      renderTodayView();
      return `📝 투두메이트 오늘 할 일에 '${cleanTask}'을(를) 추가했습니다!`;
    }
  }

  // 7. Questions about priorities (ONLY when asked)
  if (clean.includes('우선순위') || clean.includes('핵심')) {
    return `오늘 집중하셔야 할 핵심 1순위 업무 2가지예요:\n1. 인플루언서 희수 님 카톡(thou7) 협의 (베어메리 공구 일정·단가)\n2. 우주맘마 아넬라 과일퓨레 공구 오픈 준비 (내일 10/22 오픈 대비)`;
  }

  // 8. Questions about Heesu / Email draft
  if (clean.includes('희수') || (clean.includes('답장') && clean.includes('다듬'))) {
    return `희수 님께 보낼 추천 카톡 문구예요:\n"안녕하세요 희수 님! 올쓰컴퍼니 지원진입니다 :) 메일로 말씀해주신 오슬로앤오십구 겨울 베어메리 관련해서 편하신 일정과 조건 조율 나누면 좋겠습니다!"`;
  }

  // 9. Questions about Anela puree
  if (clean.includes('아넬라') || clean.includes('우주맘마') || clean.includes('공구')) {
    return `내일(10/22~10/26) 시작되는 우주맘마 아넬라 과일퓨레 공구 준비 건이에요. 인플루언서 20명 메일 전송과 광고 세팅을 오늘 점검해 두시면 좋습니다!`;
  }

  // 10. Questions about OYKA HOME / Sixshop
  if (clean.includes('식스샵') || clean.includes('oyka') || clean.includes('견적')) {
    return `OYKA HOME에서 요청한 식스샵 쇼핑몰 신규 구축 의뢰건(예산 50~100만 원, 베베드피노 레퍼런스)이에요. 온세스 기본 패키지 견적서 메일 회신을 준비해 두었습니다.`;
  }

  // Natural Concise Default response (NO repetitive schedule recitation)
  return `네 지원진 님, '${clean}' 내용 접수했습니다! 말씀해 주신 내용 바탕으로 바로 챙겨둘게요 ㅎㅎ`;
}

// =========================================================
// REAL-TIME CLOUD SYNC (Mobile <-> PC Real-time Sync via ntfy SSE)
// =========================================================
function setupRealtimeSync() {
  if (syncEventSource) {
    try { syncEventSource.close(); } catch (e) {}
  }

  // 1. Initial snapshot pull
  pullCloudState();

  // 2. Real-time instant SSE stream (Mobile <-> PC 0.1s instant sync)
  try {
    syncEventSource = new EventSource(`${SYNC_ENDPOINT}/sse`);
    syncEventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === 'message' && payload.message) {
          const remoteData = JSON.parse(payload.message);
          applyRemoteSync(remoteData);
        }
      } catch (err) {
        console.warn('Realtime parse error:', err);
      }
    };
    syncEventSource.onerror = () => {
      // EventSource auto-reconnects natively
    };
  } catch (err) {
    console.warn('EventSource setup error:', err);
  }

  // 3. Robust snapshot pull on focus & visibilitychange
  window.addEventListener('focus', () => {
    checkMidnightReset();
    pullCloudState();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkMidnightReset();
      pullCloudState();
    }
  });
  setInterval(pullCloudState, 8000);
}

async function pullCloudState() {
  if (!appData || !appData.briefings) return;
  try {
    const res = await fetch(`${SYNC_ENDPOINT}/json?poll=1`);
    if (!res.ok) return;
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return;
    const lastLine = lines[lines.length - 1];
    const payload = JSON.parse(lastLine);
    if (payload.message) {
      const remoteData = JSON.parse(payload.message);
      applyRemoteSync(remoteData);
    }
  } catch (err) {
    console.warn('pullCloudState error:', err);
  }
}

function applyRemoteSync(remoteData) {
  if (!remoteData || !appData || !appData.briefings) return;
  const remoteTs = remoteData.updatedAt || 0;
  if (remoteTs <= lastLocalUpdateTimestamp) return;

  isSyncing = true;
  lastLocalUpdateTimestamp = remoteTs;
  try { localStorage.setItem('jeegong_last_sync_ts', String(remoteTs)); } catch (e) {}

  const kst = getKSTNow();

  // 1. Work state sync with daily midnight reset
  if (remoteData.workDate && remoteData.workDate !== kst.dateStr) {
    workState = 'ready';
    try {
      localStorage.setItem('jeegong_work_date', kst.dateStr);
      localStorage.setItem('jeegong_work_state', 'ready');
    } catch (e) {}
  } else if (remoteData.workState) {
    workState = remoteData.workState;
    try {
      localStorage.setItem('jeegong_work_date', kst.dateStr);
      localStorage.setItem('jeegong_work_state', workState);
    } catch (e) {}
  }
  updateWorkButtonUI();

  // 2. Sync briefing statuses (todos, priorities, emails, inquiries)
  const b = (remoteData.briefingId ? appData.briefings.find(item => item.id === remoteData.briefingId) : null)
    || (remoteData.briefingDate ? appData.briefings.find(item => item.date === remoteData.briefingDate) : null)
    || appData.briefings.find(item => item.id === currentBriefingId)
    || appData.briefings[0];

  if (b) {
    if (Array.isArray(remoteData.todomateTodos) && remoteData.todomateTodos.length > 0) {
      const currentDone = new Set((b.todomateTodos || []).filter(t => t.done).map(t => t.text || t.id));
      b.todomateTodos = remoteData.todomateTodos.map(rt => ({
        ...rt,
        done: rt.done || currentDone.has(rt.text) || currentDone.has(rt.id)
      }));
    }
    if (Array.isArray(remoteData.doneTodos)) {
      (b.todomateTodos || []).forEach(t => {
        t.done = remoteData.doneTodos.includes(t.id) || remoteData.doneTodos.includes(t.text);
      });
    }
    if (Array.isArray(remoteData.donePriorities)) {
      (b.agentPriorities || []).forEach(ap => {
        ap.done = remoteData.donePriorities.includes(ap.id);
      });
    }
    if (Array.isArray(remoteData.excludedPriorities)) {
      (b.agentPriorities || []).forEach(ap => {
        ap.excluded = remoteData.excludedPriorities.includes(ap.id);
      });
    }
    saveLocalTodosState(b.id);
    // Sync handled registry first so it is available for filtering and status checks
    if (remoteData.handledRegistry && typeof remoteData.handledRegistry === 'object') {
      Object.assign(handledRegistry, remoteData.handledRegistry);
      saveHandledRegistry();
    }

    if (remoteData.emailStatuses) {
      (b.emails || []).forEach(e => {
        if (remoteData.emailStatuses[e.id]) {
          e.status = remoteData.emailStatuses[e.id];
        } else {
          const tag = getItemCoreTag(e);
          const fp = getItemFingerprint(e, 'email');
          const rec = (tag && handledRegistry[tag]) || (fp && handledRegistry[fp]);
          if (rec) {
            e.status = rec.status;
          } else {
            e.status = 'pending';
          }
        }
      });
    }
    if (remoteData.inquiryStatuses) {
      (b.inquiries || []).forEach(i => {
        if (remoteData.inquiryStatuses[i.id]) {
          i.status = remoteData.inquiryStatuses[i.id];
        } else {
          const tag = getItemCoreTag(i);
          const fp = getItemFingerprint(i, 'inquiry');
          const rec = (tag && handledRegistry[tag]) || (fp && handledRegistry[fp]);
          if (rec) {
            i.status = rec.status;
          } else {
            i.status = 'pending';
          }
        }
      });
    }
    renderTodayView();
  }

  // 3. Sync recent chats
  if (Array.isArray(remoteData.recentChats) && remoteData.recentChats.length > 0) {
    if (!chatSessions[kst.dateStr]) chatSessions[kst.dateStr] = [];
    const existingTexts = new Set(chatSessions[kst.dateStr].map(m => m.text));
    remoteData.recentChats.forEach(m => {
      if (!existingTexts.has(m.text)) {
        chatSessions[kst.dateStr].push(m);
        existingTexts.add(m.text);
      }
    });
    try { localStorage.setItem('jeegong_chat_sessions', JSON.stringify(chatSessions)); } catch (e) {}
    renderChatConversationList();
    if (typeof currentChatView !== 'undefined' && currentChatView === 'room' && activeChatDate === kst.dateStr) {
      chatMessages = chatSessions[kst.dateStr];
      renderChatMessages();
    }
  }

  isSyncing = false;
}

async function pushCloudState() {
  if (isSyncing || !appData || !appData.briefings) return;
  try {
    const nowTs = Date.now();
    lastLocalUpdateTimestamp = nowTs;
    try { localStorage.setItem('jeegong_last_sync_ts', String(nowTs)); } catch (e) {}

    const kst = getKSTNow();
    const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];

    const doneTodos = (b.todomateTodos || []).filter(t => t.done).map(t => t.text || t.id);
    const donePriorities = (b.agentPriorities || []).filter(ap => ap.done).map(ap => ap.id);
    const excludedPriorities = (b.agentPriorities || []).filter(ap => ap.excluded).map(ap => ap.id);

    const emailStatuses = {};
    (b.emails || []).forEach(e => {
      if (e.status && e.status !== 'pending') emailStatuses[e.id] = e.status;
    });

    const inquiryStatuses = {};
    (b.inquiries || []).forEach(i => {
      if (i.status && i.status !== 'pending') inquiryStatuses[i.id] = i.status;
    });

    const todayChats = (chatSessions[kst.dateStr] || []).slice(-10);

    const payload = {
      updatedAt: nowTs,
      workDate: kst.dateStr,
      workState: workState,
      briefingId: b.id,
      briefingDate: b.date,
      doneTodos: doneTodos,
      todomateTodos: b.todomateTodos || [],
      donePriorities: donePriorities,
      excludedPriorities: excludedPriorities,
      emailStatuses: emailStatuses,
      inquiryStatuses: inquiryStatuses,
      handledRegistry: handledRegistry,
      recentChats: todayChats
    };

    await fetch(`${SYNC_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('pushCloudState error:', err);
  }
}
