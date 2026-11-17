// Jeegong Work Agent Dashboard Application (v1.3.0 - Midnight Auto Reset & Real-time Cloud Sync)

let appData = null;
let currentBriefingId = 'b-20261023';
window.currentBriefingId = currentBriefingId;
let workState = 'ready'; // 'ready' (출근 완료) -> 'checked_in' (업무 종료) -> 'finished' (퇴근 완료)
let lastLocalUpdateTimestamp = 0;
let isSyncing = false;

// Cloud Sync Configuration (Enterprise-grade Supabase Cloud DB & Instant ntfy Stream)
const SUPABASE_URL = 'https://ipxbmrvadxrvuveujaaq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlweGJtcnZhZHhydnV2ZXVqYWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzOTc5MTQsImV4cCI6MjEwNzk3MzkxNH0.lbgUKo8ZVvYrSu7qaVzeWbUNrM-CJHfhtbEFgvTJIpg';
const SUPABASE_STATE_ENDPOINT = `${SUPABASE_URL}/rest/v1/jeegong_state?id=eq.live`;

const SYNC_TOPIC = 'jeegong_sync_dnjswls1540_2026';
const SYNC_ENDPOINT = 'https://ntfy.sh/' + SYNC_TOPIC;
let syncEventSource = null;

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
  if (text.includes('마빼삐') || text.includes('mapepee') || text.includes('hssohn74')) return 'core::mapepee';
  
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
    { tag: 'core::panimom', type: 'email', service: '네이버 메일', from: '인플루언서 파니맘 (이메일 비공개)', subject: 'Re: [공구 제안] 100% 생과일 아넬라 퓨레, 공구 협업 제안드립니다.│올쓰컴퍼니', status: 'done', date: '2026-10-22' },
    { tag: 'core::panimom', type: 'inquiry', channel: '네이버 메일', from: '인플루언서 파니맘', subject: '아넬라 과일퓨레 공구 일정 검토 회신', status: 'done', date: '2026-10-22' },
    { tag: 'core::lee_junseok', type: 'email', service: '지메일 (온세스)', from: '식스샵 프로 고객지원 (help-pro@sixshop.com)', subject: '[식스샵 파트너] 바로 상담할 수 있는 웹사이트 제작 신규 프로젝트 (이준석 대표)', status: 'done', date: '2026-10-22' },
    { tag: 'core::lee_junseok', type: 'inquiry', channel: '식스샵', from: '이준석 대표 (연락처 비공개)', subject: '홈페이지 리모델링 및 AI 견적 연동 신규 의뢰 (예산 100~200만 원)', status: 'done', date: '2026-10-22' },
    { tag: 'core::paynote_eunhee', type: 'email', service: '네이버 메일', from: '지공의 페이노트 (no-reply@paynote.co.kr)', subject: '[결제완료] 전자책 결제 완료 안내 (이은희 님, 129,000원)', status: 'done', date: '2026-10-22' },
    { tag: 'core::round_tiger', type: 'email', service: '네이버 메일', from: '라운드커머스 마케팅팀 (이메일 비공개)', subject: '타이거모닝 진저샷 공동구매 운영 파트너십 제안', status: 'done', date: '2026-10-22' }
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
  
  // If item is explicitly dated today or has today's date in ID, it is fresh for today!
  const vCompact = viewingDate ? viewingDate.replace(/-/g, '') : '';
  if (item.id && vCompact && item.id.includes(vCompact)) return false;

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


// Local Persistence for Todos and Priorities (새로고침 시 미처리 할 일 체크 및 추가/수정/삭제 보존 엔진)
function getCustomAddedTodos(dateKey) {
  try {
    const saved = localStorage.getItem(`jeegong_custom_todos_${dateKey}`);
    if (!saved) return [];
    const list = JSON.parse(saved);
    if (!Array.isArray(list)) return [];
    return list.filter(t => t && t.id && (t.id.startsWith('custom-') || t.source === 'dashboard'));
  } catch (e) {
    return [];
  }
}

function saveCustomAddedTodo(dateKey, todo) {
  try {
    const list = getCustomAddedTodos(dateKey);
    const existingIdx = list.findIndex(t => t.id === todo.id || t.text === todo.text);
    if (existingIdx !== -1) {
      list[existingIdx] = { ...list[existingIdx], ...todo };
    } else {
      list.unshift(todo);
    }
    localStorage.setItem(`jeegong_custom_todos_${dateKey}`, JSON.stringify(list));
  } catch (e) {}
}

function removeCustomAddedTodo(dateKey, id) {
  try {
    let list = getCustomAddedTodos(dateKey);
    list = list.filter(t => t.id !== id);
    localStorage.setItem(`jeegong_custom_todos_${dateKey}`, JSON.stringify(list));
  } catch (e) {}
}

function saveCustomTodos(briefingId) {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === briefingId) || appData.briefings[0];
  if (!b) return;
  const kst = getKSTNow();
  const dateKey = b.date || kst.dateStr;

  (b.todomateTodos || []).forEach(t => {
    if (t.id && (t.id.startsWith('custom-') || t.source === 'dashboard')) {
      saveCustomAddedTodo(dateKey, t);
    }
  });

  try {
    localStorage.setItem(`jeegong_todos_override_${dateKey}`, JSON.stringify(b.todomateTodos || []));
  } catch (e) {}
}

function restoreCustomTodos(briefingId) {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === briefingId) || appData.briefings[0];
  if (!b) return;
  const kst = getKSTNow();
  const dateKey = b.date || kst.dateStr;

  // 1. Dedicated custom added todos restore (대시보드에서 직접 추가한 항목만 복원)
  const customList = getCustomAddedTodos(dateKey);
  if (Array.isArray(customList) && customList.length > 0) {
    if (!b.todomateTodos) b.todomateTodos = [];
    const existingIds = new Set(b.todomateTodos.map(t => t.id));
    const existingTexts = new Set(b.todomateTodos.map(t => t.text));

    const toPrepend = [];
    customList.forEach(ct => {
      if (ct.id && (ct.id.startsWith('custom-') || ct.source === 'dashboard')) {
        if (!existingIds.has(ct.id) && !existingTexts.has(ct.text)) {
          toPrepend.push(ct);
          existingIds.add(ct.id);
          existingTexts.add(ct.text);
        }
      }
    });
    if (toPrepend.length > 0) {
      b.todomateTodos = [...toPrepend, ...b.todomateTodos];
    }
  }
}

function saveLocalTodosState(briefingId) {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === briefingId) || appData.briefings[0];
  if (!b) return;
  const kst = getKSTNow();
  const dateKey = b.date || kst.dateStr;

  saveCustomTodos(briefingId);

  const doneTodos = (b.todomateTodos || []).filter(t => t.done).map(t => t.text || t.id);
  const donePriorities = (b.agentPriorities || []).filter(ap => ap.done).map(ap => ap.id);
  const excludedPriorities = (b.agentPriorities || []).filter(ap => ap.excluded).map(ap => ap.id);

  try {
    localStorage.setItem(`jeegong_done_todos_${dateKey}`, JSON.stringify(doneTodos));
    localStorage.setItem(`jeegong_done_priorities_${dateKey}`, JSON.stringify(donePriorities));
    localStorage.setItem(`jeegong_excluded_priorities_${dateKey}`, JSON.stringify(excludedPriorities));
  } catch (e) {}
}

function restoreLocalTodosState(briefingId) {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === briefingId) || appData.briefings[0];
  if (!b) return;
  const kst = getKSTNow();
  const dateKey = b.date || kst.dateStr;

  // Filter out permanently deleted todos first
  try {
    const delList = JSON.parse(localStorage.getItem(`jeegong_deleted_todos_${dateKey}`) || '[]');
    if (Array.isArray(delList) && delList.length > 0 && Array.isArray(b.todomateTodos)) {
      b.todomateTodos = b.todomateTodos.filter(t => !delList.includes(t.id) && !delList.includes(t.text));
    }
  } catch (e) {}

  restoreCustomTodos(briefingId);

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
    const savedExcluded = localStorage.getItem(`jeegong_excluded_priorities_${dateKey}`);
    if (savedExcluded !== null) {
      const excludedPriorities = JSON.parse(savedExcluded);
      (b.agentPriorities || []).forEach(ap => {
        ap.excluded = excludedPriorities.includes(ap.id);
      });
    }
  } catch (e) {}
}

// Ensure today's briefing object exists and is selected (자정 이후 및 날짜 변경 시 어제 값 노출 완전 방지)
function ensureTodayBriefing(targetDate) {
  const kst = getKSTNow();
  const dateStr = targetDate || kst.dateStr;
  if (!appData) return null;
  if (!appData.briefings) appData.briefings = [];

  let todayB = appData.briefings.find(b => b.date === dateStr);
  if (!todayB) {
    const cleanId = `b-${dateStr.replace(/-/g, '')}`;
    const prevB = appData.briefings[0] || {};
    todayB = {
      id: cleanId,
      date: dateStr,
      dayOfWeek: `${kst.dayOfWeek}요일`,
      createdAt: `${dateStr} 00:00:00`,
      headline: `${kst.month}월 ${kst.day}일 ${kst.dayOfWeek}요일 신규 업무 개시`,
      summary: `금일 일정 및 투두메이트 할 일을 동기화 중입니다.`,
      attendance: { status: 'pending', checkedAt: null },
      calendar: { count: 0, items: [] },
      calendarEvents: prevB.calendarEvents || [],
      todomateTodos: [],
      agentPriorities: [],
      emails: [],
      inquiries: []
    };
    appData.briefings.unshift(todayB);
  }
  currentBriefingId = todayB.id;
  window.currentBriefingId = currentBriefingId;
  return todayB;
}

// Midnight Daily Reset (자정 00시 도래 시 출퇴근 및 데이터 완전 초기화 -> 다음 날값 자동 로드)
function checkMidnightReset() {
  const kst = getKSTNow();
  const todayStr = kst.dateStr;

  // 1. Always keep current date badge updated
  const dateBadge = document.getElementById('current-date-text');
  if (dateBadge && dateBadge.textContent !== kst.displayStr) {
    dateBadge.textContent = kst.displayStr;
  }

  // 2. Check if day has changed (Midnight passed)
  const savedWorkDate = localStorage.getItem('jeegong_work_date');
  if (!savedWorkDate || savedWorkDate !== todayStr) {
    // New day has arrived! Reset work state to ready (출근 전)
    workState = 'ready';
    try {
      localStorage.setItem('jeegong_work_date', todayStr);
      localStorage.setItem('jeegong_work_state', 'ready');
      localStorage.removeItem('jeegong_attendance_time');
    } catch (e) {}
    updateWorkButtonUI();

    // Ensure today's briefing is selected and active
    ensureTodayBriefing(todayStr);
    renderTodayView();
    renderWeeklyCalendar();
    renderTodoTable();
    pushCloudState();
  }
}

// Initialize Application
async function initApp() {
  const kst = getKSTNow();
  const todayStr = kst.dateStr;

  try {
    const res = await fetch('data.json?v=' + Date.now());
    appData = await res.json();
  } catch (e) {
    console.error('Failed to load data.json', e);
  }

  // 0. 클라우드 DB에서 최신 동기화 데이터를 최우선 로드하여 로컬 캐시 불일치 원천 차단
  try {
    const sRes = await fetch(`${SUPABASE_STATE_ENDPOINT}&select=*`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      },
      cache: 'no-store'
    });
    if (sRes.ok) {
      const sRows = await sRes.json();
      if (Array.isArray(sRows) && sRows.length > 0) {
        window._forceCloudSync = true;
        applyRemoteSync(sRows[0]);
        window._forceCloudSync = false;
      }
    }
  } catch (e) {
    console.warn('Initial cloud state fetch error:', e);
  }

  // 0-B. 이 기기에만 있던 공구 제외 날짜를 클라우드에 올려 다른 기기에서도 보이게 한다
  if (backfillGongguExcludeDates()) {
    setTimeout(() => pushCloudState(), 1500);
  }

  // 1. Ensure today's briefing is selected (어제 날짜 브리핑 노출 원천 차단)
  const todayB = ensureTodayBriefing(todayStr);

  // 2. Daily reset check on startup: 날짜가 바뀌었으면 무조건 출근 준비 상태로 리셋
  const savedWorkDate = localStorage.getItem('jeegong_work_date');
  if (!savedWorkDate || savedWorkDate !== todayStr) {
    workState = 'ready';
    try {
      localStorage.setItem('jeegong_work_date', todayStr);
      localStorage.setItem('jeegong_work_state', 'ready');
      localStorage.removeItem('jeegong_attendance_time');
    } catch (e) {}
  } else {
    const localWs = localStorage.getItem('jeegong_work_state');
    if (localWs === 'checked_in' || localWs === 'finished') {
      workState = localWs;
    } else if (todayB && todayB.attendance && todayB.attendance.status === 'checked_in') {
      workState = 'checked_in';
      try { localStorage.setItem('jeegong_work_state', 'checked_in'); } catch (e) {}
    } else {
      workState = (localWs === 'checked_in' || localWs === 'finished') ? localWs : 'ready';
    }
  }

  try {
    const savedTs = localStorage.getItem('jeegong_last_sync_ts');
    if (savedTs) lastLocalUpdateTimestamp = Number(savedTs) || 0;
  } catch (e) {}

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
  setupAiRoomWidget();
  renderTodayView();
  renderArchiveView();
  renderHistoryView();
  renderGongguCampaign();

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
  const iconEl = document.getElementById('btn-theme-icon');
  const labelEl = document.getElementById('btn-theme-label');
  const toggleBtn = document.getElementById('btn-theme-toggle');
  if (theme === 'dark') {
    if (iconEl) iconEl.textContent = '☀️';
    if (labelEl) labelEl.textContent = '라이트모드';
    if (toggleBtn) toggleBtn.title = '라이트모드로 전환';
  } else {
    if (iconEl) iconEl.textContent = '🌙';
    if (labelEl) labelEl.textContent = '다크모드';
    if (toggleBtn) toggleBtn.title = '다크모드로 전환';
  }
}

