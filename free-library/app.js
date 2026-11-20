(function () {
  var DATA_URL = "https://dnjswls1540-stack.github.io/Jeegong/free-library/data.json";
  var mount = document.getElementById("jpnLibRoot");
  if (!mount) return;

  var css = [
    "#jpnLibRoot{--bg:#0D0D0D;--fg:#F4F3EE;--muted:#A09F9A;--coral:#ED6F63;--light:#EBEAE4;--card:#141414;--line:rgba(244,243,238,0.14);--line2:rgba(244,243,238,0.24);",
    "  font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
    "  background:var(--bg);color:var(--fg);padding:72px 24px 96px;box-sizing:border-box;min-height:72vh;word-break:keep-all;-webkit-font-smoothing:antialiased;}",
    "#jpnLibRoot *{box-sizing:border-box;}",
    "#jpnLibRoot .wrap{max-width:960px;margin:0 auto;}",
    "#jpnLibRoot .hero-title{font-size:48px;font-weight:600;line-height:1.18;letter-spacing:-0.04em;color:var(--fg);margin:0 0 18px;}",
    "#jpnLibRoot .hero-lead{font-size:18px;font-weight:400;line-height:1.68;letter-spacing:-0.025em;color:var(--muted);margin:0;}",
    "#jpnLibRoot .cat-cards{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:44px;}",
    "#jpnLibRoot .cat-card{display:flex;flex-direction:column;justify-content:space-between;min-height:220px;padding:28px 28px 26px;border-radius:4px;text-decoration:none;transition:transform .16s ease,opacity .16s ease;}",
    "#jpnLibRoot .cat-card:hover{transform:translateY(-2px);}",
    "#jpnLibRoot .cat-card.coral{background:var(--coral);color:#0D0D0D;}",
    "#jpnLibRoot .cat-card.light{background:var(--light);color:#0D0D0D;}",
    "#jpnLibRoot .cat-card-top{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;font-weight:600;letter-spacing:-0.01em;opacity:.78;}",
    "#jpnLibRoot .cat-card-mid{margin:24px 0 26px;}",
    "#jpnLibRoot .cat-card h2{font-size:26px;font-weight:700;line-height:1.28;letter-spacing:-0.03em;margin:0 0 8px;color:inherit;}",
    "#jpnLibRoot .cat-card p{font-size:15px;line-height:1.58;letter-spacing:-0.02em;margin:0;opacity:.8;}",
    "#jpnLibRoot .cat-card-cta{font-size:14.5px;font-weight:700;letter-spacing:-0.02em;display:inline-flex;align-items:center;gap:6px;}",
    "#jpnLibRoot .topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:28px;}",
    "#jpnLibRoot .back{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--line2);border-radius:4px;background:transparent;color:var(--fg);font-size:13.5px;font-weight:600;letter-spacing:-0.02em;text-decoration:none;cursor:pointer;}",
    "#jpnLibRoot .back:hover{border-color:var(--coral);color:var(--coral);}",
    "#jpnLibRoot .switch-tabs{display:flex;gap:8px;flex-wrap:wrap;}",
    "#jpnLibRoot .stab{padding:8px 14px;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--muted);font-size:13.5px;font-weight:600;letter-spacing:-0.02em;text-decoration:none;}",
    "#jpnLibRoot .stab:hover{color:var(--fg);border-color:var(--line2);}",
    "#jpnLibRoot .stab.on{background:var(--fg);border-color:var(--fg);color:#0D0D0D;}",
    "#jpnLibRoot .search-box{display:block;position:relative;margin:28px 0 22px;}",
    "#jpnLibRoot .search-input{display:block;width:100%;background:var(--card);border:1px solid var(--line);border-radius:4px;padding:14px 16px;color:var(--fg);font-size:15px;letter-spacing:-0.02em;font-family:inherit;outline:none;}",
    "#jpnLibRoot .search-input:focus{border-color:var(--coral);}",
    "#jpnLibRoot .search-input::placeholder{color:#6E6D68;}",
    "#jpnLibRoot .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}",
    "#jpnLibRoot .card{display:flex;flex-direction:column;justify-content:space-between;background:var(--card);border:1px solid var(--line);border-radius:4px;padding:24px;text-decoration:none;color:inherit;transition:border-color .15s ease;}",
    "#jpnLibRoot .card:hover{border-color:var(--coral);}",
    "#jpnLibRoot .card-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;font-weight:600;color:var(--muted);letter-spacing:-0.01em;margin-bottom:14px;}",
    "#jpnLibRoot .card-idx{color:var(--coral);}",
    "#jpnLibRoot .card h3{font-size:19px;font-weight:600;line-height:1.38;letter-spacing:-0.025em;color:var(--fg);margin:0 0 8px;}",
    "#jpnLibRoot .card p{font-size:14.5px;line-height:1.58;letter-spacing:-0.02em;color:var(--muted);margin:0 0 20px;}",
    "#jpnLibRoot .card-go{font-size:13.5px;font-weight:600;color:var(--coral);letter-spacing:-0.01em;}",
    "#jpnLibRoot .empty{padding:48px 20px;text-align:center;color:var(--muted);border:1px solid var(--line);border-radius:4px;font-size:15px;}",
    /* 상세 뷰 */
    "#jpnLibRoot .doc-wrap{max-width:780px;margin:0 auto;}",
    "#jpnLibRoot .doc-title{font-size:40px;font-weight:600;line-height:1.22;letter-spacing:-0.04em;color:var(--fg);margin:0 0 16px;}",
    "#jpnLibRoot .doc-lead{font-size:17.5px;line-height:1.68;letter-spacing:-0.025em;color:var(--muted);margin:0;}",
    "#jpnLibRoot .byline{font-size:13px;color:#787772;margin:14px 0 0;letter-spacing:-0.01em;}",
    "#jpnLibRoot .cta-top{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px;}",
    "#jpnLibRoot .btn{display:inline-block;padding:13px 22px;border-radius:4px;background:var(--coral);color:#0D0D0D;font-weight:700;font-size:14.5px;letter-spacing:-0.02em;text-decoration:none;text-align:center;}",
    "#jpnLibRoot .btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line2);}",
    "#jpnLibRoot .btn.ghost:hover{border-color:var(--fg);}",
    "#jpnLibRoot h2.sec{font-size:24px;font-weight:600;line-height:1.3;letter-spacing:-0.03em;margin:52px 0 8px;color:var(--fg);}",
    "#jpnLibRoot .sec-desc{font-size:15px;line-height:1.65;letter-spacing:-0.02em;color:var(--muted);margin:0 0 20px;}",
    "#jpnLibRoot table.toc{width:100%;border-collapse:collapse;margin-top:14px;font-size:14.5px;letter-spacing:-0.015em;}",
    "#jpnLibRoot table.toc th,#jpnLibRoot table.toc td{border-bottom:1px solid var(--line);padding:13px 10px;text-align:left;vertical-align:top;line-height:1.55;}",
    "#jpnLibRoot table.toc th{color:var(--muted);font-weight:600;font-size:12.5px;}",
    "#jpnLibRoot table.toc td:first-child{white-space:nowrap;color:var(--fg);font-weight:600;}",
    "#jpnLibRoot .step{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:26px 24px;margin-top:16px;}",
    "#jpnLibRoot .step .num{display:inline-block;width:auto;background:none;border:0;padding:0;color:var(--coral);font-size:12px;font-weight:700;letter-spacing:0.08em;margin-bottom:8px;white-space:nowrap;}",
    "#jpnLibRoot .step h3{font-size:19px;font-weight:600;line-height:1.38;letter-spacing:-0.025em;margin:0 0 14px;color:var(--fg);}",
    "#jpnLibRoot .step ul{margin:0 0 18px;padding-left:18px;color:#D6D5D0;font-size:15px;line-height:1.75;letter-spacing:-0.02em;}",
    "#jpnLibRoot .step ul b{color:var(--fg);}",
    "#jpnLibRoot .prompt-label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;}",
    "#jpnLibRoot .prompt-label span{font-size:12.5px;color:var(--muted);font-weight:600;}",
    "#jpnLibRoot button.copy{border:1px solid var(--line2);background:#1C1C1E;color:var(--fg);font-size:12px;font-weight:600;padding:6px 12px;border-radius:4px;cursor:pointer;font-family:inherit;}",
    "#jpnLibRoot button.copy:hover{border-color:var(--coral);color:var(--coral);}",
    "#jpnLibRoot pre{margin:0;background:#080808;border:1px solid var(--line);border-radius:4px;padding:16px;white-space:pre-wrap;word-break:break-word;color:#DEDDD8;font-size:13.5px;line-height:1.72;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
    "#jpnLibRoot .point{border-left:2px solid var(--coral);padding:2px 0 2px 14px;margin-top:18px;color:var(--muted);font-size:14px;line-height:1.68;letter-spacing:-0.02em;}",
    "#jpnLibRoot .point b{color:var(--fg);}",
    "#jpnLibRoot .rule{border-left:3px solid var(--coral);background:var(--card);border-top:1px solid var(--line);border-right:1px solid var(--line);border-bottom:1px solid var(--line);border-radius:4px;padding:24px;margin-top:18px;}",
    "#jpnLibRoot .rule h3{font-size:18.5px;font-weight:600;margin:0 0 10px;color:var(--fg);letter-spacing:-0.025em;}",
    "#jpnLibRoot .rule p{margin:0;color:#D6D5D0;font-size:15px;line-height:1.72;letter-spacing:-0.02em;}",
    "#jpnLibRoot .rule b{color:var(--coral);}",
    "#jpnLibRoot .tip{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:18px 20px;margin-top:16px;color:#C8C7C2;font-size:14.5px;line-height:1.7;letter-spacing:-0.02em;}",
    "#jpnLibRoot .links{margin-top:14px;display:grid;gap:8px;}",
    "#jpnLibRoot .links a{display:flex;align-items:center;gap:14px;text-decoration:none;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:4px;padding:15px 18px;font-size:15px;font-weight:600;letter-spacing:-0.02em;}",
    "#jpnLibRoot .links a span{font-size:12px;color:var(--coral);font-weight:700;min-width:20px;}",
    "#jpnLibRoot .links a:hover{border-color:var(--coral);color:var(--coral);}",
    "#jpnLibRoot .foot{margin-top:44px;color:#6E6D68;font-size:12.5px;line-height:1.7;border-top:1px solid var(--line);padding-top:18px;}",
    "@media (max-width:720px){",
    "  #jpnLibRoot{padding:44px 18px 68px;}",
    "  #jpnLibRoot .pc-only{display:none;}",
    "  #jpnLibRoot .hero-title{font-size:30px;line-height:1.28;letter-spacing:-0.035em;margin-bottom:14px;}",
    "  #jpnLibRoot .hero-lead{font-size:15px;line-height:1.65;letter-spacing:-0.02em;}",
    "  #jpnLibRoot .cat-cards{grid-template-columns:1fr;gap:12px;margin-top:30px;}",
    "  #jpnLibRoot .cat-card{min-height:168px;padding:22px 20px;}",
    "  #jpnLibRoot .cat-card-mid{margin:16px 0 18px;}",
    "  #jpnLibRoot .cat-card h2{font-size:21px;}",
    "  #jpnLibRoot .cat-card p{font-size:14px;}",
    "  #jpnLibRoot .grid{grid-template-columns:1fr;gap:12px;}",
    "  #jpnLibRoot .card{padding:20px 18px;}",
    "  #jpnLibRoot .card h3{font-size:17.5px;}",
    "  #jpnLibRoot .doc-title{font-size:27px;line-height:1.28;}",
    "  #jpnLibRoot .doc-lead{font-size:15px;}",
    "  #jpnLibRoot h2.sec{font-size:20px;margin-top:40px;}",
    "  #jpnLibRoot .step,#jpnLibRoot .rule{padding:20px 16px;}",
    "  #jpnLibRoot table.toc th:nth-child(2),#jpnLibRoot table.toc td:nth-child(2){display:none;}",
    "  #jpnLibRoot .btn{display:block;width:100%;}",
    "}"
  ].join("\n");

  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var state = { data: null, q: "" };

  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function parseHash() {
    var h = (location.hash || "").replace(/^#/, "");
    if (h.indexOf("g-") === 0) return { mode: "detail", id: h.slice(2) };
    if (h === "gonggu" || h === "ai") return { mode: "cat", cat: h };
    return { mode: "home" };
  }

  function bindCopy(container) {
    var btns = container.querySelectorAll("button.copy");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        var el = document.getElementById(this.getAttribute("data-copy"));
        if (!el) return;
        var txt = el.innerText;
        var b = this;
        function done() { b.textContent = "복사됨"; setTimeout(function () { b.textContent = "복사"; }, 1600); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(done, legacy);
        } else { legacy(); }
        function legacy() {
          var ta = document.createElement("textarea");
          ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); done(); } catch (e) {}
          document.body.removeChild(ta);
        }
      });
    }
  }

  function renderHome() {
    var d = state.data;
    var html = '<div class="wrap">';
    html += '<h1 class="hero-title">' + d.hero.title + '</h1>';
    html += '<p class="hero-lead">' + d.hero.lead + '</p>';
    html += '<div class="cat-cards">';
    for (var i = 0; i < d.categories.length; i++) {
      var cat = d.categories[i];
      var cnt = d.items.filter(function (it) { return it.category === cat.id; }).length;
      html += '<a class="cat-card ' + esc(cat.theme || "coral") + '" href="#' + esc(cat.id) + '">';
      html += '<div class="cat-card-top"><span>' + cnt + '개 자료</span><span>@jeegongpaynote</span></div>';
      html += '<div class="cat-card-mid"><h2>' + esc(cat.name) + '</h2><p>' + esc(cat.desc) + '</p></div>';
      html += '<div class="cat-card-cta">자료 보러 가기 →</div>';
      html += '</a>';
    }
    html += '</div></div>';
    mount.innerHTML = html;
  }

  function renderCategory(catId) {
    var d = state.data;
    var cat = d.categories.filter(function (c) { return c.id === catId; })[0] || d.categories[0];
    var q = state.q.trim().toLowerCase();
    var list = d.items.filter(function (it) {
      if (it.category !== cat.id) return false;
      if (!q) return true;
      return (it.title + " " + it.summary + " " + (it.kind || "")).toLowerCase().indexOf(q) !== -1;
    });

    var html = '<div class="wrap">';
    html += '<div class="topbar">';
    html += '<a class="back" href="#free">← 전체 카테고리</a>';
    html += '<div class="switch-tabs">';
    for (var i = 0; i < d.categories.length; i++) {
      var c = d.categories[i];
      var cnt = d.items.filter(function (it) { return it.category === c.id; }).length;
      html += '<a class="stab' + (c.id === cat.id ? " on" : "") + '" href="#' + esc(c.id) + '">' + esc(c.name) + ' · ' + cnt + '</a>';
    }
    html += '</div></div>';

    html += '<h1 class="hero-title">' + esc(cat.name) + '</h1>';
    html += '<p class="hero-lead">' + esc(cat.desc) + '</p>';

    html += '<div class="search-box"><input class="search-input" id="jpnSearch" type="search" placeholder="자료 제목이나 키워드로 검색..." value="' + esc(state.q) + '"></div>';

    if (!list.length) {
      html += '<div class="empty">검색 조건에 맞는 자료가 없습니다.</div>';
    } else {
      html += '<div class="grid">';
      for (var j = 0; j < list.length; j++) {
        var it = list[j];
        var href = it.type === "article" ? ("#g-" + encodeURIComponent(it.id)) : esc(it.url);
        var target = it.type === "article" ? "" : ' target="_blank" rel="noopener"';
        html += '<a class="card" href="' + href + '"' + target + '>';
        html += '<div>';
        html += '<div class="card-meta"><span class="card-idx">' + pad2(j + 1) + '</span><span>' + esc(it.kind || "자료") + '</span></div>';
        html += '<h3>' + esc(it.title) + '</h3>';
        html += '<p>' + esc(it.summary) + '</p>';
        html += '</div>';
        html += '<div class="card-go">' + esc(it.cta || "자료 열기 →") + '</div>';
        html += '</a>';
      }
      html += '</div>';
    }
    html += '</div>';
    mount.innerHTML = html;

    var sInput = document.getElementById("jpnSearch");
    if (sInput) {
      sInput.addEventListener("input", function () {
        state.q = this.value;
        var pos = this.selectionStart;
        renderCategory(catId);
        var el = document.getElementById("jpnSearch");
        if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} }
      });
    }
  }

  function renderDetail(item) {
    var html = '<div class="doc-wrap">';
    html += '<div class="topbar"><a class="back" href="#' + esc(item.category || "free") + '">← 목록으로</a></div>';
    html += '<h1 class="doc-title">' + esc(item.title) + '</h1>';
    if (item.lead) html += '<p class="doc-lead">' + item.lead + '</p>';
    if (item.byline) html += '<p class="byline">' + esc(item.byline) + '</p>';
    html += (item.articleHtml || "");
    html += '<p class="foot">© 지공의 페이노트 · jeegongpaynote.co.kr</p>';
    html += '</div>';
    mount.innerHTML = html;
    bindCopy(mount);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    if (!state.data) return;
    var r = parseHash();
    if (r.mode === "detail") {
      var found = state.data.items.filter(function (it) { return it.id === r.id && it.type === "article"; })[0];
      if (found) { renderDetail(found); return; }
    }
    if (r.mode === "cat") { renderCategory(r.cat); return; }
    state.q = "";
    renderHome();
  }

  window.addEventListener("hashchange", render);

  mount.innerHTML = '<div class="wrap"><p class="hero-lead">자료를 불러오는 중입니다...</p></div>';
  fetch(DATA_URL + "?v=" + Math.floor(Date.now() / 60000), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (json) { state.data = json; render(); })
    .catch(function () {
      mount.innerHTML = '<div class="wrap"><p class="hero-lead">자료를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p></div>';
    });
})();
