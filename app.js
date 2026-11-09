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
}

// Weekly Google Calendar State
window.currentCalWeekOffset = 0;

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
  
  const days = getWeekDateRange(window.currentCalWeekOffset);
  const startDay = days[0];
  const endDay = days[6];
  
  const rangeStr = `${startDay.month}월 ${startDay.dayNum}일~${endDay.month === startDay.month ? '' : endDay.month + '월 '}${endDay.dayNum}일`;
  const rangeTextEl = document.getElementById('cal-week-range-text');
  if (rangeTextEl) rangeTextEl.textContent = rangeStr;
  const fullRangeTextEl = document.getElementById('cal-full-range-text');
  if (fullRangeTextEl) fullRangeTextEl.textContent = rangeStr;

  const calBannerCount = document.getElementById('calendar-view-banner-count');
  if (calBannerCount) calBannerCount.textContent = `${events.length}건`;
  const calAgendaBadge = document.getElementById('calendar-agenda-badge');
  if (calAgendaBadge) calAgendaBadge.textContent = `${events.length}개 일정`;

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
      
      if (dayEvents.length === 0) {
        eventsHtml = `<div style="font-size: 11px; color: var(--text-tertiary); text-align: center; margin-top: 24px;">-</div>`;
      }
      
      html += `
        <div class="day-column ${day.isToday ? 'is-today' : ''}">
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
    if (events.length === 0) {
      agendaContainer.innerHTML = '<div class="empty-state">이번 주 예정된 구글 캘린더 일정이 없습니다.</div>';
    } else {
      events.forEach(ev => {
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
    const weekEventsCount = b.calendarEvents ? b.calendarEvents.length : (b.calendar ? b.calendar.count : 0);
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
            <span>✍️ 구름이 답장 초안 (수정 후 승인 시 발송)</span>
            <span style="font-size: 11.5px; color: var(--text-tertiary);">수신: ${mail.from}</span>
          </div>
          <textarea class="draft-textarea" id="draft-text-${containerId}-${mail.id}" oninput="onDraftInput('${mail.id}', this.value)">${mail.draft || ''}</textarea>
          <div class="draft-actions">
            <button class="btn-secondary" onclick="closeProcessDraft('${containerId}-${mail.id}')" style="padding: 6px 14px; font-size: 12px;">닫기</button>
            <button class="btn-approve-send" onclick="approveAndSendEmail('${mail.id}')" style="padding: 7px 16px; font-size: 12.5px;">
              <span>승인 및 메일 발송</span>
              <span>✈️</span>
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
            <span>✍️ 구름이 고객 응대 초안 (수정 후 승인 시 답변 발송)</span>
            <span style="font-size: 11.5px; color: var(--text-tertiary);">수신: ${sender}</span>
          </div>
          <textarea class="draft-textarea" id="inquiry-draft-text-${containerId}-${inq.id}" oninput="onInquiryDraftInput('${inq.id}', this.value)">${inq.draft || ''}</textarea>
          <div class="draft-actions">
            <button class="btn-secondary" onclick="closeInquiryProcessDraft('${containerId}-${inq.id}')" style="padding: 6px 14px; font-size: 12px;">닫기</button>
            <button class="btn-approve-send" onclick="approveAndSendInquiry('${inq.id}', '${containerId}-${inq.id}')" style="padding: 7px 16px; font-size: 12.5px;">
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

  const account = inq.account || (inq.channel && inq.channel.includes('네이버') ? 'dnjsrns123@naver.com' : 'onsessdesign@gmail.com');
  const isNaver = account.includes('naver') || (inq.channel && inq.channel.includes('네이버'));
  const service = isNaver ? 'naver' : 'gmail';

  try {
    const sendPayload = {
      action: 'send_email',
      timestamp: Date.now(),
      emailId: inq.id,
      service: service,
      account: account,
      recipient: inq.email || inq.from,
      subject: inq.subject,
      body: inq.draft,
      draftId: inq.draftId || '',
      draftFile: inq.draftFile || (isNaver ? 'drafts/RE: [공구 제안] 100% 생과일 아넬라 퓨레, 공구 협업 제안드립니다.│올쓰컴퍼니-3.eml' : '')
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

  pushCloudState();
  showToast(`[답변 발송 요청 완료] ${service === 'naver' ? '네이버 메일' : 'Gmail'}을 통해 발송 큐가 전송되었습니다! 🚀 (보낸메일함에 반영)`);
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

// Approve and Send Email (실제 발송 큐 연동 - Gmail / 네이버 메일 자동 분기)
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

  const account = mail.account || (mail.service && mail.service.includes('네이버') ? 'dnjsrns123@naver.com' : 'onsessdesign@gmail.com');
  const isNaver = account.includes('naver') || (mail.service && mail.service.includes('네이버'));
  const service = isNaver ? 'naver' : 'gmail';

  showToast(`[승인 완료] ${mail.from.split('(')[0].trim()} 님께 답장 발송 큐가 접수되었습니다! 🚀 (${service === 'naver' ? '네이버 메일' : 'Gmail'} 자동 발송 연동)`);

  // Publish Send Request to ntfy Queue for Background Agent Execution
  try {
    const sendPayload = {
      action: 'send_email',
      timestamp: Date.now(),
      emailId: mail.id,
      service: service,
      account: account,
      recipient: mail.from,
      subject: mail.subject,
      body: mail.draft,
      draftId: mail.draftId || '',
      draftFile: mail.draftFile || (isNaver ? 'drafts/RE: [공구 제안] 100% 생과일 아넬라 퓨레, 공구 협업 제안드립니다.│올쓰컴퍼니-3.eml' : '')
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
    if (typeof renderChatConversationList === 'function') renderChatConversationList();
    if (typeof renderChatMessages === 'function') renderChatMessages();

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

  const kst = getKSTNow();
  activeChatDate = kst.dateStr;
  if (!chatSessions[activeChatDate] || chatSessions[activeChatDate].length === 0) {
    chatSessions[activeChatDate] = [
      {
        role: 'bot',
        text: '지원진 님 안녕하세요! 구름이예요 ㅎㅎ 오늘 일정이나 메일, 할 일 관련해서 처리할 작업 있으시면 편하게 말씀해 주세요!',
        time: '08:30'
      }
    ];
  }
  chatMessages = chatSessions[activeChatDate];

  currentChatView = 'room';
  const initialRoomView = document.getElementById('chat-view-room');
  if (initialRoomView) initialRoomView.style.display = 'flex';

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
      const rView = document.getElementById('chat-view-room');
      if (rView) rView.style.display = 'flex';
      renderChatMessages();
      if (inputEl) inputEl.focus();
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

  renderChatMessages();
}

window.showChatList = function() {
  currentChatView = 'room';
  const roomView = document.getElementById('chat-view-room');
  if (roomView) roomView.style.display = 'flex';
  renderChatMessages();
};

window.showChatRoom = function(sessionId) {
  currentChatView = 'room';
  if (sessionId) {
    activeChatDate = sessionId;
  }
  const kst = getKSTNow();
  if (!activeChatDate) activeChatDate = kst.dateStr;
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
  
  const roomView = document.getElementById('chat-view-room');
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

  // 5-A. Todo Word Removal & Text Cleanup (e.g. '오늘 단어는 삭제해야지', '"오늘" 단어 빼줘', '단어 삭제')
  if (
    (clean.includes('단어') || clean.includes('글자') || clean.includes('문구')) &&
    (clean.includes('삭제') || clean.includes('빼') || clean.includes('지워') || clean.includes('제거') || clean.includes('없애'))
  ) {
    if (appData && appData.briefings) {
      const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
      let targetWord = '';
      const quoteMatch = clean.match(/["'“‘]([^"'“”‘’]+)["'”’]/);
      if (quoteMatch) {
        targetWord = quoteMatch[1].trim();
      } else {
        const match = clean.match(/([^\s]+)\s*(?:단어|글자|문구)/);
        if (match) targetWord = match[1].trim();
      }
      if (!targetWord && clean.includes('오늘')) targetWord = '오늘';

      if (targetWord && b.todomateTodos && b.todomateTodos.length > 0) {
        const targetTodo = b.todomateTodos.find(t => t.text.includes(targetWord));
        if (targetTodo) {
          let newText = targetTodo.text.replace(new RegExp(targetWord, 'g'), '');
          newText = newText.replace(/["'“”‘’]/g, '').trim();
          if (!newText) newText = '새로운 업무';
          targetTodo.text = newText;

          saveCustomTodos(b.id);
          saveLocalTodosState(b.id);
          renderTodayView();
          pushCloudState();
          return `✏️ 할 일에서 '${targetWord}' 단어를 제외하고 '${newText}'(으)로 깔끔하게 수정했습니다!`;
        }
      }
    }
  }

  // 5-B. Todo Rename / Edit (e.g. '할 일 X로 수정해줘', 'X로 바꿔줘')
  if (
    (clean.includes('수정') || clean.includes('바꿔') || clean.includes('변경')) &&
    (clean.includes('할 일') || clean.includes('할일') || clean.includes('투두') || clean.includes('로 ') || clean.includes('으로 '))
  ) {
    if (appData && appData.briefings) {
      const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
      let newName = '';
      const quoteMatch = clean.match(/["'“‘]([^"'“”‘’]+)["'”’]/);
      if (quoteMatch) {
        newName = quoteMatch[1].trim();
      } else {
        const match = clean.match(/(?:할\s*일|할일|투두)?\s*(.+?)(?:로|으로)\s*(?:수정|변경|바꿔)/);
        if (match) newName = match[1].trim();
      }
      if (newName && b.todomateTodos && b.todomateTodos.length > 0) {
        const targetTodo = b.todomateTodos.find(t => t.id.startsWith('custom-')) || b.todomateTodos[0];
        if (targetTodo) {
          targetTodo.text = newName;
          saveCustomTodos(b.id);
          saveLocalTodosState(b.id);
          renderTodayView();
          pushCloudState();
          return `✏️ 할 일을 '${newName}'(으)로 수정했습니다!`;
        }
      }
    }
  }

  // 5-C. Todo Deletion (e.g. '컴퓨터 폴더 정리 삭제해줘', '방금 추가한 거 삭제해줘', '할 일 삭제')
  if (
    (clean.includes('삭제') || clean.includes('지워') || clean.includes('제거') || clean.includes('빼줘') || clean.includes('없애줘')) &&
    (clean.includes('할 일') || clean.includes('할일') || clean.includes('투두') || clean.includes('방금') || clean.includes('추가한'))
  ) {
    if (appData && appData.briefings) {
      const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
      if (b.todomateTodos && b.todomateTodos.length > 0) {
        let targetIdx = -1;
        const quoteMatch = clean.match(/["'“‘]([^"'“”‘’]+)["'”’]/);
        if (quoteMatch) {
          const query = quoteMatch[1].trim();
          targetIdx = b.todomateTodos.findIndex(t => t.text.includes(query));
        }
        if (targetIdx === -1 && (clean.includes('방금') || clean.includes('마지막'))) {
          targetIdx = b.todomateTodos.findIndex(t => t.id.startsWith('custom-'));
          if (targetIdx === -1) targetIdx = 0;
        }
        if (targetIdx === -1) {
          const cleanQuery = clean.replace(/(할 일에|할일에서|투두에서|할 일을|할일을|투두를|할 일|할일|투두|삭제해줘|지워줘|제거해줘|빼줘|삭제|지워|제거)/g, '').trim();
          if (cleanQuery) {
            targetIdx = b.todomateTodos.findIndex(t => t.text.includes(cleanQuery));
          }
        }

        if (targetIdx !== -1) {
          const targetName = b.todomateTodos[targetIdx].text;
          b.todomateTodos.splice(targetIdx, 1);
          saveCustomTodos(b.id);
          saveLocalTodosState(b.id);
          renderTodayView();
          pushCloudState();
          return `🗑️ 할 일 '${targetName}'을(를) 대시보드 목록에서 삭제했습니다!`;
        }
      }
    }
  }

  // 5-D. Todo Addition (e.g. '오늘 할 일에 "컴퓨터 폴더 정리" 추가해줘')
  if (
    clean.includes('추가') &&
    (clean.includes('할 일') || clean.includes('할일') || clean.includes('투두') || clean.includes('등록') || clean.includes('넣어'))
  ) {
    if (appData && appData.briefings) {
      const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
      let cleanTask = clean;
      const quoteMatch = clean.match(/["'“‘]([^"'“”‘’]+)["'”’]/);
      if (quoteMatch && quoteMatch[1].trim()) {
        cleanTask = quoteMatch[1].trim();
      } else {
        cleanTask = cleanTask.replace(/^(오늘|내일|이번주)?\s*(?:할\s*일(?:에|은|도|을|를)?|할일(?:에|은|도|을|를)?|투두(?:에|는|도|를)?)\s*/g, '');
        cleanTask = cleanTask.replace(/(?:추가해줘|추가해|추가|등록해줘|등록해|등록|넣어줘|넣어)\s*$/g, '');
        cleanTask = cleanTask.replace(/^(오늘|내일)\s+/g, '');
        cleanTask = cleanTask.replace(/["'“”‘’]/g, '').trim();
      }
      if (!cleanTask) cleanTask = '새로운 업무 확인';

      b.todomateTodos.unshift({
        id: `custom-${Date.now()}`,
        text: cleanTask,
        category: '사업or수익',
        done: false
      });
      saveCustomTodos(b.id);
      saveLocalTodosState(b.id);
      renderTodayView();
      pushCloudState();
      return `📝 오늘 할 일에 '${cleanTask}'을(를) 추가했습니다! (대시보드 실시간 반영)`;
    }
  }

  // 6. General Modification / Bug Feedback
  if (
    clean.includes('수정') || clean.includes('처리') || clean.includes('버튼') ||
    clean.includes('붙여넣기') || clean.includes('줄엔터') || clean.includes('동기화') ||
    clean.includes('아카이브') || clean.includes('기록') || clean.includes('오류') ||
    clean.includes('안돼')
  ) {
    return `지원진 님, 요청해 주신 내용 확인했습니다! 문제점 즉시 검토해서 대시보드에 바로 반영하겠습니다.`;
  }

  // 7. Questions about priorities (Dynamic from briefing)
  if (clean.includes('우선순위') || clean.includes('핵심')) {
    if (appData && appData.briefings) {
      const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
      const items = (b.agentPriorities || []).filter(ap => !ap.excluded).map((ap, i) => `${i + 1}. [${ap.priority}] ${ap.title}${ap.done ? ' (완료)' : ''}`);
      return `⚡ 오늘 집중하셔야 할 핵심 우선순위예요:\n` + items.join('\n');
    }
  }

  // 8. Questions about todos / uncompleted tasks
  if (clean.includes('투두') || clean.includes('할 일') || clean.includes('할일') || clean.includes('미처리')) {
    if (appData && appData.briefings) {
      const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
      const pending = (b.todomateTodos || []).filter(t => !t.done);
      if (pending.length === 0) return `오늘 등록된 모든 할 일을 완료하셨어요! 🎉`;
      return `📋 오늘 처리 대기 중인 할 일(${pending.length}건)이에요:\n` + pending.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
    }
  }

  // 9. Questions about mails / leads
  if (clean.includes('메일') || clean.includes('리드') || clean.includes('문의')) {
    if (appData && appData.briefings) {
      const b = appData.briefings.find(item => item.id === currentBriefingId) || appData.briefings[0];
      const pendingMails = (b.emails || []).filter(e => e.status !== 'excluded' && e.status !== 'done');
      if (pendingMails.length === 0) return `현재 미처리된 중요 메일이나 의뢰가 없습니다!`;
      return `📬 확인 필요한 중요 메일/의뢰 목록이에요:\n` + pendingMails.map((m, i) => `${i + 1}. [${m.priority}] ${m.subject} (${m.from})`).join('\n');
    }
  }

  // 10. Role Guidance / Pickle Assistant vs Web Controller
  if (clean.includes('역할') || clean.includes('안내') || clean.includes('피클') || clean.includes('비서')) {
    return `⚡ [역할 안내]\n• 웹 대시보드: 일정·메일·할 일을 0.1초 만에 확인하고 원클릭으로 조작하는 초고속 컨트롤 타워\n• 피클(Pickle) 앱 구름이: 실제 계정(Gmail, 네이버, 캘린더, 투두메이트, 쿠팡 등)을 직접 움직이고, 전화·결제·외주 초안·자동화까지 전담하는 진짜 AI 비서입니다!`;
  }

  // Natural Concise Default response (NO repetitive schedule recitation)
  return `네 지원진 님, '${clean}' 내용 접수했습니다! 말씀해 주신 내용 바탕으로 바로 챙겨둘게요 ㅎㅎ`;
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

    // 5. 공동구매 발송 완료 목록 동기화 (전 캠페인 통합)
    const gongguSentList = remoteData.gonggu_sent || remoteData.gongguSent || [];
    if (Array.isArray(gongguSentList)) {
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

    // 6. 공동구매 제외 목록 동기화
    const gongguExList = remoteData.gonggu_excluded || remoteData.gongguExcluded || [];
    if (Array.isArray(gongguExList)) {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('jeegong_gonggu_excluded_')) {
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

    // 6-B. 공동구매 발송 완료 큐(completed_queue) 동기화
    const incomingQueue = remoteData.completed_queue || remoteData.completedQueue;
    if (Array.isArray(incomingQueue)) {
      try {
        localStorage.setItem('jeegong_completed_queue', JSON.stringify(incomingQueue));
      } catch (e) {}
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

    if (typeof renderGongguCampaign === 'function') {
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

function getExcludeReason(inf) {
  const cid = inf.campaignId || '';
  const id = (inf.id || '').toLowerCase();
  
  if (cid === 'dearcus-bamboo-tissue') {
    return '쿠팡파트너스 어필리에이트 (단순 꿀템 소개 / 자체 공구 미진행)';
  }
  if (id === 'malanghoney_') {
    return '브랜드 공식 계정 (말랑하니 육아용품 전문 브랜드사 공식 계정)';
  }
  if (id === 'ran_gagu') {
    return '브랜드 공식 계정 (어린이 원목 가구/책장 제조판매사 란가구 공식 계정)';
  }
  if (id === 'yoonluv.s2') {
    return '공구 제안 거부 계정 (프로필에 광고/협찬⭕️ 공구제안❌️ 명시)';
  }
  if (id === '_yuki.home') {
    return '삭제/유령 계정 (인스타그램 페이지 삭제 또는 계정 미존재)';
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
  return '타깃 조건 미달 (5개월~4세 영유아 이유식 피드 불일치)';
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
        list.push(item);
      }
    });
  });
  return list;
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
              <th style="width: 100px;">시트 위치</th>
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
          <td style="font-size: 11.5px; color: var(--text-secondary); font-weight: 500;">행 ${item.row || '-'} · R열</td>
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
      activeBadgeEl.textContent = `총 ${excludedList.length}건 분석 중`;
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

    let excludedHtml = `
      <div style="background: var(--bg-card); border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-size: 14px; font-weight: 700; color: #991b1b; margin-bottom: 4px;">
            🚫 제외 계정 정밀 분석 큐: 총 <span style="font-weight: 800;">${excludedList.length}</span>건
          </div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            쿠팡파트너스, 타깃 불일치, 반응도 미달 등의 실패 패턴을 분석하여 다음 발굴의 100% 필터링 규칙으로 축적합니다.
          </div>
        </div>
      </div>

      <div class="todo-table-responsive" style="margin-top: 12px;">
        <table class="todo-modern-table">
          <thead>
            <tr>
              <th style="width: 45px; text-align: center;">No.</th>
              <th style="width: 120px;">제안 상품</th>
              <th style="width: 200px;">인스타그램 계정</th>
              <th style="width: 80px; text-align: center;">시트 위치</th>
              <th>오분류 및 제외 사유 분석</th>
              <th style="width: 80px; text-align: right;">관리</th>
            </tr>
          </thead>
          <tbody>
    `;

    excludedHtml += excludedList.map((item, idx) => {
      return `
        <tr>
          <td style="text-align: center; color: var(--text-tertiary); font-weight: 600;">${idx + 1}</td>
          <td><span class="section-badge" style="background: var(--bg-secondary); color: var(--text-secondary); font-size: 11px;">${escapeHtml(item.campaignTitle || '공동구매')}</span></td>
          <td>
            <a href="${escapeHtml(item.url || 'https://www.instagram.com/' + item.id)}" target="_blank" style="color: var(--accent-blue); font-weight: 600; text-decoration: none;">
              @${escapeHtml(item.id)}
            </a>
            ${item.follow ? `<span style="font-size: 11px; color: var(--text-tertiary); margin-left: 6px;">👥 ${escapeHtml(item.follow)}</span>` : ''}
          </td>
          <td style="text-align: center; font-size: 11.5px; color: var(--text-secondary); font-weight: 500;">행 ${item.row || '-'}</td>
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
      `;
    }).join('');

    excludedHtml += `
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = excludedHtml;

    container.querySelectorAll('.btn-restore-excluded').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
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
              <span class="gonggu-row-meta">행 ${inf.row} · R열</span>
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

    // Attach event listeners
    // 1. Textarea Auto-save
    container.querySelectorAll('.gonggu-dm-textarea').forEach(ta => {
      ta.addEventListener('input', (e) => {
        const id = e.target.getAttribute('data-id');
        localStorage.setItem('jeegong_gonggu_custom_dm_' + id, e.target.value);
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
          localStorage.setItem('jeegong_gonggu_excluded_' + id, 'true');
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