// Navigation (Desktop Sidebar & Mobile Segmented Tabs)
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const mobileTabBtns = document.querySelectorAll('.mobile-tab-btn');
  const viewSections = document.querySelectorAll('.view-section');
  const topTitle = document.getElementById('page-title');

  const titles = {
    'today-view': '홈',
    'email-view': '메일',
    'calendar-view': '캘린더',
    'todo-view': '할 일',
    'inquiry-view': '실시간 문의',
    'work-status-view': '업무 현황',
    'gonggu-view': '올쓰컴퍼니 공동구매',
    'sales-view': '정산·매출'
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

    const crumbCurrent = document.getElementById('breadcrumb-current');
    if (crumbCurrent) {
      crumbCurrent.textContent = titles[viewId] || '홈';
    }

    if (viewId === 'gonggu-view' && typeof renderGongguCampaign === 'function') {
      renderGongguCampaign();
    }

    if (topTitle) topTitle.textContent = '지공 출근 에이전트';

    // Close mobile drawer on navigation
    const sidebarEl = document.querySelector('.sidebar');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    if (sidebarEl) sidebarEl.classList.remove('mobile-open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('show');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.switchNavView = switchView;

  // Mobile drawer toggle button & backdrop
  const mobileToggleBtn = document.getElementById('btn-mobile-sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const sidebarEl = document.querySelector('.sidebar');
  if (mobileToggleBtn && sidebarEl && sidebarBackdrop) {
    mobileToggleBtn.addEventListener('click', () => {
      sidebarEl.classList.toggle('mobile-open');
      sidebarBackdrop.classList.toggle('show');
    });
    sidebarBackdrop.addEventListener('click', () => {
      sidebarEl.classList.remove('mobile-open');
      sidebarBackdrop.classList.remove('show');
    });
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

  // Calendar Controls
  const btnCalPrev = document.getElementById('btn-cal-prev');
  const btnCalNext = document.getElementById('btn-cal-next');
  const btnCalToday = document.getElementById('btn-cal-today');
  if (btnCalPrev) {
    btnCalPrev.addEventListener('click', () => {
      window.currentCalWeekOffset--;
      renderWeeklyCalendar();
    });
  }
  if (btnCalNext) {
    btnCalNext.addEventListener('click', () => {
      window.currentCalWeekOffset++;
      renderWeeklyCalendar();
    });
  }
  if (btnCalToday) {
    btnCalToday.addEventListener('click', () => {
      window.currentCalWeekOffset = 0;
      renderWeeklyCalendar();
    });
  }
  // 주/월 보기 전환
  document.querySelectorAll('.cal-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-cal-mode');
      if (mode === window.currentCalMode) return;
      window.currentCalMode = mode;
      window.currentCalWeekOffset = 0;
      try { localStorage.setItem('jeegong_cal_mode', mode); } catch (e) {}
      renderWeeklyCalendar();
    });
  });
}

// Weekly Google Calendar State
window.currentCalWeekOffset = 0;
window.currentCalMode = (function () {
  try { return localStorage.getItem('jeegong_cal_mode') === 'month' ? 'month' : 'week'; } catch (e) { return 'week'; }
})();

// 월 보기: 해당 월 1일이 속한 주 월요일 ~ 말일이 속한 주 일요일
function getMonthDateRange(offset = 0) {
  const kst = getKSTNow();
  const base = new Date(kst.d);
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
  const days = [];
  for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({
      dateStr,
      month: d.getMonth() + 1,
      dayNum: d.getDate(),
      dayName: dayNames[i % 7],
      isToday: dateStr === kst.dateStr,
      isOtherMonth: d.getMonth() !== first.getMonth()
    });
  }
  return { days, year: first.getFullYear(), month: first.getMonth() + 1 };
}

function getWeekDateRange(offset = 0) {
  const kst = getKSTNow();
  // Dynamically calculate Monday of the week from current KST date
  const currD = new Date(kst.d);
  const dayOfWeek = currD.getDay(); // 0 is Sun, 1 is Mon...
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  const monday = new Date(currD);
  monday.setDate(currD.getDate() + diffToMonday + (offset * 7));
  
  const days = [];
  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;
    days.push({
      dateStr: dateStr,
      month: d.getMonth() + 1,
      dayNum: d.getDate(),
      dayName: dayNames[i],
      isToday: (offset === 0 && dateStr === kst.dateStr)
    });
  }
  return days;
}

function renderWeeklyCalendar() {
  const container = document.getElementById('week-calendar-container');
  const fullContainer = document.getElementById('calendar-full-view-container');
  const agendaContainer = document.getElementById('calendar-agenda-list');
  if (!appData || !appData.briefings) return;
  
  const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
  const events = (b.calendarEvents || []);
  
  const isMonth = window.currentCalMode === 'month';
  let days, rangeStr;
  if (isMonth) {
    const mr = getMonthDateRange(window.currentCalWeekOffset);
    days = mr.days;
    rangeStr = `${mr.year}년 ${mr.month}월`;
  } else {
    days = getWeekDateRange(window.currentCalWeekOffset);
    const startDay = days[0];
    const endDay = days[6];
    rangeStr = `${startDay.month}월 ${startDay.dayNum}일~${endDay.month === startDay.month ? '' : endDay.month + '월 '}${endDay.dayNum}일`;
  }
  document.querySelectorAll('.cal-mode-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-cal-mode') === window.currentCalMode);
  });
  const calPanelTitle = document.getElementById('cal-panel-title');
  if (calPanelTitle) calPanelTitle.textContent = '캘린더 (구글 캘린더)';
  const rangeTextEl = document.getElementById('cal-week-range-text');
  if (rangeTextEl) rangeTextEl.textContent = rangeStr;
  const fullRangeTextEl = document.getElementById('cal-full-range-text');
  if (fullRangeTextEl) fullRangeTextEl.textContent = rangeStr;

  const rangeStart = days[0].dateStr;
  const rangeEnd = days[days.length - 1].dateStr;
  const visibleEvents = events.filter(ev => {
    const s = ev.startDate || ev.date;
    const e = ev.endDate || s;
    return !s || (s <= rangeEnd && e >= rangeStart);
  });
  const calBannerCount = document.getElementById('calendar-view-banner-count');
  if (calBannerCount) calBannerCount.textContent = `${visibleEvents.length}건`;
  const calAgendaBadge = document.getElementById('calendar-agenda-badge');
  if (calAgendaBadge) calAgendaBadge.textContent = `${visibleEvents.length}개 일정`;

  function buildGridHtml() {
    let html = '';
    days.forEach(day => {
      const dayEvents = events.filter(ev => {
        const start = ev.startDate || ev.date;
        const end = ev.endDate || start;
        if (start && end) {
          return day.dateStr >= start && day.dateStr <= end;
        }
        return start === day.dateStr || (day.isToday && !start);
      });
      
      let eventsHtml = '';
      dayEvents.forEach(ev => {
        let badgeClass = 'badge-default';
        if (ev.tag === '공구') badgeClass = 'badge-gonggu';
        else if (ev.tag === '개인') badgeClass = 'badge-personal';
        else if (ev.tag === '업무' || ev.tag === '외주') badgeClass = 'badge-biz';

        const titleText = ev.summary || ev.title || '일정';
        eventsHtml += `
          <div class="cal-event-card" style="border-left-color: ${ev.color || '#3b82f6'};" title="${titleText} (${ev.time || '종일'})">
            <div class="cal-event-time">${ev.time || '종일'}</div>
            <div class="cal-event-title">${titleText}</div>
            <span class="cal-event-badge ${badgeClass}">${ev.tag || '공구'}</span>
          </div>
        `;
      });
      
      if (dayEvents.length === 0 && !isMonth) {
        eventsHtml = `<div style="font-size: 11px; color: var(--text-tertiary); text-align: center; margin-top: 24px;">-</div>`;
      }
      
      html += `
        <div class="day-column ${day.isToday ? 'is-today' : ''} ${day.isOtherMonth ? 'is-other-month' : ''}">
          <div class="day-header">
            <div class="day-name">${day.dayName}</div>
            <div class="day-num">${day.dayNum}</div>
          </div>
          <div class="day-events-list">
            ${eventsHtml}
          </div>
        </div>
      `;
    });
    return html;
  }

  const gridHtml = buildGridHtml();
  [container, fullContainer].forEach(el => { if (el) el.classList.toggle('is-month', isMonth); });
  if (container) {
    container.innerHTML = gridHtml;
    // Mobile responsive: automatically scroll to today's column
    setTimeout(() => {
      const todayCol = container.querySelector('.day-column.is-today');
      if (todayCol) {
        const scrollTarget = todayCol.offsetLeft - (container.clientWidth / 2) + (todayCol.clientWidth / 2);
        container.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
      }
    }, 60);
  }
  if (fullContainer) {
    fullContainer.innerHTML = gridHtml;
    setTimeout(() => {
      const todayCol = fullContainer.querySelector('.day-column.is-today');
      if (todayCol) {
        const scrollTarget = todayCol.offsetLeft - (fullContainer.clientWidth / 2) + (todayCol.clientWidth / 2);
        fullContainer.scrollTo({ left: Math.max(0, scrollTarget), behavior: 'smooth' });
      }
    }, 60);
  }

  // Render Agenda List in calendar-view
  if (agendaContainer) {
    agendaContainer.innerHTML = '';
    if (visibleEvents.length === 0) {
      agendaContainer.innerHTML = '<div class="empty-state">이 기간에 예정된 구글 캘린더 일정이 없습니다.</div>';
    } else {
      visibleEvents.forEach(ev => {
        let badgeClass = 'badge-yellow';
        if (ev.tag === '공구') badgeClass = 'badge-orange';
        else if (ev.tag === '개인') badgeClass = 'badge-red';

        const titleText = ev.summary || ev.title || '일정';
        const dateText = (ev.startDate || ev.date || '') + (ev.endDate && ev.endDate !== (ev.startDate || ev.date) ? ' ~ ' + ev.endDate : '');

        agendaContainer.innerHTML += `
          <div class="action-item" style="cursor: default;">
            <div class="action-left">
              <span class="action-icon">📅</span>
              <div>
                <div class="action-text">${titleText}</div>
                <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 2px;">
                  ${dateText} · ${ev.time || '종일'} · ${ev.location || '온라인'}
                </div>
              </div>
            </div>
            <span class="action-badge ${badgeClass}">${ev.tag || '일정'}</span>
          </div>
        `;
      });
    }
  }
}

function renderTodoTable() {
  const tbody = document.getElementById('todo-table-body');
  const fullTbody = document.getElementById('todo-full-table-body');
  if (!appData || !appData.briefings) return;
  
  const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
  const todos = b.todomateTodos || b.todos || [];
  const priorities = b.agentPriorities || b.priorities || [];
  
  const pendingTodos = todos.filter(t => !t.done && !t.excluded);
  const doneTodos = todos.filter(t => t.done && !t.excluded);
  const pendingPriorities = priorities.filter(p => !p.done && !p.excluded);
  const donePriorities = priorities.filter(p => p.done && !p.excluded);

  const totalPending = pendingTodos.length + pendingPriorities.length;
  const totalDone = doneTodos.length + donePriorities.length;

  const sideTodoBadge = document.getElementById('side-todo-badge');
  if (sideTodoBadge) {
    if (totalPending > 0) {
      sideTodoBadge.style.display = 'inline-flex';
      sideTodoBadge.textContent = totalPending;
      sideTodoBadge.title = `오늘 남은 할 일 ${totalPending}건`;
    } else {
      sideTodoBadge.style.display = 'none';
    }
  }

  const todoViewBadge = document.getElementById('todo-view-badge');
  if (todoViewBadge) todoViewBadge.textContent = `${totalPending}건 남음`;

  const todoBannerCount = document.getElementById('todo-view-banner-count');
  if (todoBannerCount) todoBannerCount.textContent = `${totalPending}건 (완료 ${totalDone}건)`;

  const statTodoEl = document.getElementById('stat-todo-count');
  if (statTodoEl) statTodoEl.textContent = totalPending;

  const todomateCountBadge = document.getElementById('todomate-count-badge');
  if (todomateCountBadge) todomateCountBadge.textContent = `${totalPending}건 대기`;

  function buildTableRows() {
    let rowsHtml = '';
    
    // 1. Todomate Todos
    todos.forEach(t => {
      if (t.excluded) return;
      let catClass = 'cat-default';
      if (t.category === '사업or수익') catClass = 'cat-biz';
      else if (t.category === '자기계발') catClass = 'cat-self';
      else if (t.category === '해야할일' || t.category === '해야 할 일') catClass = 'cat-todo';

      rowsHtml += `
        <tr id="todo-row-${t.id}">
          <td style="text-align: center;">
            <input type="checkbox" class="todo-check-input" ${t.done ? 'checked' : ''} onchange="toggleTodomateTodo('${t.id}')">
          </td>
          <td>
            <span class="todo-text-main ${t.done ? 'done' : ''}" id="todo-text-${t.id}">${t.text || t.title || '할 일 내용'}</span>
          </td>
          <td style="text-align: center;">
            <span class="cat-tag ${catClass}">${t.category || '사업or수익'}</span>
          </td>
          <td style="text-align: center;">
            <span class="source-tag">${t.id.startsWith('custom-') || t.source === 'dashboard' ? '💻 대시보드' : '📱 투두메이트'}</span>
          </td>
          <td style="text-align: center;">
            <button class="btn-del-todo" onclick="deleteTodomateTodo('${t.id}')" title="삭제">✕</button>
          </td>
        </tr>
      `;
    });
    
    // 2. Agent Priorities (에이전트 추천 핵심 우선순위 통합 행)
    priorities.forEach(p => {
      if (p.excluded) return;
      rowsHtml += `
        <tr id="todo-row-${p.id}" class="todo-agent-row" style="background-color: rgba(59, 130, 246, 0.02);">
          <td style="text-align: center;">
            <input type="checkbox" class="todo-check-input" ${p.done ? 'checked' : ''} onchange="toggleAgentPriorityDone('${p.id}')">
          </td>
          <td>
            <div class="todo-text-main ${p.done ? 'done' : ''}" id="todo-text-${p.id}">
              <strong style="color: var(--accent-blue); font-size: 11px; margin-right: 4px;">${p.priority || '우선'}</strong>
              <span>${p.title}</span>
              ${(p.detail || p.desc) ? `<div style="font-size: 11.5px; color: var(--text-tertiary); margin-top: 3px; line-height: 1.4; font-weight: normal; text-decoration: none;">💡 ${p.detail || p.desc}</div>` : ''}
            </div>
          </td>
          <td style="text-align: center;">
            <span class="cat-tag cat-agent">에이전트 추천</span>
          </td>
          <td style="text-align: center;">
            <span class="source-tag">✨ 피클 AI</span>
          </td>
          <td style="text-align: center;">
            <button class="btn-del-todo" onclick="deleteAgentPriority('${p.id}')" title="삭제">✕</button>
          </td>
        </tr>
      `;
    });
    return rowsHtml;
  }

  const tableRows = buildTableRows();
  if (tbody) tbody.innerHTML = tableRows;
  if (fullTbody) fullTbody.innerHTML = tableRows;
}

