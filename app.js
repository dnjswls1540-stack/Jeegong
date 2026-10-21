// Jeegong Work Agent Dashboard Application (v1.1.0)

let appData = null;
let currentBriefingId = 'b-20261021';
let isCheckedIn = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('data.json?v=' + Date.now());
    appData = await res.json();
  } catch (e) {
    console.error('Failed to load data.json', e);
  }

  setupTheme();
  setupNavigation();
  setupInteractions();
  setupChatbot();
  renderTodayView();
  renderArchiveView();
  renderHistoryView();
});

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
  const b = appData.briefings.find(item => item.id === 'b-20261021') || appData.briefings[0];

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

  // 2. Emails (with Exclude & Process System)
  const emailContainer = document.getElementById('email-list-container');
  emailContainer.innerHTML = '';
  const emailBadge = document.getElementById('email-badge');
  if (emailBadge) {
    emailBadge.textContent = `${b.emails.filter(e => e.status !== 'excluded' && e.status !== 'done' && e.status !== 'sent').length}건 조치 필요`;
  }

  // Sort emails: actionable first, (done, sent, excluded) at the bottom
  const sortedEmails = [...b.emails].sort((a, b) => {
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
    const isSent = mail.status === 'sent';

    emailContainer.innerHTML += `
      <div class="email-item ${pClass} ${isExcluded ? 'excluded' : ''}" id="email-item-${mail.id}">
        <div class="email-top">
          <div class="email-badges">
            <span class="badge-tag ${badgeClass}">${mail.priority}</span>
            <span class="badge-tag badge-service">${mail.service}</span>
            ${isSent ? '<span class="badge-tag" style="background:#e6f8f1;color:#04b06b;">발송 완료 ✓</span>' : ''}
            ${isExcluded ? '<span class="badge-tag" style="background:#f2f4f6;color:#8b95a1;">제외됨</span>' : ''}
          </div>
          <div class="email-from">${mail.from}</div>
        </div>
        <div class="email-subject">${mail.subject}</div>
        <div class="email-summary">${mail.summary}</div>

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
  if (todoBadge) todoBadge.textContent = `${b.todomateTodos.filter(t => !t.done).length}건 대기`;

  const sortedTodos = [...b.todomateTodos].sort((a, b) => {
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
        <span class="section-badge" style="font-size: 11px;">투두메이트</span>
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
          ${ap.detail}
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
  renderTodayView();
  showToast('메일이 직접 처리 완료 상태로 변경되었습니다.');
};

window.unmarkDoneEmail = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const mail = b.emails.find(m => m.id === id);
  if (!mail) return;
  mail.status = 'pending';
  renderTodayView();
  showToast('메일 완료 상태가 취소되었습니다.');
};

// Agent Priority Done / Exclude Handlers
window.toggleAgentPriorityDone = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const ap = b.agentPriorities.find(item => item.id === id);
  if (!ap) return;
  ap.done = !ap.done;
  renderTodayView();
  showToast(ap.done ? '해당 우선순위 업무를 완료 처리했습니다!' : '완료 처리를 취소했습니다.');
};

window.toggleAgentPriorityExclude = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const ap = b.agentPriorities.find(item => item.id === id);
  if (!ap) return;
  ap.excluded = !ap.excluded;
  renderTodayView();
  showToast(ap.excluded ? '해당 우선순위 업무를 제외 처리했습니다.' : '제외 처리를 복구했습니다.');
};

// Email Exclude / Restore
// Render Customer Inquiries (Kmong, Imweb, Mail)
function renderInquiries(b, containerId, badgeId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!b.inquiries) b.inquiries = [];

  const badge = document.getElementById(badgeId);
  const pendingCount = b.inquiries.filter(i => i.status !== 'excluded' && i.status !== 'done' && i.status !== 'sent').length;
  if (badge) {
    badge.textContent = `${pendingCount}건 대기`;
  }

  container.innerHTML = '';
  if (b.inquiries.length === 0) {
    container.innerHTML = '<div class="empty-state">현재 인입된 신규 고객 문의가 없습니다.</div>';
    return;
  }

  // Sort: actionable first, (done, sent, excluded) at the bottom
  const sortedInquiries = [...b.inquiries].sort((a, b) => {
    const aHandled = a.status === 'done' || a.status === 'sent' || a.status === 'excluded';
    const bHandled = b.status === 'done' || b.status === 'sent' || b.status === 'excluded';
    if (aHandled === bHandled) return 0;
    return aHandled ? 1 : -1;
  });

  sortedInquiries.forEach(inq => {
    const isExcluded = inq.status === 'excluded';
    const isDone = inq.status === 'done';
    const isSent = inq.status === 'sent';
    const chClass = inq.channel === '크몽' ? 'channel-kmong' : inq.channel === '아임웹' ? 'channel-imweb' : inq.channel === '네이버 메일' ? 'channel-naver' : 'channel-gmail';
    const badgeChClass = inq.channel === '크몽' ? 'badge-channel-kmong' : inq.channel === '아임웹' ? 'badge-channel-imweb' : inq.channel === '네이버 메일' ? 'badge-channel-naver' : 'badge-channel-gmail';

    container.innerHTML += `
      <div class="inquiry-item ${chClass} ${isExcluded ? 'excluded' : ''} ${isDone || isSent ? 'done' : ''}" id="inquiry-item-${containerId}-${inq.id}">
        <div class="email-top">
          <div class="email-badges">
            <span class="section-badge ${badgeChClass}">${inq.channel} 문의</span>
            <span class="email-sender">${inq.from}</span>
            <span class="email-time">${inq.time}</span>
          </div>
          <div class="email-item-actions">
            ${isDone ? `
              <span class="email-status-text" style="color: var(--accent-green);">직접 답변 완료 ✓</span>
              <button class="btn-email-action" onclick="toggleInquiryDirectDone('${inq.id}')">복구</button>
            ` : isSent ? `
              <span class="email-status-text" style="color: var(--accent-blue);">답변 발송 완료 ✈️</span>
            ` : isExcluded ? `
              <span class="email-status-text">제외됨</span>
              <button class="btn-email-action" onclick="toggleInquiryExclude('${inq.id}')">복구</button>
            ` : `
              <button class="btn-email-action btn-direct-done" onclick="toggleInquiryDirectDone('${inq.id}')" title="이미 직접 답변한 문의">
                직접 완료
              </button>
              <button class="btn-email-action" onclick="toggleInquiryExclude('${inq.id}')" title="답변 불필요">
                제외
              </button>
              <button class="btn-process" onclick="openInquiryProcessDraft('${containerId}-${inq.id}')">
                답장 처리
              </button>
            `}
          </div>
        </div>

        <div class="email-subject" style="font-weight: 600; font-size: 13.5px;">${inq.subject}</div>
        <div class="email-summary" style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.45;">${inq.content}</div>

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

// Inquiry Action Handlers
window.toggleInquiryDirectDone = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  if (!b || !b.inquiries) return;
  const inq = b.inquiries.find(i => i.id === id);
  if (!inq) return;

  if (inq.status === 'done') {
    inq.status = 'pending';
    showToast('문의 항목이 조치 대기 상태로 복구되었습니다.');
  } else {
    inq.status = 'done';
    showToast('문의 항목이 직접 완료 처리되었습니다.');
  }
  renderTodayView();
};

window.toggleInquiryExclude = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  if (!b || !b.inquiries) return;
  const inq = b.inquiries.find(i => i.id === id);
  if (!inq) return;

  if (inq.status === 'excluded') {
    inq.status = 'pending';
    showToast('문의 항목이 복구되었습니다.');
  } else {
    inq.status = 'excluded';
    showToast('문의 항목이 제외 처리되었습니다.');
  }
  renderTodayView();
};

