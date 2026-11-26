// =========================================================
// 업무관리 (2026-11-25) — 로그인해야 보이는 비공개 데이터
//   정산·매출 탭 / 공동구매 하위 메뉴(공구 일정·인플루언서 정산·상품 소싱·원천징수) / 상단 마감 알림
//   금액·연락처는 Supabase(RLS) 에만 저장한다. data.json 에는 넣지 않는다.
//   app.js 의 SUPABASE_URL · SUPABASE_ANON_KEY · escapeHtml · showToast 를 그대로 쓴다.
// =========================================================
(function () {
  const SESSION_KEY = 'jeegong_ops_session';
  const SUB_KEY = 'jeegong_ops_gonggu_sub';
  const FN_SYNC = SUPABASE_URL + '/functions/v1/ops-sync';
  const BIZ = { gonggu: '공구', paynote: '페이노트', onsess: '온세스' };
  const SET_STATUS = { waiting: '정산 대기', amount: '금액 입력', paid: '입금 확인', done: '완료' };
  const STAGES = { planned: '제안 예정', proposed: '제안', waiting: '답장 대기', negotiating: '조건 협의', confirmed: '공구 확정', hold: '보류' };
  const CATS = ['건강', '뷰티', '패션', '리빙', '육아', '식품', '애견', '여행'];
  const ALERT_KIND = {
    settle_late: ['정산 지연', 'settle'], settle_due: ['정산 예정', 'settle'], event_end: ['공구 종료', 'events'],
    sourcing_follow: ['소싱 후속 연락', 'sourcing'], withholding: ['원천징수', 'withholding'],
  };

  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const todayStr = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜
  const monthOf = (d) => (d || todayStr()).slice(0, 7);
  const firstDay = (ym) => ym + '-01';
  const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const won = (n) => (n == null || n === '' ? '–' : Number(n).toLocaleString('ko-KR') + '원');
  const md = (d) => (d ? d.slice(5).replace('-', '/') : '–');
  const kstDay = (ts) => (ts ? new Date(new Date(ts).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '');
  const dayDiff = (d) => Math.round((Date.parse(d) - Date.parse(todayStr())) / 864e5);
  const dLabel = (d) => { const n = dayDiff(d); return n === 0 ? '오늘' : n > 0 ? 'D-' + n : Math.abs(n) + '일 지남'; };
  const num = (v) => (v === '' || v == null ? null : Math.round(Number(String(v).replace(/,/g, ''))));
  const WH_FROM = '2026-11'; // 원천징수 탭 조회 시작 월
  const gongguMonth = (s) => (s.start_date || s.end_date || '').slice(0, 7); // 공구 진행 월 = 시작일 기준
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

  const S = {
    session: readSession(), owner: null, loading: false, loadedAt: 0,
    revenue: [], targets: [], events: [], settlements: [], sourcing: [], withholding: [], meta: {}, alerts: [],
    month: monthOf(), sub: lsGet(SUB_KEY) || 'dm', setFilter: 'open', setMonth: monthOf(), srcCat: '전체', srcStage: '전체',
    editRevenue: null, editSourcing: null,
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  function readSession() { try { return JSON.parse(lsGet(SESSION_KEY)) || null; } catch (e) { return null; } }
  function saveSession(s) {
    S.session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), email: (s.user && s.user.email) || (S.session && S.session.email) || '' };
    lsSet(SESSION_KEY, JSON.stringify(S.session));
  }
  function logout() {
    Object.assign(S, { session: null, owner: null, loadedAt: 0, revenue: [], targets: [], events: [], settlements: [], sourcing: [], withholding: [], meta: {}, alerts: [] });
    lsSet(SESSION_KEY, null);
    renderAll();
  }

  // ---------- Supabase 통신 ----------
  let refreshing = null;
  function refresh() {
    refreshing = refreshing || (async () => {
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: S.session && S.session.refresh_token }),
      });
      if (!res.ok) { logout(); throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
      saveSession(await res.json());
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function call(url, { method = 'GET', body, prefer } = {}) {
    if (!S.session) throw new Error('로그인이 필요합니다.');
    if (Date.now() / 1000 > S.session.expires_at - 60) await refresh();
    const send = () => fetch(url, {
      method,
      headers: Object.assign({ apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + S.session.access_token, 'Content-Type': 'application/json' }, prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let res = await send();
    if (res.status === 401) { await refresh(); res = await send(); }
    const text = await res.text();
    if (!res.ok) throw new Error(text || ('요청 실패 ' + res.status));
    return text ? JSON.parse(text) : null;
  }
  const rest = (path, opt) => call(SUPABASE_URL + '/rest/v1/' + path, opt);
  const insert = (t, row) => rest(t, { method: 'POST', body: row, prefer: 'return=minimal' });
  const upsert = (t, key, row) => rest(t + '?on_conflict=' + key, { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=minimal' });
  const patch = (t, id, row) => rest(t + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: row, prefer: 'return=minimal' });
  const remove = (t, id) => rest(t + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=minimal' });

  async function login(email, password) {
    const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 400 ? '이메일 또는 비밀번호가 맞지 않아요.' : '로그인 실패: ' + (data.msg || data.error_description || res.status));
    saveSession(data);
  }

  async function loadAll(force) {
    if (!S.session || S.loading || (!force && Date.now() - S.loadedAt < 30000)) return;
    S.loading = true;
    try {
      if (S.owner === null) S.owner = await rest('rpc/ops_is_owner', { method: 'POST', body: {} });
      if (S.owner) {
        const q = (t, order) => rest(t + '?select=*' + (order ? '&order=' + order : ''));
        const [revenue, targets, events, settlements, sourcing, withholding, meta, alerts] = await Promise.all([
          q('ops_revenue', 'created_at.desc'), q('ops_targets'), q('ops_gonggu_events', 'start_date.asc'),
          q('ops_settlements', 'end_date.desc.nullslast'), q('ops_sourcing', 'created_at.desc'), q('ops_withholding'),
          q('ops_meta'), q('ops_alerts', 'due_date.asc'),
        ]);
        Object.assign(S, { revenue, targets, events, settlements, sourcing, withholding, alerts, loadedAt: Date.now() });
        S.meta = Object.fromEntries(meta.map((m) => [m.key, m.value]));
      }
    } catch (e) {
      showToast('업무 데이터 불러오기 실패: ' + e.message.slice(0, 80));
    } finally {
      S.loading = false;
      renderAll();
    }
  }
  async function act(fn, okMsg) {
    try { await fn(); await loadAll(true); if (okMsg) showToast(okMsg); }
    catch (e) { showToast('저장 실패: ' + e.message.slice(0, 80)); }
  }

  // ---------- 공통 조각 ----------
  function loginCard() {
    if (S.session && S.owner === false) {
      return `<div class="ops-login"><strong>이 계정은 아직 소유자로 등록되지 않았어요.</strong>
        <p>Supabase에서 소유자 등록이 끝나면 다시 로그인해 주세요.</p>
        <button class="btn-sm-tool" data-ops="logout">로그아웃</button></div>`;
    }
    return `<form class="ops-login" data-ops-form="login">
      <strong>🔒 로그인하면 보이는 비공개 정보예요</strong>
      <p>매출·정산 금액과 연락처는 공개 대시보드에 올리지 않고, 로그인한 원진님만 볼 수 있게 따로 저장합니다.</p>
      <input type="email" name="email" placeholder="이메일" autocomplete="username" required>
      <input type="password" name="password" placeholder="비밀번호" autocomplete="current-password" required>
      <button type="submit" class="ops-btn ops-btn--primary">로그인</button>
    </form>`;
  }
  const ready = () => S.session && S.owner;
  const bizBadge = (b) => `<span class="ops-chip ops-chip--${b}">${BIZ[b] || b}</span>`;
  const stamps = (r) => `<span class="ops-stamp">입력 ${kstDay(r.created_at)}${r.updated_at && kstDay(r.updated_at) !== kstDay(r.created_at) ? ' · 수정 ' + kstDay(r.updated_at) : ''}</span>`;
  const field = (label, html, wide) => `<label class="ops-field${wide ? ' ops-field--wide' : ''}"><span>${label}</span>${html}</label>`;
  const options = (map, cur) => Object.entries(map).map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`).join('');

  // ---------- 상단 마감 알림 ----------
  function renderAlerts() {
    const el = document.getElementById('ops-alert-bar');
    if (!el) return;
    if (!ready() || !S.alerts.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const danger = S.alerts.filter((a) => a.level === 'danger').length;
    el.innerHTML = `<div class="ops-alert-head">⏰ 마감 알림 ${S.alerts.length}건${danger ? ` · <b>지난 마감 ${danger}건</b>` : ''}</div>
      <ul>${S.alerts.map((a) => {
        const [label, sub] = ALERT_KIND[a.kind] || [a.kind, 'dm'];
        return `<li class="ops-alert ops-alert--${a.level}" data-ops="goto" data-sub="${sub}">
          <span class="ops-alert-kind">${label}</span><span class="ops-alert-title">${esc(a.title)}</span>
          <span class="ops-alert-due">${md(a.due_date)} · ${dLabel(a.due_date)}</span></li>`;
      }).join('')}</ul>`;
  }

  // ---------- 정산·매출 탭 ----------
  function pendingRevenue() {
    const linked = new Set(S.revenue.map((r) => r.settlement_id).filter(Boolean));
    return S.settlements.filter((s) => s.status === 'done' && !s.revenue_skipped && !linked.has(s.id));
  }
  function revenueForm() {
    const r = S.editRevenue;
    if (!r) return '';
    return `<form class="ops-form" data-ops-form="revenue">
      <div class="ops-form-title">${r.id ? '입력 수정' : r.settlement_id ? '정산 완료 공구 → 매출 확인' : '새 매출 입력'}</div>
      <div class="ops-grid">
        ${field('귀속 월', `<input type="month" name="month" value="${(r.month || firstDay(S.month)).slice(0, 7)}" required>`)}
        ${field('사업', `<select name="business">${options(BIZ, r.business || 'gonggu')}</select>`)}
        ${field('내용', `<input name="title" value="${esc(r.title)}" placeholder="예: 전자책 2건, 아넬라 공구 수수료">`, true)}
        ${field('매출 (내 수수료 매출)', `<input name="revenue" type="number" inputmode="numeric" step="1" value="${r.revenue ?? ''}" required>`)}
        ${field('순수익 (부가세 제외)', `<input name="net_profit" type="number" inputmode="numeric" step="1" value="${r.net_profit ?? ''}" required>`)}
      </div>
      <div class="ops-form-actions"><button type="button" class="ops-btn" data-ops="rev-cancel">취소</button><button type="submit" class="ops-btn ops-btn--primary">저장</button></div>
    </form>`;
  }
  function renderSales() {
    const el = document.getElementById('ops-sales');
    if (!el) return;
    if (!ready()) { el.innerHTML = loginCard(); return; }
    const ym = S.month;
    const rows = S.revenue.filter((r) => r.month.slice(0, 7) === ym);
    const sum = (k, list = rows) => list.reduce((a, r) => a + Number(r[k] || 0), 0);
    const revSum = sum('revenue'), netSum = sum('net_profit');
    const target = (S.targets.find((t) => t.month.slice(0, 7) === ym) || {}).target_net;
    const pct = target > 0 ? (netSum / target) * 100 : null;
    const pending = pendingRevenue();
    const isThisMonth = ym === monthOf();
    el.innerHTML = `
      <div class="ops-toolbar">
        <div class="ops-month">
          <button class="ops-btn ops-btn--icon" data-ops="month" data-n="-1" aria-label="이전 달">◀</button>
          <input type="month" value="${ym}" data-ops-change="month" aria-label="조회 월">
          <button class="ops-btn ops-btn--icon" data-ops="month" data-n="1" aria-label="다음 달">▶</button>
          ${isThisMonth ? '' : '<button class="ops-btn" data-ops="month-now">이번 달</button>'}
        </div>
        <div class="ops-toolbar-right"><span class="ops-muted">${esc(S.session.email)}</span><button class="ops-link" data-ops="logout">로그아웃</button></div>
      </div>
      <div class="ops-stats">
        <div class="ops-stat"><span>${isThisMonth ? '이번 달' : ym} 매출 합계</span><strong>${won(revSum)}</strong></div>
        <div class="ops-stat"><span>순수익 합계</span><strong>${won(netSum)}</strong></div>
        <form class="ops-stat" data-ops-form="target"><span>목표 순수익</span>
          <div class="ops-inline"><input name="target" type="number" inputmode="numeric" step="1" value="${target ?? ''}" placeholder="목표 입력"><button class="ops-btn" type="submit">저장</button></div></form>
        <div class="ops-stat"><span>목표 달성률</span><strong>${pct == null ? '목표 미설정' : pct.toFixed(1) + '%'}</strong>
          ${pct == null ? '' : `<div class="ops-bar"><i style="width:${Math.min(pct, 100)}%"></i></div>`}</div>
      </div>
      <div class="ops-biz">${Object.keys(BIZ).map((b) => {
        const list = rows.filter((r) => r.business === b);
        return `<div>${bizBadge(b)} 매출 <b>${won(sum('revenue', list))}</b> · 순수익 <b>${won(sum('net_profit', list))}</b></div>`;
      }).join('')}</div>
      ${pending.length ? `<div class="panel-card ops-card">
        <div class="panel-header"><div class="panel-title"><span>✅</span><span>정산 완료 공구 — 매출 확인 대기 ${pending.length}건</span></div></div>
        <p class="ops-muted">확인 후 저장해야 합계에 들어갑니다.</p>
        ${pending.map((s) => `<div class="ops-row">
          <div class="ops-row-main"><b>${esc(s.title || [s.influencer, s.brand, s.product].join(' '))}</b>
          <span class="ops-muted">내 수수료 ${won(s.my_fee)} · 귀속 ${monthOf(s.paid_date || s.end_date)}</span></div>
          <div class="ops-row-actions"><button class="ops-btn ops-btn--primary" data-ops="rev-from" data-id="${s.id}">확인 후 입력</button>
          <button class="ops-btn" data-ops="rev-skip" data-id="${s.id}">건너뛰기</button></div></div>`).join('')}
      </div>` : ''}
      <div class="panel-card ops-card">
        <div class="panel-header"><div class="panel-title"><span>🧾</span><span>${ym} 입력 내역 ${rows.length}건</span></div>
          <button class="ops-btn ops-btn--primary" data-ops="rev-new">+ 새 입력</button></div>
        ${revenueForm()}
        ${rows.length ? rows.map((r) => `<div class="ops-row">
          <div class="ops-row-main">${bizBadge(r.business)} <b>${esc(r.title) || '(내용 없음)'}</b>${stamps(r)}</div>
          <div class="ops-row-nums"><span>매출 <b>${won(r.revenue)}</b></span><span>순수익 <b>${won(r.net_profit)}</b></span></div>
          <div class="ops-row-actions"><button class="ops-btn" data-ops="rev-edit" data-id="${r.id}">수정</button>
          <button class="ops-btn ops-btn--danger" data-ops="rev-del" data-id="${r.id}">삭제</button></div></div>`).join('')
        : '<p class="ops-empty">이 달에 입력한 매출이 없어요.</p>'}
      </div>`;
  }

  // ---------- 공구 일정 ----------
  function renderEvents() {
    const el = document.getElementById('ops-events');
    if (!el) return;
    if (!ready()) { el.innerHTML = loginCard(); return; }
    const t = todayStr();
    const live = S.events.filter((e) => !e.removed);
    const groups = [
      ['진행 중', live.filter((e) => e.start_date <= t && e.end_date >= t)],
      ['예정', live.filter((e) => e.start_date > t)],
      ['최근 종료 (30일)', live.filter((e) => e.end_date < t && dayDiff(e.end_date) >= -30).reverse()],
    ];
    const sync = S.meta.calendar_sync || {};
    const topic = (S.meta.alert_topic || {}).topic;
    el.innerHTML = `<div class="panel-card ops-card">
      <div class="panel-header"><div class="panel-title"><span>📅</span><span>공구 일정</span></div>
        <button class="ops-btn ops-btn--primary" data-ops="sync">지금 동기화</button></div>
      <div class="ops-note ${sync.ok === false ? 'ops-note--bad' : ''}">
        구글 캘린더에서 제목이 <b>[공구]</b>로 시작하는 일정만 하루 4번(09·13·17·20시) 불러옵니다.<br>
        ${sync.at ? `마지막 동기화 ${kstDay(sync.at)} ${new Date(sync.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })} · ${sync.ok ? `일정 ${sync.count}건 확인` : '실패: ' + esc(sync.error)}` : '아직 동기화 기록이 없어요.'}
      </div>
      ${groups.map(([name, list]) => `<div class="ops-group"><div class="ops-group-title">${name} <span>${list.length}</span></div>
        ${list.length ? list.map((e) => `<div class="ops-row">
          <div class="ops-row-main"><b>${esc(e.influencer)}</b> ${esc(e.brand)} · ${esc(e.product)}
          <span class="ops-muted">${md(e.start_date)} ~ ${md(e.end_date)}${e.all_day ? '' : ' (시간 지정)'}</span></div>
          <span class="ops-pill ${e.end_date < t ? '' : dayDiff(e.end_date) <= 3 ? 'ops-pill--warn' : 'ops-pill--info'}">${e.end_date < t ? '종료 → 정산 목록' : e.start_date > t ? '시작 ' + dLabel(e.start_date) : '종료 ' + dLabel(e.end_date)}</span>
        </div>`).join('') : '<p class="ops-empty">없음</p>'}</div>`).join('')}
      ${topic ? `<details class="ops-help"><summary>📱 휴대폰으로 마감 알림 받기</summary>
        <p>휴대폰에 <b>ntfy</b> 앱을 설치하고 아래 주제를 구독하면, 매일 아침 9시에 마감 3일 전부터의 알림 건수가 옵니다. (이름·금액은 보내지 않아요)</p>
        <code>${esc(topic)}</code></details>` : ''}
    </div>`;
  }

  // ---------- 인플루언서 정산 ----------
  function renderSettlements() {
    const el = document.getElementById('ops-settle');
    if (!el) return;
    if (!ready()) { el.innerHTML = loginCard(); return; }
    const t = todayStr();
    const isLate = (s) => (s.status === 'waiting' || s.status === 'amount') && s.due_date && s.due_date < t;
    const sel = S.setMonth;
    const scope = sel === 'all' ? S.settlements : S.settlements.filter((s) => gongguMonth(s) === sel);
    const sumOf = (list, k) => list.reduce((a, s) => a + Number(s[k] || 0), 0);
    // 월별 실적: 첫 공구 달 ~ 이번 달 (공구 시작일 기준, 기존 시트 대시보드와 같은 기준)
    const firstM = S.settlements.map(gongguMonth).filter(Boolean).sort()[0] || monthOf();
    const months = [];
    for (let m = monthOf(); m >= firstM; m = shiftMonth(m, -1)) months.push(m);
    const gross = sumOf(scope, 'gross_sales'), fee = sumOf(scope, 'my_fee');
    const best = scope.filter((s) => s.gross_sales != null).sort((a, b) => b.gross_sales - a.gross_sales).slice(0, 10);
    const open = scope.filter((s) => s.status !== 'done');
    const done = scope.filter((s) => s.status === 'done');
    const list = (S.setFilter === 'open' ? open : S.setFilter === 'done' ? done : scope).slice()
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || (b.end_date || '').localeCompare(a.end_date || ''));
    const late = S.settlements.filter(isLate);
    const removed = new Set(S.events.filter((e) => e.removed).map((e) => e.id));
    const chip = (k, label, n) => `<button class="btn-gonggu-filter${S.setFilter === k ? ' active' : ''}" data-ops="set-filter" data-k="${k}">${label} ${n}</button>`;
    const label = sel === 'all' ? '전체 기간' : sel;
    el.innerHTML = `
      <div class="ops-toolbar">
        <div class="ops-month">
          <button class="ops-btn ops-btn--icon" data-ops="set-month-shift" data-n="-1" aria-label="이전 달">◀</button>
          <input type="month" value="${sel === 'all' ? '' : sel}" data-ops-change="set-month" aria-label="조회 월">
          <button class="ops-btn ops-btn--icon" data-ops="set-month-shift" data-n="1" aria-label="다음 달">▶</button>
          <button class="ops-btn${sel === 'all' ? ' ops-btn--primary' : ''}" data-ops="set-month" data-m="all">전체 기간</button>
        </div>
        <span class="ops-muted">공구 시작일 기준</span>
      </div>
      <div class="ops-stats">
        <div class="ops-stat"><span>${label} 총매출</span><strong>${won(gross)}</strong></div>
        <div class="ops-stat"><span>벤더 수익</span><strong>${won(fee)}</strong></div>
        <div class="ops-stat"><span>진행 건수</span><strong>${scope.length}건</strong></div>
        <div class="ops-stat"><span>평균 수익률</span><strong>${gross ? ((fee / gross) * 100).toFixed(1) + '%' : '–'}</strong></div>
      </div>
      <div class="ops-two">
        <div class="panel-card ops-card">
          <div class="panel-header"><div class="panel-title"><span>📈</span><span>월별 실적</span></div></div>
          <div class="ops-table ops-table--4" role="table">
            <div class="ops-tr ops-th" role="row"><span>월</span><span>총매출</span><span>벤더 수익</span><span>진행 건수</span></div>
            ${months.map((m) => {
              const ms = S.settlements.filter((s) => gongguMonth(s) === m);
              return `<div class="ops-tr ops-tr--click${m === sel ? ' ops-tr--on' : ''}" role="row" data-ops="set-month" data-m="${m}">
                <span>${m}</span><span>${won(sumOf(ms, 'gross_sales'))}</span><span>${won(sumOf(ms, 'my_fee'))}</span><span>${ms.length}건</span></div>`;
            }).join('')}
          </div>
        </div>
        <div class="panel-card ops-card">
          <div class="panel-header"><div class="panel-title"><span>🏆</span><span>${label} BEST ${best.length}건 (총매출 순)</span></div></div>
          <div class="ops-table" role="table">
            <div class="ops-tr ops-th" role="row"><span>순위</span><span>인플루언서 · 상품</span><span>기간</span><span>총매출</span><span>벤더 수익</span></div>
            ${best.length ? best.map((s, i) => `<div class="ops-tr" role="row"><span>${i + 1}</span>
              <span><b>${esc(s.influencer)}</b><span class="ops-stamp">${esc([s.brand, s.product].filter(Boolean).join(' '))}</span></span>
              <span>${md(s.start_date || s.end_date)} ~ ${md(s.end_date)}</span><span>${won(s.gross_sales)}</span><span>${won(s.my_fee)}</span></div>`).join('')
            : '<p class="ops-empty">금액이 입력된 공구가 없어요.</p>'}
          </div>
        </div>
      </div>
      <div class="panel-card ops-card">
      <div class="panel-header"><div class="panel-title"><span>💸</span><span>${label} 정산 목록</span></div>
        <div class="gonggu-filter-bar" style="margin:0">${chip('open', '진행 중', open.length)}${chip('done', '완료', done.length)}${chip('all', '전체', scope.length)}</div></div>
      ${late.length ? `<div class="ops-note ops-note--bad">🔴 정산 예정일이 지났는데 입금 확인이 안 된 건 <b>${late.length}건</b>(전체 기간): ${late.map((s) => esc(s.title)).join(', ')}</div>` : ''}
      <p class="ops-muted">공구 종료일이 지나면 자동으로 "정산 대기"로 들어옵니다. 판매 총액은 여기에만 적고, 정산·매출 탭에는 내 수수료 매출만 넘어갑니다.</p>
      ${list.length ? list.map((s) => `<form class="ops-settle${isLate(s) ? ' ops-settle--late' : ''}" data-ops-form="settle" data-id="${s.id}">
        <div class="ops-settle-head"><b>${esc(s.title || [s.influencer, s.brand, s.product].join(' '))}</b>
          <span class="ops-muted">${s.start_date ? md(s.start_date) + ' ~ ' : '종료 '}${md(s.end_date)}${removed.has(s.event_id) ? ' · 캘린더에서 삭제된 일정' : ''}</span>
          <span class="ops-pill ops-pill--${s.status}">${SET_STATUS[s.status]}</span></div>
        <div class="ops-grid">
          ${field('정산 예정일', `<input type="date" name="due_date" value="${s.due_date || ''}">`)}
          ${field('판매 총액', `<input type="number" inputmode="numeric" step="1" name="gross_sales" value="${s.gross_sales ?? ''}">`)}
          ${field('판매 수량', `<input type="number" inputmode="numeric" step="1" min="0" name="quantity" value="${s.quantity ?? ''}">`)}
          ${field('인플루언서 수수료 (%)', `<input type="number" inputmode="decimal" step="0.1" min="0" max="100" name="influencer_rate" value="${s.influencer_rate ?? ''}">`)}
          ${field('정산 금액 (인플루언서 지급)', `<input type="number" inputmode="numeric" step="1" name="payout" value="${s.payout ?? ''}">`)}
          ${field('내 수수료 매출', `<input type="number" inputmode="numeric" step="1" name="my_fee" value="${s.my_fee ?? ''}">`)}
          ${field('지급·입금일', `<input type="date" name="paid_date" value="${s.paid_date || ''}">`)}
          ${field('상태', `<select name="status">${options(SET_STATUS, s.status)}</select>`)}
          <label class="ops-check"><input type="checkbox" name="is_individual"${s.is_individual ? ' checked' : ''}> 개인 (3.3% 원천징수)</label>
          ${field('메모', `<input name="memo" value="${esc(s.memo)}">`, true)}
        </div>
        <div class="ops-form-actions">${stamps(s)}<button type="submit" class="ops-btn ops-btn--primary">저장</button></div>
      </form>`).join('') : '<p class="ops-empty">해당하는 정산 건이 없어요.</p>'}
    </div>`;
  }

  // ---------- 상품 소싱 ----------
  function sourcingForm() {
    const r = S.editSourcing;
    if (!r) return '';
    return `<form class="ops-form" data-ops-form="sourcing">
      <div class="ops-form-title">${r.id ? '상품 수정' : '새 상품'}</div>
      <div class="ops-grid">
        ${field('카테고리', `<select name="category">${CATS.map((c) => `<option${c === (r.category || (S.srcCat !== '전체' ? S.srcCat : '건강')) ? ' selected' : ''}>${c}</option>`).join('')}</select>`)}
        ${field('상품명', `<input name="product" value="${esc(r.product)}" required>`)}
        ${field('브랜드명', `<input name="brand" value="${esc(r.brand)}">`)}
        ${field('URL', `<input name="url" type="url" value="${esc(r.url)}" placeholder="https://">`, true)}
        ${field('이메일', `<input name="email" type="email" value="${esc(r.email)}">`)}
        ${field('전화', `<input name="phone" type="tel" value="${esc(r.phone)}">`)}
        ${field('외 연락 경로', `<input name="other_contact" value="${esc(r.other_contact)}" placeholder="인스타 DM, 카카오 채널 등">`)}
        ${field('제안 날짜', `<input type="date" name="proposed_date" value="${r.proposed_date || ''}">`)}
        ${field('진행 단계', `<select name="stage">${options(STAGES, r.stage || 'proposed')}</select>`)}
        ${field('후속 연락일', `<input type="date" name="follow_up_date" value="${r.follow_up_date || ''}">`)}
        ${field('메모', `<input name="memo" value="${esc(r.memo)}">`, true)}
      </div>
      <div class="ops-form-actions"><button type="button" class="ops-btn" data-ops="src-cancel">취소</button><button type="submit" class="ops-btn ops-btn--primary">저장</button></div>
    </form>`;
  }
  function renderSourcing() {
    const el = document.getElementById('ops-sourcing');
    if (!el) return;
    if (!ready()) { el.innerHTML = loginCard(); return; }
    // 위(카테고리)·아래(단계) 필터가 서로의 숫자에 반영되도록 교차 집계한다
    const byCat = S.srcCat === '전체' ? S.sourcing : S.sourcing.filter((r) => r.category === S.srcCat);
    const byStage = S.srcStage === '전체' ? S.sourcing : S.sourcing.filter((r) => r.stage === S.srcStage);
    const list = (S.srcStage === '전체' ? byCat : byCat.filter((r) => r.stage === S.srcStage)).slice()
      .sort((a, b) => (a.follow_up_date || '9999').localeCompare(b.follow_up_date || '9999'));
    const chip = (k, cur, act, label, n) => `<button class="btn-gonggu-filter${cur === k ? ' active' : ''}" data-ops="${act}" data-k="${k}">${label}${n == null ? '' : ' ' + n}</button>`;
    el.innerHTML = `<div class="panel-card ops-card">
      <div class="panel-header"><div class="panel-title"><span>🔎</span><span>상품 소싱</span></div>
        <button class="ops-btn ops-btn--primary" data-ops="src-new">+ 상품 추가</button></div>
      <div class="gonggu-filter-bar ops-wrap">${chip('전체', S.srcCat, 'src-cat', '전체', byStage.length)}${CATS.map((c) => chip(c, S.srcCat, 'src-cat', c, byStage.filter((r) => r.category === c).length)).join('')}</div>
      <div class="gonggu-filter-bar ops-wrap">${chip('전체', S.srcStage, 'src-stage', '모든 단계', byCat.length)}${Object.entries(STAGES).map(([k, v]) => chip(k, S.srcStage, 'src-stage', v, byCat.filter((r) => r.stage === k).length)).join('')}</div>
      ${sourcingForm()}
      ${list.length ? list.map((r) => {
        const url = safeUrl(r.url);
        const follow = r.follow_up_date && r.stage !== 'confirmed' && r.stage !== 'hold';
        return `<div class="ops-row">
          <div class="ops-row-main"><span class="ops-chip">${esc(r.category)}</span>
            ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(r.product)}</b> ↗</a>` : `<b>${esc(r.product)}</b>`} <span class="ops-muted">${esc(r.brand)}</span>
            <span class="ops-muted">${[r.email, r.phone, r.other_contact].filter(Boolean).map(esc).join(' · ') || '연락처 없음'}</span>
            <span class="ops-muted">제안 ${md(r.proposed_date)}${r.memo ? ' · ' + esc(r.memo) : ''}</span></div>
          <div class="ops-row-nums"><select data-ops-change="stage" data-id="${r.id}" aria-label="진행 단계">${options(STAGES, r.stage)}</select>
            ${follow ? `<span class="ops-pill ${dayDiff(r.follow_up_date) < 0 ? 'ops-pill--bad' : dayDiff(r.follow_up_date) <= 3 ? 'ops-pill--warn' : ''}">후속 ${md(r.follow_up_date)} · ${dLabel(r.follow_up_date)}</span>` : ''}</div>
          <div class="ops-row-actions"><button class="ops-btn" data-ops="src-edit" data-id="${r.id}">수정</button>
            <button class="ops-btn ops-btn--danger" data-ops="src-del" data-id="${r.id}">삭제</button></div></div>`;
      }).join('') : '<p class="ops-empty">해당하는 상품이 없어요.</p>'}
    </div>`;
  }

  // ---------- 원천징수 ----------
  function withholdingMonths() {
    // 원천징수_신고리스트처럼 "공구 진행 월(시작일)"로 묶고, 인원은 활동명 기준 사람 수 (2026-11-26 원진님 확정)
    const map = {};
    S.settlements.filter((s) => s.is_individual && gongguMonth(s)).forEach((s) => {
      const m = gongguMonth(s);
      map[m] = map[m] || { names: new Set(), payout: 0 };
      map[m].names.add(s.influencer || s.title);
      map[m].payout += Number(s.payout || 0);
    });
    const cur = monthOf();
    [cur, shiftMonth(cur, -1)].forEach((m) => { map[m] = map[m] || { names: new Set(), payout: 0 }; });
    const sheet = Object.fromEntries(S.withholding.filter((w) => w.sheet_synced_at).map((w) => [w.month.slice(0, 7), w]));
    // 2026-11부터만 보여 준다(원진님 확정). 시트 값(매달 말일 예약 작업이 저장)이 있으면 그 값을, 없으면 정산금 ÷ 1.1 계산값을 쓴다
    return Object.keys(map).filter((m) => m >= WH_FROM).sort().reverse().map((m) => sheet[m]
      ? { month: m, people: sheet[m].people, names: sheet[m].names || [], total: sheet[m].total, src: '시트 ' + kstDay(sheet[m].sheet_synced_at) }
      : { month: m, people: map[m].names.size, names: [...map[m].names], total: Math.round(map[m].payout / 1.1), src: '대시보드 계산' });
  }
  function renderWithholding() {
    const el = document.getElementById('ops-withholding');
    if (!el) return;
    if (!ready()) { el.innerHTML = loginCard(); return; }
    const filed = Object.fromEntries(S.withholding.map((w) => [w.month.slice(0, 7), w]));
    const t = todayStr();
    el.innerHTML = `<div class="panel-card ops-card">
      <div class="panel-header"><div class="panel-title"><span>🧮</span><span>원천징수</span></div></div>
      <p class="ops-muted">매달 말일 밤 구글 드라이브 "원천징수_신고리스트.xlsx"의 해당 월 시트를 불러와 인원·지급액을 표시합니다. 아직 불러오기 전인 달은 인플루언서 정산의 "개인 (3.3%)" 체크 건을 <b>공구 진행 월</b>로 모아 계산합니다. 신고는 다음 달 10일까지 홈택스에서 직접 해 주세요.
      주민등록번호 같은 개인정보는 구글 드라이브 "원천징수_신고리스트.xlsx"에만 둡니다.</p>
      <div class="ops-table" role="table">
        <div class="ops-tr ops-th" role="row"><span>공구 월</span><span>대상 인원</span><span>지급액</span><span>신고 기한</span><span>신고 완료</span></div>
        ${withholdingMonths().map((w) => {
          const due = shiftMonth(w.month, 1) + '-10';
          const done = !!(filed[w.month] && filed[w.month].filed);
          const bad = !done && w.people > 0 && due < t;
          return `<div class="ops-tr${bad ? ' ops-tr--bad' : ''}" role="row"><span>${w.month}</span><span>${w.people}명${w.people ? `<span class="ops-stamp">${w.names.map(esc).join(', ')}</span>` : ''}</span><span>${won(w.total)}<span class="ops-stamp">${w.src}</span></span>
            <span>${md(due)}${done ? '' : ' · ' + dLabel(due)}</span>
            <label class="ops-check"><input type="checkbox" data-ops-change="filed" data-month="${w.month}"${done ? ' checked' : ''}> 완료${done && filed[w.month].filed_at ? ' (' + kstDay(filed[w.month].filed_at) + ')' : ''}</label></div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // ---------- 공동구매 하위 메뉴 ----------
  function renderSubnav() {
    document.querySelectorAll('#ops-gonggu-subnav [data-sub]').forEach((b) => b.classList.toggle('active', b.dataset.sub === S.sub));
    document.querySelectorAll('#gonggu-view .ops-sub').forEach((p) => { p.hidden = p.dataset.sub !== S.sub; });
    const late = S.settlements.filter((s) => (s.status === 'waiting' || s.status === 'amount') && s.due_date && s.due_date < todayStr()).length;
    const badge = document.getElementById('ops-settle-badge');
    if (badge) { badge.hidden = !(ready() && late); badge.textContent = ready() && late ? late : ''; }
  }
  function setSub(sub) {
    S.sub = sub;
    lsSet(SUB_KEY, sub);
    renderSubnav();
    if (sub === 'dm' && typeof renderGongguCampaign === 'function') renderGongguCampaign();
  }

  function renderAll() {
    renderAlerts(); renderSales(); renderEvents(); renderSettlements(); renderSourcing(); renderWithholding(); renderSubnav();
  }

  // ---------- 이벤트 ----------
  const formData = (f) => Object.fromEntries(new FormData(f).entries());

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-ops]');
    if (!btn) return;
    const { ops: a, id } = btn.dataset;
    if (a === 'logout') return logout();
    if (a === 'goto') { if (window.switchNavView) window.switchNavView('gonggu-view'); return setSub(btn.dataset.sub); }
    if (a === 'month') { S.month = shiftMonth(S.month, Number(btn.dataset.n)); return renderSales(); }
    if (a === 'month-now') { S.month = monthOf(); return renderSales(); }
    if (a === 'rev-new') { S.editRevenue = { month: firstDay(S.month) }; return renderSales(); }
    if (a === 'rev-cancel') { S.editRevenue = null; return renderSales(); }
    if (a === 'rev-edit') { S.editRevenue = Object.assign({}, S.revenue.find((r) => r.id === id)); return renderSales(); }
    if (a === 'rev-from') {
      const s = S.settlements.find((x) => x.id === id);
      S.editRevenue = { settlement_id: s.id, business: 'gonggu', month: firstDay(monthOf(s.paid_date || s.end_date)), title: '공구 매출 · ' + (s.title || ''), revenue: s.my_fee };
      return renderSales();
    }
    if (a === 'rev-skip') return act(() => patch('ops_settlements', id, { revenue_skipped: true }), '건너뛰었어요.');
    if (a === 'rev-del') { if (confirm('이 매출 입력을 삭제할까요? 되돌릴 수 없습니다.')) act(() => remove('ops_revenue', id), '삭제했어요.'); return; }
    if (a === 'set-filter') { S.setFilter = btn.dataset.k; return renderSettlements(); }
    if (a === 'set-month') { S.setMonth = btn.dataset.m; return renderSettlements(); }
    if (a === 'set-month-shift') { S.setMonth = shiftMonth(S.setMonth === 'all' ? monthOf() : S.setMonth, Number(btn.dataset.n)); return renderSettlements(); }
    if (a === 'src-cat') { S.srcCat = btn.dataset.k; return renderSourcing(); }
    if (a === 'src-stage') { S.srcStage = btn.dataset.k; return renderSourcing(); }
    if (a === 'src-new') { S.editSourcing = {}; return renderSourcing(); }
    if (a === 'src-cancel') { S.editSourcing = null; return renderSourcing(); }
    if (a === 'src-edit') { S.editSourcing = Object.assign({}, S.sourcing.find((r) => r.id === id)); return renderSourcing(); }
    if (a === 'src-del') { if (confirm('이 소싱 상품을 삭제할까요? 되돌릴 수 없습니다.')) act(() => remove('ops_sourcing', id), '삭제했어요.'); return; }
    if (a === 'sync') {
      btn.disabled = true; btn.textContent = '동기화 중…';
      call(FN_SYNC, { method: 'POST', body: {} })
        .then((r) => showToast(r.ok ? `일정 ${r.count}건 확인 · 새 정산 대기 ${r.created}건` : '동기화 실패: ' + r.error))
        .catch((e) => showToast('동기화 실패: ' + e.message.slice(0, 80)))
        .finally(() => loadAll(true));
      return;
    }
    if (a === 'sub') return setSub(btn.dataset.sub);
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-ops-change]');
    if (!el) return;
    const kind = el.dataset.opsChange;
    if (kind === 'month' && el.value) { S.month = el.value; return renderSales(); }
    if (kind === 'set-month' && el.value) { S.setMonth = el.value; return renderSettlements(); }
    if (kind === 'stage') return act(() => patch('ops_sourcing', el.dataset.id, { stage: el.value }), '진행 단계를 바꿨어요.');
    if (kind === 'filed') {
      return act(() => upsert('ops_withholding', 'month', { month: firstDay(el.dataset.month), filed: el.checked, filed_at: el.checked ? new Date().toISOString() : null }),
        el.checked ? '신고 완료로 표시했어요.' : '신고 완료를 해제했어요.');
    }
  });

  document.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-ops-form]');
    if (!f) return;
    ev.preventDefault();
    const d = formData(f);
    const kind = f.dataset.opsForm;
    if (kind === 'login') {
      const b = f.querySelector('button[type=submit]');
      b.disabled = true;
      try { await login(d.email.trim(), d.password); S.owner = null; await loadAll(true); showToast('로그인했어요.'); }
      catch (e) { showToast(e.message); b.disabled = false; }
      return;
    }
    if (kind === 'target') {
      return act(() => upsert('ops_targets', 'month', { month: firstDay(S.month), target_net: num(d.target) || 0 }), '목표 순수익을 저장했어요.');
    }
    if (kind === 'revenue') {
      const r = S.editRevenue || {};
      const row = { month: firstDay(d.month), business: d.business, title: d.title.trim(), revenue: num(d.revenue), net_profit: num(d.net_profit) };
      return act(async () => {
        if (r.id) await patch('ops_revenue', r.id, row);
        else await insert('ops_revenue', Object.assign(row, r.settlement_id ? { settlement_id: r.settlement_id } : {}));
        S.editRevenue = null;
        S.month = d.month;
      }, '저장했어요.');
    }
    if (kind === 'settle') {
      const s = S.settlements.find((x) => x.id === f.dataset.id);
      const row = {
        due_date: d.due_date || null, gross_sales: num(d.gross_sales), payout: num(d.payout), my_fee: num(d.my_fee),
        quantity: num(d.quantity), influencer_rate: d.influencer_rate === '' ? null : Number(d.influencer_rate),
        paid_date: d.paid_date || null, status: d.status, is_individual: !!d.is_individual, memo: d.memo.trim(),
      };
      // 금액을 넣으면 "금액 입력"으로, 입금 확인·완료인데 날짜가 없으면 오늘로 채운다
      if (row.status === 'waiting' && (row.gross_sales != null || row.payout != null || row.my_fee != null)) row.status = 'amount';
      if ((row.status === 'paid' || row.status === 'done') && !row.paid_date) row.paid_date = todayStr();
      const toRevenue = row.status === 'done' && s.status !== 'done';
      return act(() => patch('ops_settlements', s.id, row), toRevenue ? "저장했어요. 정산·매출 탭에 '공구 매출' 확인 대기가 생겼어요." : '저장했어요.');
    }
    if (kind === 'sourcing') {
      const r = S.editSourcing || {};
      const row = {
        category: d.category, product: d.product.trim(), url: d.url.trim(), brand: d.brand.trim(), email: d.email.trim(), phone: d.phone.trim(),
        other_contact: d.other_contact.trim(), proposed_date: d.proposed_date || null, stage: d.stage, follow_up_date: d.follow_up_date || null, memo: d.memo.trim(),
      };
      return act(async () => { r.id ? await patch('ops_sourcing', r.id, row) : await insert('ops_sourcing', row); S.editSourcing = null; }, '저장했어요.');
    }
  });

  // app.js 의 화면 전환에서 호출된다
  window.opsOnView = (viewId) => {
    if (viewId === 'sales-view' || viewId === 'gonggu-view') loadAll(false);
  };

  function init() { renderAll(); loadAll(true); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