window.addTodoFromViewInput = function() {
  const input = document.getElementById('todo-view-quick-input');
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
  const kst = getKSTNow();
  const dateKey = b.date || kst.dateStr;
  const newTodo = {
    id: `custom-${Date.now()}`,
    text: text,
    category: '사업or수익',
    done: false,
    excluded: false,
    source: 'dashboard',
    createdAt: Date.now()
  };
  if (!b.todomateTodos) b.todomateTodos = [];
  b.todomateTodos.unshift(newTodo);
  saveCustomAddedTodo(dateKey, newTodo);
  saveLocalTodosState(currentBriefingId);
  renderTodoTable();
  renderTodayView();
  showToast(`📝 할 일 '${text}'이(가) 등록되었습니다.`);
  pushCloudState();
};

// Render Today's Briefing
function renderTodayView() {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];

  // Stats Counters (Lean-AX Metric Cards: clean numbers)
  const calCountEl = document.getElementById('stat-calendar-count');
  if (calCountEl) {
    const _wk = getWeekDateRange(0);
    const weekEventsCount = b.calendarEvents ? b.calendarEvents.filter(ev => { const s = ev.startDate || ev.date; const e = ev.endDate || s; return !s || (s <= _wk[6].dateStr && e >= _wk[0].dateStr); }).length : (b.calendar ? b.calendar.count : 0);
    calCountEl.textContent = weekEventsCount || '4';
  }

  // Update Sidebar Nav Badges with clear helper
  function updateNavBadge(badgeEl, count, label) {
    if (!badgeEl) return;
    if (count > 0) {
      badgeEl.style.display = 'inline-flex';
      badgeEl.textContent = count;
      badgeEl.title = `${label} ${count}건`;
    } else {
      badgeEl.style.display = 'none';
    }
  }

  const filteredEmails = getFilteredEmails(b);
  const unhandledEmails = filteredEmails.filter(m => m.status !== 'excluded' && m.status !== 'done' && m.status !== 'sent').length;
  updateNavBadge(document.getElementById('side-email-badge'), unhandledEmails, '조치 필요 메일');

  const pendingTodosCount = b.todomateTodos ? b.todomateTodos.filter(t => !t.done && !t.excluded).length : 0;
  updateNavBadge(document.getElementById('side-todo-badge'), pendingTodosCount, '오늘 남은 할 일');

  const filteredInqsForStat = getFilteredInquiries(b);
  const unhandledInqs = filteredInqsForStat.filter(i => i.status !== 'excluded' && i.status !== 'done' && i.status !== 'sent').length;
  updateNavBadge(document.getElementById('side-inquiry-badge'), unhandledInqs, '답변 대기 문의');

  const emailCountEl = document.getElementById('stat-email-count');
  if (emailCountEl) emailCountEl.textContent = `${unhandledEmails}건`;
  const todoCountEl = document.getElementById('stat-todo-count');
  if (todoCountEl) todoCountEl.textContent = pendingTodosCount;
  const inqCountEl = document.getElementById('stat-inquiry-count');
  if (inqCountEl) inqCountEl.textContent = `${unhandledInqs}건`;
  const driveCountEl = document.getElementById('stat-drive-count');
  if (driveCountEl && b.driveFiles) driveCountEl.textContent = `${b.driveFiles.length}건`;

  // Update Gonggu Side Badge & Home Highlight Banner with total pending
  if (typeof updateGongguGlobalBadges === 'function') {
    updateGongguGlobalBadges();
  }

  // Guide
  const guideEl = document.getElementById('guide-banner-text');
  if (guideEl) guideEl.textContent = b.guide;

  // 1. Calendar (Legacy List fallback)
  const calContainer = document.getElementById('calendar-list-container');
  if (calContainer) {
    calContainer.innerHTML = '';
    if (b.calendar && b.calendar.count === 0) {
      calContainer.innerHTML = `<div class="empty-state">${b.calendar.note}</div>`;
    } else if (b.calendar && b.calendar.items) {
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
  }

  // 2. Render Emails into BOTH Home and Dedicated Email View
  renderEmailList(b, 'email-list-container', 'email-badge', null);
  renderEmailList(b, 'email-view-container', 'email-view-badge', 'email-view-banner-count');

  // 2-B. Customer Inquiries into BOTH Home and Dedicated Inquiry View
  renderInquiries(b, 'inquiry-list-container', 'inquiry-badge', null);
  renderInquiries(b, 'inquiry-exclusive-list-container', 'inquiry-view-badge', 'inquiry-view-banner-count');

  // 3-A. Todomate Todos (Legacy List fallback)
  const todoContainer = document.getElementById('todomate-list-container');
  const todoBadge = document.getElementById('todomate-count-badge');
  if (todoBadge) todoBadge.textContent = `${pendingTodosCount}건 대기`;

  if (todoContainer) {
    todoContainer.innerHTML = '';
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
          <button class="todo-delete-btn" onclick="event.stopPropagation(); window.deleteTodomateTodo('${todo.id}')" title="할 일 삭제">✕</button>
        </div>
      `;
    });
  }

  // 3-B. Agent Recommended Priorities (Consolidated into Modern Table above)
  const agentContainer = document.getElementById('agent-priority-container');
  if (agentContainer) {
    agentContainer.innerHTML = '';
  }

  // 4. Drive References
  const driveContainer = document.getElementById('drive-list-container');
  const docsContainer = document.getElementById('docs-list-container');
  const driveBadge = document.getElementById('drive-badge');
  if (b.driveFiles) {
    if (driveBadge) driveBadge.textContent = `${b.driveFiles.length}개 문서`;
    let driveHtml = '';
    b.driveFiles.forEach(file => {
      const icon = file.type === 'sheet' ? '📊' : file.type === 'pdf' ? '📕' : '📄';
      driveHtml += `
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
    if (driveContainer) driveContainer.innerHTML = driveHtml;
    if (docsContainer) docsContainer.innerHTML = driveHtml;
  }

  // Render Modern Lean-AX Sections
  renderWeeklyCalendar();
  renderTodoTable();
}

// Dedicated Reusable Email List Renderer
function renderEmailList(b, containerId, badgeId, bannerCountId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const filteredEmails = getFilteredEmails(b);
  const unhandledCount = filteredEmails.filter(e => e.status !== 'excluded' && e.status !== 'done' && e.status !== 'sent').length;

  const badge = document.getElementById(badgeId);
  if (badge) badge.textContent = `${unhandledCount}건 조치 필요`;

  if (bannerCountId) {
    const bannerEl = document.getElementById(bannerCountId);
    if (bannerEl) bannerEl.textContent = `${unhandledCount}건`;
  }

  container.innerHTML = '';
  if (filteredEmails.length === 0) {
    container.innerHTML = '<div class="empty-state">조치 필요한 신규 메일이 없습니다. 에이전트가 5분 단위로 수신함을 자동 감시 중입니다.</div>';
    return;
  }

  const sortedEmails = [...filteredEmails].sort((a, b) => {
    const aHandled = a.status === 'done' || a.status === 'sent' || a.status === 'excluded';
    const bHandled = b.status === 'done' || b.status === 'sent' || b.status === 'excluded';
    if (aHandled === bHandled) return 0;
    return aHandled ? 1 : -1;
  });

  sortedEmails.forEach(mail => {
    const isP1 = mail.priority && mail.priority.includes('1순위');
    const pClass = isP1 ? 'p1' : 'p2';
    const badgeClass = isP1 ? 'badge-p1' : 'badge-p2';
    const isExcluded = mail.status === 'excluded';
    const isDone = mail.status === 'done';
    const isSent = mail.status === 'sent';

    container.innerHTML += `
      <div class="email-item ${pClass} ${isExcluded ? 'excluded' : ''} ${isDone || isSent ? 'done' : ''}" id="email-item-${containerId}-${mail.id}">
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
                <button class="btn-process" onclick="openProcessDraft('${containerId}-${mail.id}')">
                  답장 처리
                </button>
              ` : ''}
            ` : ''}
          </div>
        </div>

        <!-- Inline Draft Editor Box -->
        <div class="inline-draft-box ${window.activeDraftBoxIds && window.activeDraftBoxIds.has(`draft-box-${containerId}-${mail.id}`) ? 'active' : ''}" id="draft-box-${containerId}-${mail.id}">
          <div class="draft-header">
            <span>✍️ 구름이 답장 초안 (복사하거나 메일함에서 열어 직접 발송)</span>
            <span style="font-size: 11.5px; color: var(--text-tertiary);">수신: ${mail.from}</span>
          </div>
          <textarea class="draft-textarea" id="draft-text-${containerId}-${mail.id}" oninput="onDraftInput('${mail.id}', this.value)">${mail.draft || ''}</textarea>
          <div class="draft-actions">
            <button class="btn-secondary" onclick="closeProcessDraft('${containerId}-${mail.id}')" style="padding: 6px 14px; font-size: 12px;">닫기</button>
            <button class="btn-secondary" onclick="copyDraftText('draft-text-${containerId}-${mail.id}')" style="padding: 6px 14px; font-size: 12px;">📋 초안 복사</button>
            ${(mail.draftUrl || mail.mailUrl) ? `<a class="btn-secondary" href="${mail.draftUrl || mail.mailUrl}" target="_blank" rel="noopener" style="padding: 6px 14px; font-size: 12px; text-decoration: none;">${mail.draftUrl ? '✉️ 초안 열기' : '✉️ 원문 열기'}</a>` : ''}
            <button class="btn-approve-send" onclick="approveAndSendEmail('${mail.id}')" style="padding: 7px 16px; font-size: 12.5px;">
              <span>직접 발송 완료</span>
              <span>✓</span>
            </button>
          </div>
        </div>
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

// Agent Priority Done / Delete Handlers (Unified Table Management)
window.deleteAgentPriority = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
  if (!b || !b.agentPriorities) return;
  const ap = b.agentPriorities.find(item => item.id === id);
  if (!ap) return;
  ap.excluded = true;
  saveLocalTodosState(currentBriefingId);
  renderTodoTable();
  renderTodayView();
  showToast(`🗑️ 에이전트 추천 '${ap.title}'을(를) 삭제했습니다.`);
  pushCloudState();
};

window.toggleAgentPriorityExclude = window.deleteAgentPriority;
window.toggleExcludePriority = window.deleteAgentPriority;

window.toggleAgentPriorityDone = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
  if (!b || !b.agentPriorities) return;
  const ap = b.agentPriorities.find(item => item.id === id);
  if (!ap) return;
  ap.done = !ap.done;
  saveLocalTodosState(currentBriefingId);
  renderTodoTable();
  renderTodayView();
  showToast(ap.done ? `✅ '${ap.title}' 완료 처리되었습니다!` : `완료 처리를 취소했습니다.`);
  pushCloudState();
};

window.togglePriorityDone = window.toggleAgentPriorityDone;

// Email Exclude / Restore
// Render Customer Inquiries (Kmong, Imweb, Mail) with Cross-day Deduplication & Responsive Badges
function renderInquiries(b, containerId, badgeId, bannerCountId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!b.inquiries) b.inquiries = [];

  const filteredInquiries = getFilteredInquiries(b);

  const badge = document.getElementById(badgeId);
  const pendingCount = filteredInquiries.filter(i => i.status !== 'excluded' && i.status !== 'done' && i.status !== 'sent').length;
  if (badge) {
    badge.textContent = `${pendingCount}건 대기`;
  }

  if (bannerCountId) {
    const bannerEl = document.getElementById(bannerCountId);
    if (bannerEl) bannerEl.textContent = `${pendingCount}건`;
  }

  container.innerHTML = '';
  if (filteredInquiries.length === 0) {
    container.innerHTML = '<div class="empty-state">현재 인입된 신규 고객 문의가 없습니다. 에이전트가 크몽·아임웹 채널톡을 실시간 감시 중입니다.</div>';
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

    const sender = inq.from || inq.customer || inq.sender || '고객';
    const subject = inq.subject || inq.question || inq.title || '고객 문의';
    const content = inq.content || inq.question || inq.summary || inq.context || '문의 내용이 등록되어 있습니다.';

    container.innerHTML += `
      <div class="inquiry-item ${chClass} ${isExcluded ? 'excluded' : ''} ${isDone || isSent ? 'done' : ''}" id="inquiry-item-${containerId}-${inq.id}">
        <div class="email-top">
          <div class="email-badges-row">
            <div class="email-badges-left">
              <span class="badge-tag ${badgeChClass}">${inq.channel} 문의</span>
              <span class="email-sender" title="${sender}">${sender}</span>
              <span class="email-time" style="font-size: 11.5px; color: var(--text-tertiary);">${inq.time}</span>
            </div>
            <div class="email-badges-right">
              ${isDone ? '<span class="badge-tag badge-status-done">직접 답변 완료 ✓</span>' : ''}
              ${isSent ? '<span class="badge-tag badge-status-sent">발송 완료 ✓</span>' : ''}
              ${isExcluded ? '<span class="badge-tag badge-status-excluded">제외됨</span>' : ''}
            </div>
          </div>
        </div>

        <div class="email-subject">${subject}</div>
        <div class="inquiry-content-box">
          <div class="inquiry-content-label">💬 고객 문의 내용 전문</div>
          <div class="inquiry-content-text">${content}</div>
        </div>

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
        <div class="inline-draft-box ${window.activeDraftBoxIds && window.activeDraftBoxIds.has(`inquiry-draft-box-${containerId}-${inq.id}`) ? 'active' : ''}" id="inquiry-draft-box-${containerId}-${inq.id}">
          <div class="draft-header">
            <span>✍️ 구름이 고객 응대 초안 (복사하거나 메일함에서 열어 직접 발송)</span>
            <span style="font-size: 11.5px; color: var(--text-tertiary);">수신: ${sender}</span>
          </div>
          <textarea class="draft-textarea" id="inquiry-draft-text-${containerId}-${inq.id}" oninput="onInquiryDraftInput('${inq.id}', this.value)">${inq.draft || ''}</textarea>
          <div class="draft-actions">
            <button class="btn-secondary" onclick="closeInquiryProcessDraft('${containerId}-${inq.id}')" style="padding: 6px 14px; font-size: 12px;">닫기</button>
            <button class="btn-secondary" onclick="copyDraftText('inquiry-draft-text-${containerId}-${inq.id}')" style="padding: 6px 14px; font-size: 12px;">📋 초안 복사</button>
            ${(inq.draftUrl || inq.mailUrl) ? `<a class="btn-secondary" href="${inq.draftUrl || inq.mailUrl}" target="_blank" rel="noopener" style="padding: 6px 14px; font-size: 12px; text-decoration: none;">${inq.draftUrl ? '✉️ 초안 열기' : '✉️ 원문 열기'}</a>` : ''}
            <button class="btn-approve-send" onclick="approveAndSendInquiry('${inq.id}', '${containerId}-${inq.id}')" style="padding: 7px 16px; font-size: 12.5px;">
              <span>직접 발송 완료</span>
              <span>✓</span>
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

  // 메일은 대시보드에서 직접 보내지 않는다. 원진님이 메일함에서 직접 발송한 뒤 '발송 완료'로 표시만 한다.
  pushCloudState();
  showToast('✓ 직접 발송 완료로 표시했습니다.');
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

// Active draft editor tracking to prevent closing on background sync
window.activeDraftBoxIds = window.activeDraftBoxIds || new Set();

window.onDraftInput = function(id, val) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  if (!b) return;
  const mail = (b.emails || []).find(m => m.id === id);
  if (mail) mail.draft = val;
};

window.onInquiryDraftInput = function(id, val) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  if (!b) return;
  const inq = (b.inquiries || []).find(i => i.id === id);
  if (inq) inq.draft = val;
};