window.openInquiryProcessDraft = function(domId) {
  const box = document.getElementById(`inquiry-draft-box-${domId}`);
  if (box) box.classList.toggle('active');
};

window.closeInquiryProcessDraft = function(domId) {
  const box = document.getElementById(`inquiry-draft-box-${domId}`);
  if (box) box.classList.remove('active');
};

window.approveAndSendInquiry = function(id, domId) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  if (!b || !b.inquiries) return;
  const inq = b.inquiries.find(i => i.id === id);
  if (!inq) return;

  const textEl = document.getElementById(`inquiry-draft-text-${domId}`);
  if (textEl) inq.draft = textEl.value;

  inq.status = 'sent';
  closeInquiryProcessDraft(domId);
  renderTodayView();
  showToast(`[답변 발송 완료] ${inq.from} 님께 맞춤 답변이 전송되었습니다!`);
};

window.toggleExcludeEmail = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const mail = b.emails.find(m => m.id === id);
  if (!mail) return;

  if (mail.status === 'excluded') {
    mail.status = 'pending';
    showToast('메일 항목이 브리핑에 복구되었습니다.');
  } else {
    mail.status = 'excluded';
    // close draft if open
    const draftBox = document.getElementById(`draft-box-${id}`);
    if (draftBox) draftBox.classList.remove('active');
    showToast('메일 항목이 제외 처리되었습니다.');
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

// Approve and Send Email
window.approveAndSendEmail = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const mail = b.emails.find(m => m.id === id);
  if (!mail) return;

  const textEl = document.getElementById(`draft-text-${id}`);
  if (textEl) {
    mail.draft = textEl.value;
  }

  mail.status = 'sent';
  closeProcessDraft(id);
  renderTodayView();
  showToast(`[승인 완료] ${mail.from.split('(')[0].trim()} 님께 답장 메일 발송이 접수되었습니다!`);
};