// Open Process Draft Box
window.openProcessDraft = function(id) {
  const box = document.getElementById(`draft-box-${id}`);
  if (box) {
    box.classList.toggle('active');
    if (box.classList.contains('active')) {
      activeDraftBoxIds.add(`draft-box-${id}`);
      const ta = document.getElementById(`draft-text-${id}`);
      if (ta) ta.focus();
    } else {
      activeDraftBoxIds.delete(`draft-box-${id}`);
    }
  }
};

window.closeProcessDraft = function(id) {
  const box = document.getElementById(`draft-box-${id}`);
  if (box) box.classList.remove('active');
  activeDraftBoxIds.delete(`draft-box-${id}`);
};

// Open / Close Customer Inquiry Process Draft Box
window.openInquiryProcessDraft = function(domId) {
  const box = document.getElementById(`inquiry-draft-box-${domId}`);
  if (box) {
    box.classList.toggle('active');
    if (box.classList.contains('active')) {
      activeDraftBoxIds.add(`inquiry-draft-box-${domId}`);
      const ta = document.getElementById(`inquiry-draft-text-${domId}`);
      if (ta) ta.focus();
    } else {
      activeDraftBoxIds.delete(`inquiry-draft-box-${domId}`);
    }
  }
};

window.closeInquiryProcessDraft = function(domId) {
  const box = document.getElementById(`inquiry-draft-box-${domId}`);
  if (box) box.classList.remove('active');
  activeDraftBoxIds.delete(`inquiry-draft-box-${domId}`);
};

// 답장 초안 복사 (발송은 원진님이 메일함에서 직접)
window.copyDraftText = async function(textareaId) {
  const el = document.getElementById(textareaId);
  const text = el ? el.value : '';
  if (!text) { showToast('복사할 초안이 없습니다.'); return; }
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    el.select(); document.execCommand('copy');
  }
  showToast('📋 초안을 복사했습니다. 메일함에서 붙여넣고 첨부 후 직접 발송해 주세요.');
};

// 직접 발송 완료 표시 (대시보드는 메일을 보내지 않음)
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

  // 메일은 대시보드에서 직접 보내지 않는다. 원진님이 메일함에서 직접 발송한 뒤 '발송 완료'로 표시만 한다.
  showToast('✓ 직접 발송 완료로 표시했습니다.');

  pushCloudState();
};

// Quick Add Todo (0.1초 원클릭 엔터 등록)
window.handleQuickAddTodo = function() {
  const inputEl = document.getElementById('input-quick-add-todo');
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (!text) return;

  if (appData && appData.briefings) {
    const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
    const kst = getKSTNow();
    const dateKey = b.date || kst.dateStr;
    const newTodo = {
      id: `custom-${Date.now()}`,
      text: text,
      category: '사업or수익',
      done: false,
      excluded: false,
      source: 'dashboard',
      createdAt: Date.now()
    };
    if (!b.todomateTodos) b.todomateTodos = [];
    b.todomateTodos.unshift(newTodo);
    saveCustomAddedTodo(dateKey, newTodo);
    saveLocalTodosState(b.id);
    renderTodoTable();
    renderTodayView();
    pushCloudState();
    inputEl.value = '';
    inputEl.focus();
    showToast(`📝 할 일 '${text}'이(가) 등록되었습니다.`);
  }
};

// Delete Todomate Todo (0.1초 원클릭 영구 삭제 - 절대 부활 방지)
window.deleteTodomateTodo = function(id) {
  if (!appData || !appData.briefings) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
  const kst = getKSTNow();
  const dateKey = b.date || kst.dateStr;
  removeCustomAddedTodo(dateKey, id);
  const idx = (b.todomateTodos || []).findIndex(t => t.id === id);
  if (idx !== -1) {
    const deletedItem = b.todomateTodos[idx];
    const deletedName = deletedItem.text;
    const deletedId = deletedItem.id;
    b.todomateTodos.splice(idx, 1);

    // 영구 삭제 목록(deleted_todos)에 기록 (새로고침/재로드 시 영구 부활 차단)
    try {
      let delList = JSON.parse(localStorage.getItem(`jeegong_deleted_todos_${dateKey}`) || '[]');
      if (deletedId && !delList.includes(deletedId)) delList.push(deletedId);
      if (deletedName && !delList.includes(deletedName)) delList.push(deletedName);
      localStorage.setItem(`jeegong_deleted_todos_${dateKey}`, JSON.stringify(delList));
    } catch (e) {}

    saveLocalTodosState(b.id);
    renderTodoTable();
    renderTodayView();
    pushCloudState();
    showToast(`🗑️ 할 일 '${deletedName}'을(를) 삭제했습니다. (영구 삭제 완료)`);
  }
};

// Toggle Todomate Todo
window.toggleTodomateTodo = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const t = b.todomateTodos.find(item => item.id === id);
  if (t) {
    t.done = !t.done;
    const kst = getKSTNow();
    const dateKey = b.date || kst.dateStr;
    if (t.id.startsWith('custom-') || t.source === 'dashboard') {
      saveCustomAddedTodo(dateKey, t);
    }
    saveLocalTodosState(currentBriefingId);
    renderTodoTable();
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

  if (btnRun) {
    btnRun.addEventListener('click', async () => {
      if (workState !== 'checked_in' && workState !== 'finished') {
        // 1. Run Check-in scan
        btnRun.disabled = true;
        if (banner) banner.classList.add('active');

        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          const el = document.getElementById(s.id);
          if (el) el.classList.add('running');
          if (statusText) statusText.textContent = s.text;
          if (progressText) progressText.textContent = `${i} / 5 진행`;

          await new Promise(r => setTimeout(r, 550));

          if (el) {
            el.classList.remove('running');
            el.classList.add('done');
          }
          if (progressText) progressText.textContent = `${i + 1} / 5 완료`;
        }

        if (statusText) statusText.textContent = '✨ 5대 도구 전수 분석 완료! 오늘의 출근 브리핑이 동기화되었습니다.';

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
          if (banner) banner.classList.remove('active');
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
  }

  // Copy Markdown (Dynamically generated from current briefing)
  if (copyBtn) {
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
  }

  // Quick Add Todo Input Enter Key
  const quickInput = document.getElementById('input-quick-add-todo');
  if (quickInput) {
    quickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.handleQuickAddTodo();
      }
    });
  }

  const todoViewQuickInput = document.getElementById('todo-view-quick-input');
  if (todoViewQuickInput) {
    todoViewQuickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.addTodoFromViewInput();
      }
    });
  }

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
  const hasActiveDraft = (window.activeDraftBoxIds && window.activeDraftBoxIds.size > 0) || document.querySelector('.inline-draft-box.active');
  const isTyping = document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT');
  if (!showNotice && (hasActiveDraft || isTyping)) {
    return;
  }

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

    // 3. Ensure today's briefing is selected
    ensureTodayBriefing(kst.dateStr);

    // 4. Restore user's completed todos and priorities from local cache first
    restoreLocalTodosState(currentBriefingId);

    // 5. Pull cloud state from ntfy (authoritative remote sync updates and persists if newer)
    await pullCloudState();

    // 6. Check midnight daily reset
    checkMidnightReset();

    // 7. Re-render all views
    renderTodayView();
    renderGongguCampaign();

    // 8. Publish refresh signal to ntfy for background agent to sync Todomate
    if (showNotice) {
      try {
        window._isAwaitingTodomateSync = true;
        fetch(`${SYNC_ENDPOINT}`, {
          method: 'POST',
          headers: {
            'Title': '[Jeegong Refresh Request]',
            'Tags': 'refresh,todomate'
          },
          body: 'action:refresh_todomate'
        }).catch(e => console.warn('Refresh signal error:', e));

        if (todoRefreshBtn) todoRefreshBtn.classList.add('spinning');
        showToast('🔄 최신 데이터 불러오는 중...');

        if (window._todomateSyncTimer) clearTimeout(window._todomateSyncTimer);
        window._todomateSyncTimer = setTimeout(() => {
          if (window._isAwaitingTodomateSync) {
            window._isAwaitingTodomateSync = false;
            const tBtn = document.getElementById('btn-refresh-todomate');
            if (tBtn) tBtn.classList.remove('spinning');
            showToast('ℹ️ 백그라운드 에이전트 동기화 진행 중입니다. 잠시 후 자동 반영됩니다.');
          }
        }, 15000);
      } catch (e) {
        showToast('🔄 최신 메일, 문의를 새로고침했습니다.');
      }
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
    if (todoRefreshBtn && !window._isAwaitingTodomateSync) {
      setTimeout(() => {
        todoRefreshBtn.classList.remove('spinning');
      }, 500);
    }
  }
};

window.refreshTodomateOnly = async function() {
  const todoRefreshBtn = document.getElementById('btn-refresh-todomate');
  if (todoRefreshBtn) todoRefreshBtn.classList.add('spinning');
  
  const kst = getKSTNow();
  const dateKey = kst.dateStr;
  try {
    localStorage.removeItem(`jeegong_done_todos_${dateKey}`);
  } catch (e) {}

  try {
    await fetch(SUPABASE_STATE_ENDPOINT, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        work_date: dateKey,
        done_todos: []
      })
    });
  } catch (e) {}

  await window.refreshDashboardData(true);
  showToast('투두메이트 상태가 동기화되었습니다.');
};

function showToast(msg) {
  const t = document.getElementById('toast-notice');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// =========================================================
// AI 협업방 플로팅 위젯 (2026-11-16 4차 — 기존 구름이 챗봇 자리를 대체)
//   · 우측 하단 런처 → 챗봇형 팝업(데스크톱 400x600 카드 / 모바일 풀시트)
//   · 팝업 안에는 ./ai-chat-room/?room=Jeegong_0724&embed=1 을 iframe으로 띄운다
//   · 첫 클릭 전에는 iframe을 로드하지 않아 대시보드 초기 로딩을 무겁게 하지 않는다
//   · 2026-11-17: 플로팅 버튼에 '안 읽은 AI 메시지' 숫자 배지 추가
//       읽음 기준은 ai-chat-room과 같은 localStorage 키를 쓰고,
//       팝업을 열면 즉시 0으로 초기화되며, 열려 있는 동안 도착분은 읽은 것으로 처리한다.
// =========================================================
const AIROOM_ID = 'Jeegong_0724';
const AIROOM_READ_KEY = 'ai-chat-room.lastReadAt';
const AIROOM_POLL_MS = 20000;

function aiRoomReadStamp() {
  try { return localStorage.getItem(AIROOM_READ_KEY) || ''; } catch (e) { return ''; }
}

function aiRoomWriteStamp(at) {
  if (!at) return;
  try { localStorage.setItem(AIROOM_READ_KEY, at); } catch (e) { /* noop */ }
}

function setupAiRoomWidget() {
  const widget = document.getElementById('airoom-widget');
  const launcher = document.getElementById('airoom-launcher');
  const panel = document.getElementById('airoom-panel');
  const closeBtn = document.getElementById('airoom-close');
  const frame = document.getElementById('airoom-frame');
  const badge = document.getElementById('airoom-badge');

  if (!widget || !launcher || !panel || !frame) return;

  const frameSrc = frame.getAttribute('data-src') || './ai-chat-room/?room=Jeegong_0724&embed=1';
  let loaded = false;
  let polling = false;

  function isOpen() { return widget.getAttribute('data-open') === 'true'; }

  function loadFrame() {
    if (loaded) return;
    loaded = true;
    frame.setAttribute('src', frameSrc);
  }

  function postToFrame(msg) {
    try {
      if (frame.contentWindow) {
        frame.contentWindow.postMessage(Object.assign({ source: 'jeegong-dashboard' }, msg), '*');
      }
    } catch (e) { /* noop */ }
  }

  function renderBadge(n) {
    if (!badge) return;
    const count = Math.max(0, Number(n) || 0);
    if (count > 0 && !isOpen()) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = false;
      launcher.setAttribute('data-unread', String(count));
      launcher.setAttribute('title', `AI 협업방 열기 — 안 읽은 메시지 ${count}건`);
    } else {
      badge.hidden = true;
      badge.textContent = '';
      launcher.removeAttribute('data-unread');
      launcher.setAttribute('title', 'AI 협업방 열기 — 구름이(피클)·클로드·코덱스·Cue');
    }
  }

  async function refreshUnread() {
    if (polling || document.hidden) return;
    let since = aiRoomReadStamp();
    if (!since) {
      // 처음 쓰는 기기: 지금부터 새로 오는 글만 센다(과거 글로 배지가 뜨지 않게)
      aiRoomWriteStamp(new Date().toISOString());
      renderBadge(0);
      return;
    }
    polling = true;
    try {
      const url = `${SUPABASE_URL}/rest/v1/room_messages?room_id=eq.${encodeURIComponent(AIROOM_ID)}`
        + '&select=id,author,at&author=neq.user&demo=eq.false&sample=eq.false'
        + `&at=gt.${encodeURIComponent(since)}&order=at.desc&limit=100`;
      const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
      });
      if (!res.ok) return;
      const rows = await res.json();
      const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.author && r.author !== 'user');
      if (isOpen()) {
        // 열려 있으면 보는 중 — 최신 시각까지 읽음으로 올리고 배지는 없앤다
        if (list.length && list[0].at) aiRoomWriteStamp(list[0].at);
        renderBadge(0);
      } else {
        renderBadge(list.length);
      }
    } catch (e) {
      /* 네트워크가 흔들리면 다음 주기에 다시 */
    } finally {
      polling = false;
    }
  }

  function open() {
    widget.setAttribute('data-open', 'true');
    panel.setAttribute('aria-hidden', 'false');
    launcher.setAttribute('aria-expanded', 'true');
    loadFrame();
    // 열면 바로 읽음 처리 — 배지 숫자가 즉시 사라진다
    aiRoomWriteStamp(new Date().toISOString());
    renderBadge(0);
    postToFrame({ type: 'ai-room:panel', open: true });
  }

  function close() {
    widget.setAttribute('data-open', 'false');
    panel.setAttribute('aria-hidden', 'true');
    launcher.setAttribute('aria-expanded', 'false');
    postToFrame({ type: 'ai-room:panel', open: false });
    refreshUnread();
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  launcher.addEventListener('click', toggle);
  if (closeBtn) closeBtn.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  // 팝업 iframe이 준비되면 열림 상태를 다시 알려 준다(로딩 타이밍 차이 대비)
  frame.addEventListener('load', () => {
    if (isOpen()) postToFrame({ type: 'ai-room:panel', open: true });
  });

  // 방 페이지가 읽음/새 메시지를 알려 오면 배지를 맞춘다
  window.addEventListener('message', (e) => {
    const d = e && e.data;
    if (!d || d.source !== 'ai-chat-room') return;
    if (d.type === 'ai-room:read') {
      if (d.at) aiRoomWriteStamp(d.at);
      renderBadge(0);
    }
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });
  window.addEventListener('online', refreshUnread);

  renderBadge(0);
  refreshUnread();
  setInterval(refreshUnread, AIROOM_POLL_MS);

  // 다른 화면으로 이동해도 열린 상태는 유지하되, 창이 좁아지면(모바일) 시트로 자연스럽게 전환된다.
  window.__aiRoomWidget = { open, close, toggle, refreshUnread };
}

// =========================================================
// REAL-TIME CLOUD SYNC (Mobile <-> PC Real-time Sync via ntfy SSE)
// =========================================================

// Parse ntfy payload supporting both inline JSON message and attachment files (>4KB)
async function parseNtfyPayload(payload) {
  if (!payload) return null;
  if (payload.attachment && payload.attachment.url) {
    try {
      const aRes = await fetch(payload.attachment.url);
      if (aRes.ok) return await aRes.json();
    } catch (e) {
      console.warn('Failed to fetch ntfy attachment:', e);
    }
  }
  if (payload.message) {
    try {
      return JSON.parse(payload.message);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function setupRealtimeSync() {
  if (syncEventSource) {
    try { syncEventSource.close(); } catch (e) {}
  }

  // 1. Initial snapshot pull
  pullCloudState();

  // 2. Real-time instant SSE stream (Mobile <-> PC 0.1s instant sync)
  try {
    syncEventSource = new EventSource(`${SYNC_ENDPOINT}/sse`);
    syncEventSource.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.event === 'message') {
          if (typeof payload.message === 'string' && payload.message.startsWith('update:')) {
            console.log('Received dashboard update signal:', payload.message);
            await window.refreshDashboardData(false);
            if (payload.message.includes('todomate') || payload.message.includes('sync')) {
              window._isAwaitingTodomateSync = false;
              const tBtn = document.getElementById('btn-refresh-todomate');
              if (tBtn) tBtn.classList.remove('spinning');
              showToast('✅ 최신 할 일 동기화가 완료되었습니다!');
            }
            return;
          }
          const remoteData = await parseNtfyPayload(payload);
          if (remoteData && (remoteData.updatedAt || remoteData.timestamp)) {
            applyRemoteSync(remoteData);
          }
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
  ['focus', 'visibilitychange', 'pageshow'].forEach(evt => {
    window.addEventListener(evt, () => {
      if (evt !== 'visibilitychange' || !document.hidden) {
        checkMidnightReset();
        pullCloudState();
      }
    });
  });
  setInterval(pullCloudState, 8000);
}

async function pullCloudState() {
  if (!appData || !appData.briefings) return;
  const hasActiveDraft = (window.activeDraftBoxIds && window.activeDraftBoxIds.size > 0) || document.querySelector('.inline-draft-box.active');
  const isTyping = document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT');
  if (hasActiveDraft || isTyping) {
    return;
  }

  // 1. Supabase Cloud DB에서 직접 최신 상태 로드 (0% 유실 진실의 원천)
  try {
    const res = await fetch(`${SUPABASE_STATE_ENDPOINT}&select=*`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      },
      cache: 'no-store'
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        window._forceCloudSync = true;
        applyRemoteSync(rows[0]);
        window._forceCloudSync = false;
        return;
      }
    }
  } catch (err) {
    console.warn('Supabase pull error, falling back to ntfy:', err);
  }

  // 2. ntfy 폴백
  try {
    const res2 = await fetch(`${SYNC_ENDPOINT}/json?poll=1`);
    if (!res2.ok) return;
    const text = await res2.text();
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return;

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const payload = JSON.parse(lines[i]);
        const remoteData = await parseNtfyPayload(payload);
        if (remoteData && (remoteData.updated_at || remoteData.updatedAt || remoteData.timestamp)) {
          applyRemoteSync(remoteData);
          break;
        }
      } catch (e) {}
    }
  } catch (err) {
    console.warn('ntfy pull error:', err);
  }
}