// Toggle Todomate Todo
window.toggleTodomateTodo = function(id) {
  if (!appData) return;
  const b = appData.briefings.find(item => item.id === currentBriefingId);
  const t = b.todomateTodos.find(item => item.id === id);
  if (t) {
    t.done = !t.done;
    renderTodayView();
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

  function renderSelectedArchive() {
    const selectedId = select.value;
    const b = appData.briefings.find(item => item.id === selectedId);
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

  // Work state management: 'ready' -> 'checked_in' -> 'finished'
  let workState = localStorage.getItem('jeegong_work_state') || 'ready';

  function updateWorkButtonUI() {
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
      localStorage.setItem('jeegong_work_state', 'checked_in');
      updateWorkButtonUI();

      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      appData.history.unshift({
        id: `run-${Date.now()}`,
        timestamp: `2026-10-21 ${timeStr}`,
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
      localStorage.setItem('jeegong_work_state', 'finished');
      updateWorkButtonUI();

      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      appData.history.unshift({
        id: `run-${Date.now()}`,
        timestamp: `2026-10-21 ${timeStr}`,
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
        localStorage.setItem('jeegong_work_state', 'ready');
        updateWorkButtonUI();
        renderTodayView();
        showToast('출근 준비 상태로 복원되었습니다.');
      }
    }
  });

  // Copy Markdown
  copyBtn.addEventListener('click', () => {
    const md = `# 🌅 [지공 출근 에이전트] 오늘 업무 브리핑 (2026-10-21 수요일)

### 📅 오늘의 일정 & 회의
- 오늘 등록된 캘린더 일정 없음 (내일 10/22~10/26 [공구] 우주맘마 아넬라 과일퓨레 진행 예정)

### 📬 중요 메일 & 외부 요청
1. [1순위 긴급] 인플루언서 희수 님: 오슬로앤오십구 겨울 베어메리 공구 일정 소통 희망 (카톡 thou7)
2. [2순위 진행] OYKA HOME: 식스샵 쇼핑몰 신규 제작 견적 의뢰 (예산 50~100만 원)
3. [2순위 진행] 라운드커머스: 타이거모닝 진저샷 공구 운영 파트너십 제안

### 📱 투두메이트 오늘 할 일
- 지공 상세페이지 재구성
- 이벤트 페이지 광고세팅
- 아넬라 제안 20명
- 디어커스 제안 15명
- 듀오링고 일본어 2개

### ✨ 에이전트 추천 핵심 우선순위
1. [1순위] 아넬라 과일퓨레 공구 오픈 최종 세팅 (내일 10/22 오픈 대비)
2. [1순위] 인플루언서 희수 님 카톡(thou7) 일정·단가 협의
3. [2순위] 디어커스 단톡방 개설 및 일정 회신
4. [2순위] 식스샵 OYKA HOME 맞춤 견적서 회신

> 💡 한 줄 가이드: 내일 시작되는 우주맘마 아넬라 공구 피드 세팅과 희수 님 카톡 협의를 오전 중 완료하세요.`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(md).then(() => showToast('브리핑 마크다운이 복사되었습니다.'));
    } else {
      showToast('브리핑이 복사되었습니다.');
    }
  });
}

function showToast(msg) {
  const t = document.getElementById('toast-notice');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// =========================================================
// CHATBOT WIDGET LOGIC (구름이 웹 소통 & 파일 첨부)
// =========================================================
let currentAttachments = [];
let chatMessages = [
  {
    role: 'bot',
    text: '지원진 님 안녕하세요! 구름이예요 ㅎㅎ 웹에서도 편하게 말씀해 주세요. 오늘 일정이나 메일, 할 일 관련해서 궁금하신 점이나 처리할 일 있으시면 바로 해결해 드릴게요!',
    time: '방금 전'
  }
];

function setupChatbot() {
  const toggleBtn = document.getElementById('btn-chatbot-toggle');
  const modal = document.getElementById('chatbot-modal');
  const closeBtn = document.getElementById('btn-chatbot-close');
  const clearBtn = document.getElementById('btn-chatbot-clear');
  const sendBtn = document.getElementById('chatbot-send-btn');
  const inputEl = document.getElementById('chatbot-input');
  const badge = document.getElementById('trigger-unread-badge');
  const attachBtn = document.getElementById('btn-chatbot-attach');
  const fileInput = document.getElementById('chatbot-file-input');

  if (!toggleBtn || !modal) return;

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

  // Load saved history
  try {
    const saved = localStorage.getItem('jeegong_chat_history');
    if (saved) {
      chatMessages = JSON.parse(saved);
    }
  } catch (e) {}

  toggleBtn.addEventListener('click', () => {
    modal.classList.toggle('open');
    if (modal.classList.contains('open')) {
      markAsRead();
      renderChatMessages();
      inputEl.focus();
    }
  });

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('open');
  });

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

  sendBtn.addEventListener('click', () => {
    markAsRead();
    handleChatSend();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      markAsRead();
      handleChatSend();
    }
  });

  renderChatMessages();
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
  try {
    localStorage.setItem('jeegong_chat_history', JSON.stringify(chatMessages.slice(-20)));
  } catch (e) {}
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
  await new Promise(r => setTimeout(r, 600));

  // If attachments are present
  if (attachments && attachments.length > 0) {
    const fileNames = attachments.map(a => `'${a.name}'`).join(', ');
    const hasVideo = attachments.some(a => a.type === 'video');
    const hasImage = attachments.some(a => a.type === 'image');

    if (hasVideo) {
      return `보내주신 동영상 파일(${fileNames}) 잘 확인했습니다! 🎬\n\n${prompt ? `"${prompt}"에 대해 검토해 드릴게요.\n` : ''}영상 릴스/쇼츠 시안, 광고 영상 흐름, 상세페이지 동영상 배치 등 필요한 점 말씀해 주시면 바로 검토할게요 ㅎㅎ`;
    } else if (hasImage) {
      return `보내주신 이미지/사진(${fileNames}) 잘 확인했습니다! 📷\n\n${prompt ? `"${prompt}"에 대해 검토해 드릴게요.\n` : ''}디자인 시안, 상세페이지 구성, 배너 레이아웃 등 필요한 작업 말씀해 주시면 바로 검토해서 피드백 드릴게요 ㅎㅎ`;
    } else {
      return `첨부해 주신 파일(${fileNames}) 안전하게 접수했습니다! 📄\n\n${prompt ? `요청하신 "${prompt}" 내용 바탕으로 확인 중입니다.\n` : ''}자료에서 추가로 정리하거나 반영할 작업이 있으시면 언제든 말씀해 주세요!`;
    }
  }

  const lower = prompt.toLowerCase();

  // 1. Check if user wants to add todo
  if (prompt.includes('추가') && (prompt.includes('할 일') || prompt.includes('할일') || prompt.includes('투두'))) {
    let cleanTask = prompt.replace(/(할 일에|할일에|투두에|추가해줘|추가해|추가)/g, '').trim();
    if (!cleanTask) cleanTask = '새로운 업무 확인';

    if (appData && appData.briefings) {
      const b = appData.briefings[0];
      b.todomateTodos.unshift({
        id: `custom-${Date.now()}`,
        text: cleanTask,
        done: false
      });
      renderTodayView();
    }
    return `네 지원진 님! 오늘 할 일 목록에 **'${cleanTask}'** 항목을 바로 추가해 두었습니다. 대시보드 화면에서도 바로 확인하실 수 있어요!`;
  }

  // 2. Questions about priorities
  if (prompt.includes('우선순위') || prompt.includes('뭐부터') || prompt.includes('먼저')) {
    return `오늘 지원진 님의 1순위 핵심 업무는 2가지예요:\n\n1. **인플루언서 희수 님 카톡(thou7) 협의**: 오슬로앤오십구 겨울 베어메리 일정·단가 조율\n2. **아넬라 과일퓨레 공구 오픈 세팅**: 내일(10/22) 오픈이라 20명 제안 발송 및 광고 세팅이 필수입니다.\n\n오전 중으로 이 두 건 먼저 매듭지으시면 오늘 일과가 훨씬 수월해지실 거예요!`;
  }

  // 3. Questions about Heesu / Email draft
  if (prompt.includes('희수') || (prompt.includes('답장') && prompt.includes('다듬'))) {
    return `희수 님께 보낼 추천 카톡 문구예요:\n\n"안녕하세요 희수 님! 올쓰컴퍼니 지원진입니다 :)\n검색 허용 켜주셔서 감사합니다. 메일로 말씀해주신 오슬로앤오십구 겨울 베어메리 관련해서 편하신 일정과 조건 조율 나누면 좋겠습니다!"\n\n대시보드 메일 섹션에서 [답장 처리]를 누르시면 이 초안을 바로 수정·승인하실 수 있어요.`;
  }

  // 4. Questions about Anela puree
  if (prompt.includes('아넬라') || prompt.includes('우주맘마') || prompt.includes('공구')) {
    return `내일(10/22 수요일~10/26 일요일)부터 5일간 '우주맘마 아넬라 과일퓨레' 공구가 시작돼요!\n\n오늘 점검하실 사항:\n- 인플루언서 20명 대상 섭외 메일 전송\n- 인스타 피드 및 스토리 광고 세팅\n- 구글 드라이브의 인플루언서 리스트 실무 시트 확인\n\n준비되시면 바로 시작하실 수 있게 세팅해 두었어요!`;
  }

  // 5. Questions about OYKA HOME / Sixshop
  if (prompt.includes('식스샵') || prompt.includes('oyka') || prompt.includes('견적')) {
    return `OYKA HOME에서 요청한 식스샵 쇼핑몰 신규 구축 의뢰건이에요.\n\n- 예산: 50~100만 원\n- 스타일 레퍼런스: 베베드피노 (키즈웨어·파자마)\n- 추천 대응: 온세스 포트폴리오와 함께 70~80만 원 선의 기본 구축 패키지 견적서를 메일로 회신드리는 것을 추천드립니다!`;
  }

  // Default response
  return `네 지원진 님! 말씀하신 내용 잘 확인했습니다. 오늘 캘린더 일정은 비어있고, 내일 아넬라 공구 오픈 준비와 희수 님 소통이 핵심이에요. 웹에서도 필요한 작업이나 수정사항 있으시면 언제든 말씀해 주세요! ㅎㅎ`;
}