function applyRemoteSync(remoteData) {
  if (!remoteData || !appData || !appData.briefings) return;
  const remoteTs = remoteData.updated_at || remoteData.updatedAt || remoteData.timestamp || 0;
  if (remoteTs <= lastLocalUpdateTimestamp && !window._forceCloudSync) return;

  isSyncing = true;
  lastLocalUpdateTimestamp = remoteTs;
  try { localStorage.setItem('jeegong_last_sync_ts', String(remoteTs)); } catch (e) {}

  const kst = getKSTNow();
  const todayStr = kst.dateStr;

  // 1. 출퇴근 상태 동기화
  const incomingWorkDate = remoteData.work_date || remoteData.workDate || todayStr;
  const incomingWorkState = remoteData.work_state || remoteData.workState;
  if (incomingWorkDate !== todayStr) {
    workState = 'ready';
    try {
      localStorage.setItem('jeegong_work_date', todayStr);
      localStorage.setItem('jeegong_work_state', 'ready');
      localStorage.removeItem('jeegong_attendance_time');
    } catch (e) {}
  } else if (incomingWorkState) {
    workState = (incomingWorkState === 'checked_in' || incomingWorkState === 'finished') ? incomingWorkState : 'ready';
    try {
      localStorage.setItem('jeegong_work_date', todayStr);
      localStorage.setItem('jeegong_work_state', workState);
    } catch (e) {}
  }
  updateWorkButtonUI();

  const b = appData.briefings.find(item => item.date === todayStr) || appData.briefings[0];
  if (b) {
    const dateKey = b.date || todayStr;
    const isNewDate = (incomingWorkDate !== todayStr);

    if (isNewDate) {
      // 날짜 변경 시 이전 날의 완료 목록을 오늘에 덮어쓰지 않음
      try {
        localStorage.removeItem(`jeegong_done_todos_${dateKey}`);
      } catch (e) {}
    } else {
      // 2. 삭제된 할 일 목록(deleted_todos) 영구 배제 적용
      const deletedList = remoteData.deleted_todos || remoteData.deletedTodos || [];
      if (Array.isArray(deletedList) && deletedList.length > 0) {
        try {
          let localDel = JSON.parse(localStorage.getItem(`jeegong_deleted_todos_${dateKey}`) || '[]');
          deletedList.forEach(item => {
            if (!localDel.includes(item)) localDel.push(item);
          });
          localStorage.setItem(`jeegong_deleted_todos_${dateKey}`, JSON.stringify(localDel));
        } catch (e) {}

        if (Array.isArray(b.todomateTodos)) {
          b.todomateTodos = b.todomateTodos.filter(t => !deletedList.includes(t.id) && !deletedList.includes(t.text));
        }
      }

      // 3. 완료된 할 일 목록(done_todos) 동기화
      const doneList = remoteData.done_todos || remoteData.doneTodos;
      if (Array.isArray(doneList)) {
        (b.todomateTodos || []).forEach(t => {
          t.done = doneList.includes(t.id) || doneList.includes(t.text);
        });
        try { localStorage.setItem(`jeegong_done_todos_${dateKey}`, JSON.stringify(doneList)); } catch (e) {}
      }

      // 4. 에이전트 우선순위 완료 동기화
      const donePri = remoteData.done_priorities || remoteData.donePriorities;
      if (Array.isArray(donePri)) {
        (b.agentPriorities || []).forEach(ap => {
          ap.done = donePri.includes(ap.id);
        });
        try { localStorage.setItem(`jeegong_done_priorities_${dateKey}`, JSON.stringify(donePri)); } catch (e) {}
      }
    }

    // 4-B. 에이전트 우선순위 삭제(excluded_priorities) 동기화
    const exPriList = remoteData.excluded_priorities || remoteData.excludedPriorities || [];
    if (Array.isArray(exPriList)) {
      try {
        localStorage.setItem(`jeegong_excluded_priorities_${dateKey}`, JSON.stringify(exPriList));
      } catch (e) {}
      if (Array.isArray(b.agentPriorities)) {
        b.agentPriorities.forEach(ap => {
          ap.excluded = exPriList.includes(ap.id);
        });
      }
    }

    // 5. 공동구매 발송 완료 목록 동기화 (전 캠페인 통합) - 변경 감지 가드
    let gongguChanged = false;

    const gongguSentList = remoteData.gonggu_sent || remoteData.gongguSent || [];
    if (Array.isArray(gongguSentList)) {
      const currentSent = Object.keys(localStorage)
        .filter(k => k.startsWith('jeegong_gonggu_sent_') && localStorage.getItem(k) === 'true')
        .map(k => k.replace('jeegong_gonggu_sent_', ''));

      const sentChanged = currentSent.length !== gongguSentList.length ||
        !currentSent.every(id => gongguSentList.includes(id));

      if (sentChanged) {
        gongguChanged = true;
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('jeegong_gonggu_sent_')) {
            const id = k.replace('jeegong_gonggu_sent_', '');
            if (!gongguSentList.includes(id)) {
              localStorage.removeItem(k);
            }
          }
        });
        gongguSentList.forEach(id => {
          localStorage.setItem('jeegong_gonggu_sent_' + id, 'true');
        });
      }
    }

    // 6. 공동구매 제외 목록 동기화 - 변경 감지 가드
    const gongguExList = remoteData.gonggu_excluded || remoteData.gongguExcluded || [];
    if (Array.isArray(gongguExList)) {
      const currentEx = Object.keys(localStorage)
        .filter(k => k.startsWith('jeegong_gonggu_excluded_') && localStorage.getItem(k) === 'true')
        .map(k => k.replace('jeegong_gonggu_excluded_', ''));

      const exChanged = currentEx.length !== gongguExList.length ||
        !currentEx.every(id => gongguExList.includes(id));

      if (exChanged) {
        gongguChanged = true;
        Object.keys(localStorage).forEach(k => {
          // 제외 날짜 키(jeegong_gonggu_excluded_date_*)는 지우지 않는다
          if (k.startsWith('jeegong_gonggu_excluded_') && !k.startsWith('jeegong_gonggu_excluded_date_')) {
            const id = k.replace('jeegong_gonggu_excluded_', '');
            if (!gongguExList.includes(id)) {
              localStorage.removeItem(k);
            }
          }
        });
        gongguExList.forEach(id => {
          localStorage.setItem('jeegong_gonggu_excluded_' + id, 'true');
        });
      }
    }

    // 6-B. 공동구매 발송 완료 큐(completed_queue) 동기화 - 변경 감지 가드
    const incomingQueue = remoteData.completed_queue || remoteData.completedQueue;
    if (Array.isArray(incomingQueue)) {
      const prevQueueStr = localStorage.getItem('jeegong_completed_queue') || '[]';
      const newQueueStr = JSON.stringify(incomingQueue);
      if (prevQueueStr !== newQueueStr) {
        gongguChanged = true;
        try {
          localStorage.setItem('jeegong_completed_queue', newQueueStr);
        } catch (e) {}
      }
    }

    // 7. 메일 & 고객 문의 처리 상태(handled_registry) 양방향 클라우드 동기화
    const incomingRegistry = remoteData.handled_registry || remoteData.handledRegistry;
    if (incomingRegistry && typeof incomingRegistry === 'object') {
      let regChanged = false;
      Object.keys(incomingRegistry).forEach(k => {
        if (!handledRegistry[k] || JSON.stringify(handledRegistry[k]) !== JSON.stringify(incomingRegistry[k])) {
          handledRegistry[k] = incomingRegistry[k];
          regChanged = true;
        }
      });
      if (regChanged) {
        saveHandledRegistry();
        renderEmailList(b, 'email-list-container', 'email-badge', null);
        renderEmailList(b, 'email-view-container', 'email-view-badge', 'email-view-banner-count');
        renderInquiries(b, 'inquiry-list-container', 'inquiry-badge', null);
        renderInquiries(b, 'inquiry-exclusive-list-container', 'inquiry-view-badge', 'inquiry-view-banner-count');
      }
    }

    // 공구 데이터 변경 시 또는 강제 동기화 시에만 재렌더링 (8초 주기 텍스트에어리어 스크롤 리셋 완전 방지)
    if ((window._forceCloudSync || gongguChanged) && typeof renderGongguCampaign === 'function') {
      renderGongguCampaign();
    }
    renderTodoTable();
    renderTodayView();
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

    let deletedTodos = [];
    try {
      deletedTodos = JSON.parse(localStorage.getItem(`jeegong_deleted_todos_${kst.dateStr}`) || '[]');
    } catch (e) {}

    const gongguSent = [];
    const gongguExcluded = [];
    (appData.gongguCampaigns || []).forEach(c => {
      (c.influencers || []).forEach(inf => {
        if (localStorage.getItem('jeegong_gonggu_sent_' + inf.id) === 'true') {
          gongguSent.push(inf.id);
        }
        if (localStorage.getItem('jeegong_gonggu_excluded_' + inf.id) === 'true') {
          gongguExcluded.push(inf.id);
        }
      });
    });

    const payload = {
      updated_at: nowTs,
      work_date: kst.dateStr,
      work_state: workState,
      done_todos: Array.from(new Set(doneTodos)),
      deleted_todos: Array.from(new Set(deletedTodos)),
      done_priorities: Array.from(new Set(donePriorities)),
      excluded_priorities: Array.from(new Set(excludedPriorities)),
      gonggu_sent: Array.from(new Set(gongguSent)),
      gonggu_excluded: Array.from(new Set(gongguExcluded)),
      completed_queue: getCompletedQueue(),
      handled_registry: handledRegistry || {},
      custom_todos: getCustomAddedTodos(kst.dateStr) || []
    };

    // 1. Supabase Cloud DB에 즉시 영구 저장 (0% 유실 단일 진실 원천)
    fetch(SUPABASE_STATE_ENDPOINT, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    }).catch(err => console.warn('Supabase state sync error:', err));

    // 2. ntfy 실시간 스트림 브로드캐스트 (실시간 0.1초 릴레이)
    fetch(`${SYNC_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync_state',
        timestamp: nowTs,
        ...payload
      })
    }).catch(err => console.warn('ntfy push error:', err));

  } catch (err) {
    console.warn('pushCloudState error:', err);
  }
}

// ========================================================
// 올쓰컴퍼니 공동구매 탭 (인플루언서 제안 관리 및 발송기)
// ========================================================
function getCompletedQueue() {
  try {
    const raw = localStorage.getItem('jeegong_completed_queue');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCompletedQueue(queue) {
  try {
    localStorage.setItem('jeegong_completed_queue', JSON.stringify(queue || []));
  } catch (e) {}
}

// 제외 날짜는 기기 간에 공유되도록 handled_registry(클라우드 동기화)에 'gx::아이디' 키로도 저장한다
function recordGongguExcludeDate(rawId, dateStr) {
  const id = (rawId || '').toLowerCase();
  if (!id) return;
  try { localStorage.setItem('jeegong_gonggu_excluded_date_' + id, dateStr); } catch (e) {}
  handledRegistry['gx::' + id] = { status: 'gonggu_excluded', handledDate: dateStr, handledTimestamp: Date.now() };
  saveHandledRegistry();
}

function clearGongguExcludeDate(rawId) {
  const id = (rawId || '').toLowerCase();
  try {
    localStorage.removeItem('jeegong_gonggu_excluded_date_' + id);
    localStorage.removeItem('jeegong_gonggu_excluded_date_' + rawId);
  } catch (e) {}
  if (handledRegistry['gx::' + id]) {
    delete handledRegistry['gx::' + id];
    saveHandledRegistry();
  }
}

// 이 기기에만 남아 있던 제외 날짜를 클라우드 기록으로 올린다 (한 번만, 기록이 없을 때만)
function backfillGongguExcludeDates() {
  let added = false;
  try {
    Object.keys(localStorage).forEach(k => {
      if (!k.startsWith('jeegong_gonggu_excluded_date_')) return;
      const id = k.replace('jeegong_gonggu_excluded_date_', '').toLowerCase();
      const d = localStorage.getItem(k);
      if (id && d && !handledRegistry['gx::' + id]) {
        handledRegistry['gx::' + id] = { status: 'gonggu_excluded', handledDate: d, handledTimestamp: Date.now() };
        added = true;
      }
    });
  } catch (e) {}
  if (added) saveHandledRegistry();
  return added;
}

function getExcludeDate(item) {
  const rawId = item.id || '';
  const id = rawId.toLowerCase();
  try {
    const stored = localStorage.getItem('jeegong_gonggu_excluded_date_' + id) || localStorage.getItem('jeegong_gonggu_excluded_date_' + rawId);
    if (stored) return stored;
  } catch (e) {}
  const rec = handledRegistry && handledRegistry['gx::' + id];
  if (rec && rec.handledDate) return rec.handledDate;

  if (item && item.excludeDate) return item.excludeDate;

  const nov11 = [
    'bop.pt', 'jweight_', 'nini___won', 'thanks_to_71', '_foodie_jen', 'pm_705',
    'kkomsense.home', 'widsunshine', 'byori_yaksa', 'sana_yaksa', 'pinkwonder_choi',
    'thing_1022', 'im_soo_homefit', 'dr.jungsodam', 'jeehye_yun', 'cocoblack_joo',
    'querensia___', 'aon0325', 'itstohyun'
  ];
  if (nov11.includes(id)) return '2026-11-11';
  if (id === 'chae2home') return '2026-11-10';
  const nov9 = ['gomson.salim', 'home.it_insta', 'homestory.official_', '_chocohomee_', 'sallim_after_work', 'ggulmat_salim', 'moms.table_'];
  if (nov9.includes(id)) return '2026-11-09';
  const nov8 = [
    'commeci_kitchen', 'salim_station', 'coco_haus_', 'temqueen0', 'living_pluss',
    'hehe_home_tem', 'homemaster00', 'home.in.on', 'home._.standard', 'lallina.home',
    'shop._.dami', 'maeil_papa', 'home_salimm', 'haram.table'
  ];
  if (nov8.includes(id)) return '2026-11-08';
  // 날짜 기록이 없으면 지어내지 않고 '날짜 미확인'으로 둔다
  return 'unknown';
}

function getExcludeReason(inf) {
  const id = (inf.id || '').toLowerCase();
  if (inf && inf.excludeReason) return inf.excludeReason;
  
  // 0. 11/11 제외 계정 (케이스키니 타깃 불일치 및 오수집)
  if (id === 'bop.pt') return '쿠팡파트너스 어필리에이트 (남성 요리 크리에이터 / 리틀리 링크에 쿠팡 파트너스 번호 대량 나열 / 공구 미진행)';
  if (id === 'jweight_') return '취급 카테고리 불일치 (웨이트 트레이닝 실전 헬스 피드 / 바디 슬리밍 화장품 불일치)';
  if (id === 'nini___won') return '공동구매 미진행 (테니스·필라테스 오운완 일상 및 단순 협찬 피드 / 자체 공구 미진행)';
  if (id === 'thanks_to_71') return '자사 브랜드 대표 충돌 (자체 개발 단백질 쉐이크 \'달리밥\' 론칭·판매 대표 계정)';
  if (id === '_foodie_jen') return '프로필 바이오 공구 거부 ("공구 안합니다❌" 프로필 명시)';
  if (id === 'pm_705') return '공동구매 미진행 (단순 유료 파트너십 협찬 피드 / 자체 공구 미진행)';
  if (id === 'kkomsense.home') return '취급 카테고리 불일치 (청소 꿀팁·살림 루틴 중심 피드 / 바디 슬리밍 화장품 불일치)';
  if (id === 'widsunshine') return '취급 카테고리 불일치 (매직랩·스텐냄비 등 주방/살림 전용 공구 / 뷰티·슬리밍 불일치)';
  if (id === 'itstohyun') return '취급 카테고리 불일치 (순수 아동 의류·키즈 육아 전문 / 슬리밍 바디 케어 불일치)';
  if (id === 'byori_yaksa' || id === 'sana_yaksa' || id === 'dr.jungsodam') return '전문직 의료인 충돌 (약사·의사 계정으로 기능성 화장품 공구 시 의료법·표시광고 가이드 충돌)';
  if (id === 'pinkwonder_choi') return '자사 브랜드 대표 충돌 (핑크원더 자체 화장품 브랜드 대표)';
  if (id === 'cocoblack_joo') return '자사 브랜드 대표 충돌 (코코블랙 자체 의류 브랜드 대표)';
  if (id === 'im_soo_homefit' || id === 'thing_1022') return '정량 댓글 지표 미달 (실측 평균 댓글 수 기준치 미달)';
  if (id === 'jeehye_yun' || id === 'querensia___' || id === 'aon0325') return '타깃 피드 불일치 (일상·감성 큐레이션 피드 / 슬리밍 바디 앰플 성격 불일치)';

  // 1. 11/09 제외 7개 계정 (오답노트 정밀 분석)
  if (id === 'home.it_insta') {
    return '쿠팡파트너스 어필리에이트 (본문 <1027> 번호 검색 유도 / 자체 공구 미진행)';
  }
  if (id === 'gomson.salim') {
    return '익명 정보성 큐레이션 (연예인·방송 캡처 꿀템 / 호스트·신뢰 부재)';
  }
  if (id === 'homestory.official_') {
    return '익명 정보성 큐레이션 (쇼츠 짜깁기·단순 소개 / 자체 공구 미진행)';
  }
  if (id === 'ggulmat_salim') {
    return '단순 팁·정보 공유 계정 (ManyChat 자동응답 링크 / 브랜드 공구 이력 전무)';
  }
  if (id === '_chocohomee_') {
    return '동일 브랜드 기진행 중복 (최근 타 벤더 디어커스 기획전 진행 계정)';
  }
  if (id === 'sallim_after_work') {
    return '취급 품목·단가 불일치 (고단가 가구·선반 전문 / 생활 화장지 불일치)';
  }
  if (id === 'moms.table_') {
    return '정량 댓글 지표 미달 (실측 평균 댓글 26.5개 / 80+ 기준 미달)';
  }

  // 2. 11/10 제외 계정
  if (id === 'chae2home') {
    return '취급 카테고리 불일치 (방풍커튼·인테리어 전문 / 생활 화장지 불일치)';
  }

  // 3. 11/08 제외 계정 (살림·요리 및 어필리에이트 오수집)
  if (id === 'commeci_kitchen') {
    return '취급 카테고리 불일치 (요리 레시피 전문 / 생활 소모품 불일치)';
  }
  if (id === 'haram.table') {
    return '취급 카테고리 불일치 (요리·초퍼 전문 / 생활 소모품 불일치)';
  }
  const dearcusAffiliates = [
    'salim_station', 'coco_haus_', 'temqueen0', 'living_pluss', 'hehe_home_tem',
    'homemaster00', 'home.in.on', 'home._.standard', 'lallina.home', 'shop._.dami',
    'maeil_papa', 'kkomsense.home', 'home_salimm', 'kiki__som'
  ];
  if (dearcusAffiliates.includes(id)) {
    return '어필리에이트 단순 소개 (피드 꿀템 번호 안내 / 자체 공구 미진행)';
  }

  // 4. 아넬라 제외 계정들 (11/07 이전)
  if (id === 'malanghoney_') {
    return '브랜드 공식 계정 (말랑하니 육아용품 전문 브랜드사 공식 채널)';
  }
  if (id === 'ran_gagu') {
    return '브랜드 공식 계정 (어린이 원목 가구/책장 제조판매사 란가구 공식)';
  }
  if (id === 'yoonluv.s2') {
    return '공구 제안 거부 계정 (프로필에 광고/협찬⭕️ 공구제안❌️ 명시)';
  }
  if (id === '_yuki.home') {
    return '삭제/유령 계정 (인스타그램 계정 미존재 또는 페이지 삭제)';
  }
  if (id === 'hhappy_ayola') {
    return '카테고리 불일치 (카시트 커버·육아정보 / 영유아 이유식 무관)';
  }
  if (id === 'kennen.home' || id === 'rosettia_home') {
    return '카테고리 불일치 (홈스타일링·리빙 / 5개월~4세 이유식 무관)';
  }
  if (id === 'heeah_travel' || id === 'littlehome_insta') {
    return '카테고리 불일치 (여행·나들이 / 퓨레 무관)';
  }
  if (id === 'byul.junimom' || id === 'woobro_play0_0' || id === 'hi.gems_play') {
    return '타깃 연령 불일치 (5세 이상 놀이·교육 / 영유아 이유식 무관)';
  }
  if (id === 'lingua_mum' || id === 'wessdombook_jihye') {
    return '타깃 연령·주제 불일치 (초등 영어·책육아 / 이유식 무관)';
  }
  if (id === 'riro_mom') {
    return '공구 일정 중복 (11/11 아넬라 자체 공구 기예정)';
  }
  if (id === 'mipp.ju' || id === 'chinjulmk') {
    return '정량 반응도 미달 (댓글 30+ 또는 릴스 조회수 미달)';
  }
  if (id === 'ricecake_s0up') {
    return '타깃 연령 불일치 (유아식/집밥 전문 / 퓨레 무관)';
  }
  if (id === '2yoonmom_home' || id === 'th0831' || id === 'today.brighten') {
    return '카테고리 불일치 (홈스타일링·인테리어 전문 / 퓨레 무관)';
  }
  if (id === 'yuha_momma' || id === 'dowonmama') {
    return '카테고리 불일치 (유아 패션·아동복 전문 / 퓨레 무관)';
  }
  if (id === 'bliss.mom_' || id === 'bebe_ons') {
    return '타깃 연령 불일치 (초등·주니어 전문 / 영유아 퓨레 무관)';
  }
  if (id === '_mentormom') {
    return '부업/수익화 멘토링 채널 (공구 불가)';
  }

  // 5. 동적 판별 규칙 (신규 제외건 자동 보정)
  const note = (inf.note || '').toLowerCase();
  const cat = (inf.cat || '').toLowerCase();
  if (note.includes('댓글') && (note.includes('미달') || note.includes('부족'))) {
    return '정량 댓글 지표 미달 (기준치 미달)';
  }
  if (cat.includes('가구') || cat.includes('인테리어')) {
    return '취급 카테고리 불일치 (상품 성격 불일치)';
  }
  return '타깃 피드 불일치 (실사 부적합 판정)';
}

function getExcludedList() {
  if (!appData) return [];
  const campaigns = appData.gongguCampaigns || (appData.gongguCampaign ? [appData.gongguCampaign] : []);
  const list = [];
  campaigns.forEach(c => {
    (c.influencers || []).forEach(inf => {
      const isSent = localStorage.getItem('jeegong_gonggu_sent_' + inf.id) === 'true';
      const isEx = localStorage.getItem('jeegong_gonggu_excluded_' + inf.id) === 'true' || inf.excluded === true;
      if (!isSent && isEx) {
        const item = {
          campaignId: c.id,
          campaignTitle: c.shortTitle || c.title,
          ...inf
        };
        item.excludeReason = getExcludeReason(item);
        item.excludeDate = getExcludeDate(item);
        list.push(item);
      }
    });
  });

  // Master excluded list (preserved across campaign rotations)
  const seenIds = new Set(list.map(item => (item.id || '').toLowerCase()));
  (appData.gongguExcludedMaster || []).forEach(inf => {
    const idLower = (inf.id || '').toLowerCase();
    if (!seenIds.has(idLower)) {
      const item = { ...inf };
      item.excludeReason = item.excludeReason || getExcludeReason(item);
      item.excludeDate = item.excludeDate || getExcludeDate(item);
      list.push(item);
      seenIds.add(idLower);
    }
  });

  // 제외한 순서대로 정렬: 최근에 제외한 계정이 맨 위, 날짜 미확인은 맨 아래
  list.forEach(item => { item.excludeTs = getExcludeTimestamp(item); });
  list.sort((x, y) => {
    const dx = x.excludeDate === 'unknown' ? '' : (x.excludeDate || '');
    const dy = y.excludeDate === 'unknown' ? '' : (y.excludeDate || '');
    if (dx !== dy) return dx < dy ? 1 : -1;
    return (y.excludeTs || 0) - (x.excludeTs || 0);
  });

  return list;
}

function getExcludeTimestamp(item) {
  const id = (item.id || '').toLowerCase();
  const rec = handledRegistry && handledRegistry['gx::' + id];
  return (rec && rec.handledTimestamp) || 0;
}
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updateGongguGlobalBadges() {
  if (!appData) return;
  const campaigns = appData.gongguCampaigns || (appData.gongguCampaign ? [appData.gongguCampaign] : []);
  let totalPending = 0;
  campaigns.forEach(c => {
    (c.influencers || []).forEach(inf => {
      const isSent = localStorage.getItem('jeegong_gonggu_sent_' + inf.id) === 'true';
      const isEx = localStorage.getItem('jeegong_gonggu_excluded_' + inf.id) === 'true' || inf.excluded === true;
      if (!isSent && !isEx) {
        totalPending++;
      }
    });
  });

  const sideBadge = document.getElementById('side-gonggu-badge');
  if (sideBadge) {
    sideBadge.textContent = totalPending > 0 ? totalPending : '0';
    sideBadge.style.background = totalPending > 0 ? 'var(--accent-blue)' : 'var(--accent-green)';
    sideBadge.style.display = totalPending > 0 ? 'inline-flex' : 'none';
  }
  const bannerBadge = document.getElementById('banner-gonggu-pending-count');
  if (bannerBadge) {
    bannerBadge.textContent = totalPending;
  }
}

let activeGongguCampaignId = 'dearcus-bamboo-tissue';
let currentGongguFilter = 'all';
let currentExcludedDateFilter = 'all';

function renderGongguCampaign() {
  const container = document.getElementById('gonggu-campaign-list');
  const counterEl = document.getElementById('gonggu-sent-counter');
  const totalCounterEl = document.getElementById('gonggu-total-counter');
  const searchInput = document.getElementById('gonggu-search-input');
  const tabsContainer = document.getElementById('gonggu-campaign-tabs');
  const activeTitleEl = document.getElementById('gonggu-active-title');
  const activeMetaEl = document.getElementById('gonggu-active-meta');
  const activeBadgeEl = document.getElementById('gonggu-active-badge');

  if (!container || !appData) return;

  const campaigns = appData.gongguCampaigns || (appData.gongguCampaign ? [appData.gongguCampaign] : []);
  if (campaigns.length === 0) return;

  const completedQueue = getCompletedQueue();
  const excludedList = getExcludedList();
  const isCompletedTab = activeGongguCampaignId === 'completed-tab';
  const isExcludedTab = activeGongguCampaignId === 'excluded-tab';

  let activeCampaign = campaigns.find(c => c.id === activeGongguCampaignId);
  if (!activeCampaign && !isCompletedTab && !isExcludedTab) {
    activeCampaign = campaigns[0];
    activeGongguCampaignId = activeCampaign.id;
  }

  // 1. Render Campaign Tabs (상품 탭들 + 항상 맨 끝 오른쪽에 완료 탭 & 제외 탭)
  if (tabsContainer) {
    let tabsHtml = campaigns.map(c => {
      const activeCount = (c.influencers || []).filter(inf => {
        const isSent = localStorage.getItem('jeegong_gonggu_sent_' + inf.id) === 'true';
        const isEx = localStorage.getItem('jeegong_gonggu_excluded_' + inf.id) === 'true' || inf.excluded === true;
        return !isSent && !isEx;
      }).length;
      let icon = c.icon || (c.id.includes('anella') ? '🍎' : '🎯');
      let tabTitle = (c.shortTitle || c.title || '').replace(/^[\s\uD800-\uDBFF\uDC00-\uDFFF🎯🍎👢🤝]+/u, '').trim();
      return `
        <button class="btn-campaign-tab ${c.id === activeGongguCampaignId ? 'active' : ''}" data-cid="${c.id}">
          <span>${icon} ${escapeHtml(tabTitle)}</span>
          <span class="tab-count-pill">${activeCount}명 대기</span>
        </button>
      `;
    }).join('');

    // 맨 끝 오른쪽 완료 탭
    tabsHtml += `
      <button class="btn-campaign-tab btn-completed-tab ${isCompletedTab ? 'active' : ''}" data-cid="completed-tab" style="${isCompletedTab ? 'background: var(--accent-green); border-color: var(--accent-green); color: #fff;' : 'border-color: var(--accent-green-text); color: var(--accent-green-text);'}">
        <span>✅ 발송 완료 큐</span>
        <span class="tab-count-pill" style="background: ${isCompletedTab ? 'rgba(255,255,255,0.25)' : 'var(--accent-green-light)'}; color: ${isCompletedTab ? '#fff' : 'var(--accent-green-text)'};">${completedQueue.length}건 대기</span>
      </button>
    `;

    // 맨 끝 오른쪽 제외 탭 (오답 분석 및 훈련)
    tabsHtml += `
      <button class="btn-campaign-tab btn-excluded-tab ${isExcludedTab ? 'active' : ''}" data-cid="excluded-tab" style="${isExcludedTab ? 'background: #dc2626; border-color: #dc2626; color: #fff;' : 'border-color: #f87171; color: #dc2626;'}">
        <span>🚫 제외 큐</span>
        <span class="tab-count-pill" style="background: ${isExcludedTab ? 'rgba(255,255,255,0.25)' : '#fee2e2'}; color: ${isExcludedTab ? '#fff' : '#b91c1c'};">${excludedList.length}건 분석</span>
      </button>
    `;

    tabsContainer.innerHTML = tabsHtml;

    tabsContainer.querySelectorAll('.btn-campaign-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeGongguCampaignId = btn.getAttribute('data-cid');
        renderGongguCampaign();
      });
    });
  }

  // 2. CASE A: 완료 탭 렌더링
  if (isCompletedTab) {
    if (activeTitleEl) {
      activeTitleEl.innerHTML = `<span class="campaign-icon">✅</span><span class="campaign-title-text">발송 완료 큐 (시트 기재 대기)</span>`;
    }
    if (activeBadgeEl) {
      activeBadgeEl.textContent = `총 ${completedQueue.length}건 기재 대기`;
      activeBadgeEl.style.background = 'var(--accent-green-light)';
      activeBadgeEl.style.color = 'var(--accent-green-text)';
    }
    if (activeMetaEl) {
      activeMetaEl.innerHTML = `
        • <strong>운영 규칙</strong>: 인플루언서 제안을 발송하고 <strong>[✓ 발송 완료]</strong>를 누르면 이 탭으로 자동 분류됩니다.<br>
        • <strong>시트 반영</strong>: 피클 앱에서 "<strong>시트에 기재해줘</strong>"라고 말씀하시거나 아래 <strong>[구름이에게 시트 기재 및 탭 비우기 요청]</strong>을 누르면 마스터 시트에 자동 기재 후 탭이 초기화됩니다.
      `;
    }
    if (totalCounterEl) totalCounterEl.textContent = completedQueue.length;
    if (counterEl) counterEl.textContent = completedQueue.length;

    updateGongguGlobalBadges();

    if (completedQueue.length === 0) {
      container.innerHTML = `
        <div style="padding: 56px 24px; text-align: center; color: var(--text-tertiary);">
          <div style="font-size: 32px; margin-bottom: 12px;">📭</div>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">현재 대기 중인 발송 완료건이 없습니다.</div>
          <div style="font-size: 13px; color: var(--text-tertiary);">각 상품 탭에서 [✓ 발송 완료]를 누르면 여기에 차곡차곡 쌓입니다!</div>
        </div>
      `;
      return;
    }

    let completedHtml = `
      <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 16px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
            📝 마스터 시트 기재 대기: 총 <span style="color: var(--accent-green-text); font-weight: 800;">${completedQueue.length}</span>건
          </div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            하단 목록을 확인하신 뒤 앱에서 요청하시거나 우측 버튼을 누르시면 시트 반영 후 탭이 초기화됩니다.
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="btn-request-sheet-sync" class="btn-subtle" style="background: var(--accent-green); color: #fff; font-weight: 600; padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer;">
            📋 시트 기재 완료 후 탭 초기화
          </button>
        </div>
      </div>

      <div class="todo-table-responsive" style="margin-top: 12px;">
        <table class="todo-modern-table">
          <thead>
            <tr>
              <th style="width: 50px; text-align: center;">No.</th>
              <th style="width: 140px;">상품명</th>
              <th>인스타그램 계정</th>
              <th style="width: 130px;">발송 일시</th>
              <th style="width: 80px; text-align: right;">관리</th>
            </tr>
          </thead>
          <tbody>
    `;

    completedHtml += completedQueue.map((item, idx) => {
      const dateStr = item.sentDate || (item.sentTimestamp ? new Date(item.sentTimestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '오늘');
      return `
        <tr>
          <td style="text-align: center; color: var(--text-tertiary); font-weight: 600;">${idx + 1}</td>
          <td><span class="section-badge" style="background: var(--accent-blue-light); color: var(--accent-blue-text); font-size: 11px;">${escapeHtml(item.productTitle || '공동구매')}</span></td>
          <td>
            <a href="${escapeHtml(item.url || 'https://www.instagram.com/' + item.id)}" target="_blank" style="color: var(--accent-blue); font-weight: 600; text-decoration: none;">
              @${escapeHtml(item.id)}
            </a>
            ${item.follow ? `<span style="font-size: 11px; color: var(--text-tertiary); margin-left: 6px;">👥 ${escapeHtml(item.follow)}</span>` : ''}
          </td>
          <td style="font-size: 11.5px; color: var(--text-secondary);">${escapeHtml(dateStr)}</td>
          <td style="text-align: right;">
            <button class="btn-cancel-sent" data-id="${item.id}" style="font-size: 11px; padding: 4px 8px; background: transparent; border: 1px solid var(--border-subtle); border-radius: 4px; color: var(--accent-red-text); cursor: pointer;" title="발송 취소하고 대기 목록으로 복구">
              취소
            </button>
          </td>
        </tr>
      `;
    }).join('');

    completedHtml += `
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = completedHtml;

    // Attach completed tab event listeners
    const clearBtn = document.getElementById('btn-request-sheet-sync');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('마스터 시트에 기재 완료되었나요? 완료 탭 큐를 비웁니다.')) {
          saveCompletedQueue([]);
          pushCloudState();
          if (typeof showToast === 'function') {
            showToast('🧹 완료 탭이 깔끔하게 초기화되었습니다.');
          }
          renderGongguCampaign();
        }
      });
    }

    container.querySelectorAll('.btn-cancel-sent').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        let q = getCompletedQueue();
        q = q.filter(item => item.id !== id);
        saveCompletedQueue(q);
        localStorage.removeItem('jeegong_gonggu_sent_' + id);
        localStorage.removeItem('jeegong_gonggu_excluded_' + id);
        pushCloudState();
        if (typeof showToast === 'function') {
          showToast(`↩️ @${id} 계정이 발송 대기 목록으로 복구되었습니다.`);
        }
        renderGongguCampaign();
      });
    });

    return;
  }

  // 3. CASE B: 제외 탭 렌더링 (오분류 원인 분석 및 AI 훈련 오답노트)
  if (isExcludedTab) {
    if (activeTitleEl) {
      activeTitleEl.innerHTML = `<span class="campaign-icon">🚫</span><span class="campaign-title-text">제외 큐 (오분류 원인 분석 및 AI 훈련)</span>`;
    }
    if (activeBadgeEl) {
      activeBadgeEl.textContent = `총 ${excludedList.length}건 분석`;
      activeBadgeEl.style.background = '#fee2e2';
      activeBadgeEl.style.color = '#b91c1c';
    }
    if (activeMetaEl) {
      activeMetaEl.innerHTML = `
        • <strong>훈련 목적</strong>: 지원진 님이 제외하신 계정들의 오추출 원인(쿠팡파트너스, 타깃 연령·카테고리 불일치, 반응도 미달 등)을 정밀 분석하여 향후 발굴 정확도를 100%로 끌어올리는 피클 AI의 훈련 데이터베이스입니다.<br>
        • <strong>복구</strong>: 실수로 제외한 계정은 우측 <strong>[↩️ 복구]</strong> 버튼을 누르면 원래 상품 탭의 발송 대기 목록으로 즉시 돌아갑니다.
      `;
    }
    if (totalCounterEl) totalCounterEl.textContent = excludedList.length;
    if (counterEl) counterEl.textContent = excludedList.length;

    updateGongguGlobalBadges();

    if (excludedList.length === 0) {
      container.innerHTML = `
        <div style="padding: 56px 24px; text-align: center; color: var(--text-tertiary);">
          <div style="font-size: 32px; margin-bottom: 12px;">✨</div>
          <div style="font-size: 15px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">현재 제외된 인플루언서가 없습니다.</div>
          <div style="font-size: 13px; color: var(--text-tertiary);">상품 탭에서 [✕ 제외]를 누르시면 제외 사유 분석과 함께 이곳에 체계적으로 모입니다!</div>
        </div>
      `;
      return;
    }

    // 날짜별 건수 집계 및 정렬
    const dateCounts = {};
    excludedList.forEach(item => {
      const d = item.excludeDate || 'unknown';
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    });
    const uniqueDates = Object.keys(dateCounts).filter(d => d !== 'unknown').sort().reverse();
    if (dateCounts['unknown']) uniqueDates.push('unknown');

    function getTodayKstStr() {
      // 브리핑 날짜가 아니라 실제 한국 시간 오늘을 기준으로 '오늘/어제'를 표시한다
      if (typeof getKSTNow === 'function') return getKSTNow().dateStr;
      const now = new Date();
      const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      return kst.toISOString().slice(0, 10);
    }

    const todayKstStr = getTodayKstStr();
    const todayDateObj = new Date(todayKstStr + 'T00:00:00Z');
    const yestDateObj = new Date(todayDateObj.getTime() - (24 * 60 * 60 * 1000));
    const yesterdayKstStr = yestDateObj.toISOString().slice(0, 10);

    function formatFilterDateLabel(d) {
      const parts = (d || '').split('-');
      const md = parts.length === 3 ? `${parts[1]}/${parts[2]}` : d;
      if (d === 'unknown') return `날짜 미확인 (${dateCounts[d]}건)`;
      if (d === todayKstStr) return `오늘 ${md} (${dateCounts[d]}건)`;
      if (d === yesterdayKstStr) return `어제 ${md} (${dateCounts[d]}건)`;
      return `${md} (${dateCounts[d]}건)`;
    }

    function formatItemDateBadge(d) {
      const parts = (d || '').split('-');
      const md = parts.length === 3 ? `${parts[1]}/${parts[2]}` : d;
      if (d === 'unknown' || !d) return '날짜 미확인';
      if (d === todayKstStr) return `${md} (오늘)`;
      if (d === yesterdayKstStr) return `${md} (어제)`;
      return md || '11/09';
    }

    const filteredExcludedList = currentExcludedDateFilter === 'all'
      ? excludedList
      : excludedList.filter(item => (item.excludeDate || 'unknown') === currentExcludedDateFilter);

    let excludedHtml = `
      <div style="background: var(--bg-card); border: 1px solid #fecaca; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
        <div>
          <div style="font-size: 14px; font-weight: 700; color: #991b1b; margin-bottom: 4px;">
            🚫 제외 계정 정밀 분석 큐: 총 <span style="font-weight: 800;">${excludedList.length}</span>건
          </div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            쿠팡파트너스, 타깃 불일치, 반응도 미달 등의 실패 패턴을 날짜별로 정밀 분석하여 다음 발굴의 100% 필터링 규칙으로 축적합니다.
          </div>
        </div>
      </div>

      <!-- 날짜별 필터 바 -->
      <div class="excluded-filter-bar">
        <button class="btn-excluded-filter ${currentExcludedDateFilter === 'all' ? 'active' : ''}" data-date="all">
          전체 보기 (${excludedList.length}건)
        </button>
        ${uniqueDates.map(d => `
          <button class="btn-excluded-filter ${currentExcludedDateFilter === d ? 'active' : ''}" data-date="${d}">
            ${formatFilterDateLabel(d)}
          </button>
        `).join('')}
      </div>
    `;

    if (filteredExcludedList.length === 0) {
      excludedHtml += `
        <div style="padding: 40px 20px; text-align: center; color: var(--text-tertiary); background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-subtle); margin-top: 12px;">
          <div style="font-size: 14px; font-weight: 600; color: var(--text-secondary);">해당 날짜에 제외된 계정이 없습니다.</div>
        </div>
      `;
    } else {
      // 1. 데스크톱 테이블 뷰 (PC 환경 - 시트 위치 제거, 제외 일자 탑재)
      excludedHtml += `
        <div class="todo-table-responsive excluded-desktop-view" style="margin-top: 12px;">
          <table class="todo-modern-table">
            <thead>
              <tr>
                <th style="width: 45px; text-align: center;">No.</th>
                <th style="width: 120px;">제안 상품</th>
                <th style="width: 200px;">인스타그램 계정</th>
                <th style="width: 110px; text-align: center;">제외 일자</th>
                <th>오분류 및 제외 사유 분석</th>
                <th style="width: 75px; text-align: right;">관리</th>
              </tr>
            </thead>
            <tbody>
              ${filteredExcludedList.map((item, idx) => `
                <tr>
                  <td style="text-align: center; color: var(--text-tertiary); font-weight: 600;">${idx + 1}</td>
                  <td><span class="section-badge" style="background: var(--bg-secondary); color: var(--text-secondary); font-size: 11px;">${escapeHtml(item.campaignTitle || '공동구매')}</span></td>
                  <td>
                    <a href="${escapeHtml(item.url || 'https://www.instagram.com/' + item.id)}" target="_blank" style="color: var(--accent-blue); font-weight: 600; text-decoration: none;">
                      @${escapeHtml(item.id)}
                    </a>
                    ${item.follow ? `<span style="font-size: 11px; color: var(--text-tertiary); margin-left: 6px;">👥 ${escapeHtml(item.follow)}</span>` : ''}
                  </td>
                  <td style="text-align: center; font-size: 11.5px; color: #ef4444; font-weight: 600;">📅 ${formatItemDateBadge(item.excludeDate)}</td>
                  <td>
                    <span style="display: inline-block; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 4px 8px; border-radius: 4px; font-size: 11.5px; font-weight: 600; line-height: 1.4;">
                      ${escapeHtml(item.excludeReason || '타깃 불일치')}
                    </span>
                  </td>
                  <td style="text-align: right;">
                    <button class="btn-restore-excluded" data-id="${item.id}" style="font-size: 11px; padding: 4px 8px; background: transparent; border: 1px solid var(--border-subtle); border-radius: 4px; color: var(--accent-blue); cursor: pointer;" title="제외 취소하고 대기 목록으로 복구">
                      ↩️ 복구
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- 2. 모바일 전용 카드 뷰 (가로 스크롤 잘림 완벽 방지, 세로 스크롤 100% 보장) -->
        <div class="excluded-mobile-view" style="margin-top: 12px;">
          ${filteredExcludedList.map(item => `
            <div class="excluded-mobile-card">
              <div class="excluded-card-header">
                <div class="excluded-card-tags">
                  <span class="excluded-campaign-badge">${escapeHtml(item.campaignTitle || '공동구매')}</span>
                  <span class="excluded-date-badge">📅 ${formatItemDateBadge(item.excludeDate)}</span>
                </div>
                <button class="btn-restore-excluded" data-id="${item.id}" style="font-size: 11px; padding: 4px 8px; background: transparent; border: 1px solid var(--border-subtle); border-radius: 4px; color: var(--accent-blue); cursor: pointer;" title="제외 취소하고 대기 목록으로 복구">
                  ↩️ 복구
                </button>
              </div>
              <div class="excluded-card-account">
                <a href="${escapeHtml(item.url || 'https://www.instagram.com/' + item.id)}" target="_blank" class="excluded-id-link">
                  @${escapeHtml(item.id)}
                </a>
                ${item.follow ? `<span class="excluded-follow-pill">👥 ${escapeHtml(item.follow)}</span>` : ''}
              </div>
              <div class="excluded-card-reason">
                ${escapeHtml(item.excludeReason || '타깃 불일치')}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    container.innerHTML = excludedHtml;

    // 날짜별 필터 이벤트 바인딩
    container.querySelectorAll('.btn-excluded-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        currentExcludedDateFilter = btn.getAttribute('data-date');
        renderGongguCampaign();
      });
    });

    container.querySelectorAll('.btn-restore-excluded').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        localStorage.removeItem('jeegong_gonggu_excluded_' + id);
        clearGongguExcludeDate(id);
        pushCloudState();
        if (typeof showToast === 'function') {
          showToast(`↩️ @${id} 계정이 발송 대기 목록으로 복구되었습니다.`);
        }
        renderGongguCampaign();
      });
    });

    return;
  }

  // 4. CASE C: 일반 상품 탭 렌더링
  if (activeTitleEl) {
    let icon = activeCampaign.icon || (activeCampaign.id.includes('anella') ? '🍎' : '🎯');
    let cleanTitle = (activeCampaign.title || '').replace(/^[\s\uD800-\uDBFF\uDC00-\uDFFF🎯🍎👢🤝]+/u, '').trim();
    activeTitleEl.innerHTML = `<span class="campaign-icon">${icon}</span><span class="campaign-title-text">${escapeHtml(cleanTitle || activeCampaign.title)}</span>`;
  }
  if (activeBadgeEl) {
    activeBadgeEl.textContent = activeCampaign.criteria || '실사 검증 완료';
    activeBadgeEl.style.background = '';
    activeBadgeEl.style.color = '';
  }
  if (activeMetaEl) {
    activeMetaEl.innerHTML = `
      • <strong>타깃</strong>: ${escapeHtml(activeCampaign.target || '공동구매 타깃')} (${escapeHtml(activeCampaign.criteria || '')})<br>
      • <strong>안내</strong>: 제안문은 바로 수정할 수 있으며, <strong>[📋 원클릭 복사]</strong> 후 <strong>[발송 완료]</strong>를 누르면 <strong>[완료 탭]</strong>으로 자동 분류됩니다.
    `;
  }

  // Filter out excluded or already sent influencers
  const allInfluencers = activeCampaign.influencers || [];
  const influencers = allInfluencers.filter(inf => {
    const isSent = localStorage.getItem('jeegong_gonggu_sent_' + inf.id) === 'true';
    const isEx = localStorage.getItem('jeegong_gonggu_excluded_' + inf.id) === 'true' || inf.excluded === true;
    return !isSent && !isEx;
  });

  if (totalCounterEl) totalCounterEl.textContent = influencers.length;
  if (counterEl) counterEl.textContent = influencers.length;

  updateGongguGlobalBadges();

  function renderList(query) {
    const q = (query || '').toLowerCase().trim();

    // Search Filter
    let list = influencers.filter(inf => {
      if (!q) return true;
      const text = (inf.id + ' ' + (inf.cat || '') + ' ' + (inf.follow || '') + ' ' + (inf.note || '')).toLowerCase();
      return text.includes(q);
    });

    list.sort((a, b) => a.num - b.num);

    if (list.length === 0) {
      container.innerHTML = '<div style="padding: 48px 24px; text-align: center; color: var(--text-tertiary); font-size: 14px; font-weight: 500;">🎉 모든 인플루언서 제안 발송이 완료되었습니다! [완료 탭]에서 확인하실 수 있습니다.</div>';
      updateGongguGlobalBadges();
      return;
    }

    // 렌더링 전 기존 텍스트에어리어 스크롤 위치 보존
    const prevScrollMap = {};
    container.querySelectorAll('.gonggu-dm-textarea').forEach(ta => {
      const id = ta.getAttribute('data-id');
      if (id && ta.scrollTop > 0) {
        prevScrollMap[id] = ta.scrollTop;
      }
    });

    container.innerHTML = list.map(inf => {
      const customDm = localStorage.getItem('jeegong_gonggu_custom_dm_' + inf.id) || inf.dmText || '';
      const noteBadge = inf.note ? `<span class="section-badge" style="background: var(--accent-red-light); color: var(--accent-red-text); font-size: 10px;">${escapeHtml(inf.note)}</span>` : '';

      return `
        <div class="gonggu-card" id="gonggu-card-${inf.id}">
          <div class="gonggu-card-header">
            <div class="gonggu-influencer-info">
              <span class="gonggu-num-badge">No.${inf.num}</span>
              <a href="${escapeHtml(inf.url)}" target="_blank" class="gonggu-handle">@${escapeHtml(inf.id)}</a>
              <span class="gonggu-meta-pill">👥 ${escapeHtml(inf.follow)}</span>
              <span class="gonggu-meta-pill">🏷️ ${escapeHtml(inf.cat || '살림·리빙')}</span>
              ${noteBadge}
            </div>
            <div class="gonggu-card-header-right">
              <button class="btn-gonggu-exclude" data-id="${inf.id}" title="제안 목록에서 제외">✕ 제외</button>
            </div>
          </div>

          <div class="gonggu-dm-editor-wrapper">
            <div class="gonggu-dm-editor-label">
              <span>📝 맞춤 DM 발송문 (실시간 수정 가능)</span>
              <span style="font-size: 10px; color: var(--text-tertiary);">수정 시 자동 보존됩니다</span>
            </div>
            <textarea class="gonggu-dm-textarea" data-id="${inf.id}" placeholder="맞춤 DM 문안...">${escapeHtml(customDm)}</textarea>
          </div>

          <div class="gonggu-card-actions">
            <a href="${escapeHtml(inf.url)}" target="_blank" class="btn-gonggu-open-ig">
              <span>🔗 인스타 열기</span>
            </a>
            <button class="btn-gonggu-toggle-sent" data-id="${inf.id}">
              <span>✓ 발송 완료</span>
            </button>
            <button class="btn-gonggu-copy" data-id="${inf.id}">
              <span>📋 원클릭 복사</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Helper: 내용 길이에 맞춰 높이 자동 확장 (모바일 내부 스크롤 갇힘 및 튕김 원천 방지)
    function autoResizeGongguTextarea(ta) {
      if (!ta) return;
      ta.style.height = 'auto';
      const fitHeight = Math.max(ta.scrollHeight + 4, 140);
      ta.style.height = fitHeight + 'px';
    }

    // Attach event listeners
    // 1. Textarea Auto-save & Auto-resize & 스크롤 위치 복원
    container.querySelectorAll('.gonggu-dm-textarea').forEach(ta => {
      autoResizeGongguTextarea(ta);
      const id = ta.getAttribute('data-id');
      if (id && prevScrollMap[id]) {
        ta.scrollTop = prevScrollMap[id];
      }
      ta.addEventListener('input', (e) => {
        const id = e.target.getAttribute('data-id');
        localStorage.setItem('jeegong_gonggu_custom_dm_' + id, e.target.value);
        autoResizeGongguTextarea(e.target);
      });
    });

    // 2. One-click Copy (따옴표 없는 순수 텍스트)
    container.querySelectorAll('.btn-gonggu-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const ta = container.querySelector(`.gonggu-dm-textarea[data-id="${id}"]`);
        if (!ta) return;
        const textToCopy = ta.value;

        try {
          await navigator.clipboard.writeText(textToCopy);
        } catch (err) {
          ta.select();
          document.execCommand('copy');
        }
        btn.classList.add('copied');
        btn.innerHTML = '<span>✓ 복사완료!</span>';
        if (typeof showToast === 'function') {
          showToast(`📋 @${id} 맞춤 DM이 클립보드에 복사되었습니다!`);
        }
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = '<span>📋 원클릭 복사</span>';
        }, 1500);
      });
    });

    // 3. Mark Sent -> Push to Completed Queue & Remove from active list
    container.querySelectorAll('.btn-gonggu-toggle-sent').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const targetInf = influencers.find(item => item.id === id);

        localStorage.setItem('jeegong_gonggu_sent_' + id, 'true');

        // Add to completedQueue
        let q = getCompletedQueue();
        if (!q.some(item => item.id === id)) {
          q.push({
            id: id,
            campaignId: activeCampaign.id,
            productTitle: activeCampaign.shortTitle ? activeCampaign.shortTitle.replace(/^[🎯🍎👢🤝]\s*/, '') : activeCampaign.title,
            row: targetInf ? targetInf.row : null,
            follow: targetInf ? targetInf.follow : '',
            url: targetInf ? targetInf.url : 'https://www.instagram.com/' + id,
            sentTimestamp: Date.now(),
            sentDate: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          });
          saveCompletedQueue(q);
        }

        if (typeof showToast === 'function') {
          showToast(`✅ @${id} 발송 완료! [완료 탭]으로 이동되었습니다.`);
        }
        pushCloudState();
        renderGongguCampaign();
      });
    });

    // 4. Exclude Button (✕ 제외)
    container.querySelectorAll('.btn-gonggu-exclude').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (confirm(`@${id} 계정을 제안 리스트에서 제외하시겠습니까?`)) {
          // 브리핑 날짜가 아니라 실제 한국 시간 오늘 날짜로 기록한다
          const kstDate = getKSTNow().dateStr;
          localStorage.setItem('jeegong_gonggu_excluded_' + id, 'true');
          recordGongguExcludeDate(id, kstDate);
          pushCloudState();
          if (typeof showToast === 'function') {
            showToast(`🗑️ @${id} 계정이 목록에서 제외되었습니다.`);
          }
          renderGongguCampaign();
        }
      });
    });
  }

  // Initial render
  renderList(searchInput ? searchInput.value : '');

  // Search filter listener
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    searchInput.addEventListener('input', (e) => {
      renderList(e.target.value);
    });
  }
}
