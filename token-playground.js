/* Agent Dashboard — 设计令牌游乐场
 * 加载真实 styles.css，渲染代表性组件，实时编辑所有 --ad-* 设计变量（深色/浅色两套），
 * 一键导出可替换 styles.css 变量块的 CSS。纯前端、无依赖，双击 token-playground.html 使用。
 */
(function () {
  'use strict';

  // 从 styles.css 提取并固化的两套变量块（含非变量声明，导出时整体替换）。
  var DARK_BLOCK = [
    '.agent-dashboard {',
    '  --ad-bg:          #0F1014;',
    '  --ad-s1:          #16181F;',
    '  --ad-s2:          #1D2029;',
    '  --ad-s3:          #252934;',
    '  --ad-h1:          #1F232E;',
    '  --ad-h2:          #262B38;',
    '  --ad-hair:        rgba(255,255,255,0.045);',
    '  --ad-line:        rgba(255,255,255,0.08);',
    '  --ad-line-s:      rgba(255,255,255,0.14);',
    '  --ad-text:        #E8E6E0;',
    '  --ad-text-mute:   #92959E;',
    '  --ad-text-dim:    #5E6068;',
    '  --ad-accent:      #7BA7FF;',
    '  --ad-accent-dim:  rgba(123,167,255,0.18);',
    '  --ad-accent-2:    #A78BFA;',
    '  --ad-warn:        #E8A37C;',
    '  --ad-danger:      #E07F87;',
    '  --ad-success:     #93C49A;',
    '  --ad-hm-0:        #1A1D24;',
    '  --ad-hm-1:        #232A3C;',
    '  --ad-hm-2:        #344168;',
    '  --ad-hm-3:        #4E66A0;',
    '  --ad-hm-4:        #7BA7FF;',
    '  --ad-r1: 4px; --ad-r2: 6px; --ad-r3: 10px;',
    '  --ad-on-accent:  #0F1014;',
    '  --ad-banner-ar:  16 / 2.5;',
    '',
    '  /* base */',
    '  position: relative;',
    '  background-color: var(--ad-on-accent);',
    '  background-image:',
    '    linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),',
    '    linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);',
    '  background-size: 14px 14px;',
    '  background-position: -1px -1px;',
    '  color: var(--ad-text);',
    '  font-family: var(--font-interface, var(--font-interface-default, system-ui, sans-serif));',
    '  font-size: 13px;',
    '  line-height: 1.45;',
    '  -webkit-font-smoothing: antialiased;',
    '  width: 100%;',
    '  height: 100%;',
    '  overflow-y: auto;',
    '  padding: 22px 28px 60px;',
    '  margin: 0 auto;',
    '}'
  ].join('\n');

  var LIGHT_BLOCK = [
    '.agent-dashboard[data-theme="light"] {',
    '  --ad-bg:          #F5F5F7;',
    '  --ad-s1:          #FFFFFF;',
    '  --ad-s2:          #F0F0F3;',
    '  --ad-s3:          #E8E8EC;',
    '  --ad-h1:          #F0F0F3;',
    '  --ad-h2:          #E4E4E9;',
    '  --ad-hair:        rgba(0,0,0,0.05);',
    '  --ad-line:        rgba(0,0,0,0.09);',
    '  --ad-line-s:      rgba(0,0,0,0.16);',
    '  --ad-text:        #1A1A2E;',
    '  --ad-text-mute:   #6B6B7B;',
    '  --ad-text-dim:    #9A9AA8;',
    '  --ad-accent:      #3B6FE0;',
    '  --ad-accent-dim:  rgba(59,111,224,0.12);',
    '  --ad-accent-2:    #7C3AED;',
    '  --ad-warn:        #D97706;',
    '  --ad-danger:      #DC2626;',
    '  --ad-success:     #16A34A;',
    '  --ad-hm-0:        #EDEDEF;',
    '  --ad-hm-1:        #D8D8DE;',
    '  --ad-hm-2:        #B8B8C4;',
    '  --ad-hm-3:        #7B7B94;',
    '  --ad-hm-4:        #3B6FE0;',
    '  --ad-banner-ar:  16 / 2.5;',
    '',
    '  color-scheme: light;',
    '  background-color: var(--ad-bg);',
    '  background-image:',
    '    linear-gradient(rgba(0,0,0,0.025) 1px, transparent 1px),',
    '    linear-gradient(90deg, rgba(0,0,0,0.025) 1px, transparent 1px);',
    '  box-shadow: inset 0 0 0 1px var(--ad-line);',
    '}'
  ].join('\n');

  var VAR_RE = /(--ad-[\w-]+)\s*:\s*([^;]+);/g;

  function parseVars(block) {
    var m, out = {};
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(block))) out[m[1]] = m[2].trim();
    return out;
  }

  var darkVars = parseVars(DARK_BLOCK);     // 全部变量
  var lightVars = parseVars(LIGHT_BLOCK);   // 仅浅色重定义的
  var ALL = Object.keys(darkVars);
  var LIGHT_SET = {};
  Object.keys(lightVars).forEach(function (k) { LIGHT_SET[k] = true; });

  var state = {
    theme: 'dark',
    mode: 'dark', // 预览：dark | light | side
    dark: Object.assign({}, darkVars),
    light: Object.assign({}, lightVars)
  };

  var stage, panel, outCss;

  function isHex(v) { return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim()); }
  function isPx(v) { return /^\d+(\.\d+)?px$/.test(v.trim()); }
  function escRe(s) { return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }

  /* ---------- live apply ---------- */
  function applyTo(wrap) {
    var t = wrap.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    ALL.forEach(function (name) {
      var v = (t === 'light' && name in state.light) ? state.light[name] : state.dark[name];
      wrap.style.setProperty(name, v);
    });
  }
  function applyAll() {
    var wraps = stage.querySelectorAll('.tp-wrap');
    for (var i = 0; i < wraps.length; i++) applyTo(wraps[i]);
  }

  /* ---------- preview ---------- */
  function previewHTML() {
    var hm = '';
    var hmCols = ['var(--ad-hm-0)', 'var(--ad-hm-1)', 'var(--ad-hm-2)', 'var(--ad-hm-3)', 'var(--ad-hm-4)'];
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 14; c++) {
        var lvl = Math.min(4, Math.floor(Math.random() * 5));
        hm += '<div style="background:' + hmCols[lvl] + ';border-radius:2px;"></div>';
      }
    }
    return '' +
      // Banner
      '<div class="ad-banner"><div class="ad-banner__ph">Banner 封面区域</div>' +
      '<div class="ad-banner__bar"><button class="ad-banner__btn">更换图片</button></div></div>' +
      // Stats
      '<div class="tp-stats">' +
        stat('NOTES', '128') + stat('PENDING', '9') + stat('TODAY', '3') + stat('STREAK', '21') +
      '</div>' +
      // Buttons（使用插件真实类：工具栏 / 模态主按钮 / 模态次按钮 / banner 按钮）
      '<div class="tp-row">' +
        '<button class="ad-toolbar__btn"><span class="ad-glyph">&#8962;</span>主页</button>' +
        '<button class="ad-modal-btn ad-modal-btn--primary">主按钮</button>' +
        '<button class="ad-modal-btn">次按钮</button>' +
        '<button class="ad-banner__btn">Banner 按钮</button>' +
        '<span class="ad-tag-chip">标签 chip</span>' +
        '<span class="ad-pill">pill</span>' +
      '</div>' +
      // Cards grid
      '<div class="tp-grid">' +
        card('待办 TODO',
          '<div class="tp-line tp-line--overdue">● 逾期任务（红色左边条）</div>' +
          '<div class="tp-line">○ 普通任务一行</div>' +
          '<div class="tp-line">○ 另一个普通任务</div>' +
          '<span class="ad-tag-chip">重要且紧急</span>') +
        card('工作进度',
          '<div class="tp-ring"><svg viewBox="0 0 80 80" width="84" height="84">' +
          '<circle cx="40" cy="40" r="32" fill="none" stroke="var(--ad-line)" stroke-width="8"/>' +
          '<circle cx="40" cy="40" r="32" fill="none" stroke="var(--ad-accent)" stroke-width="8" stroke-dasharray="150 201" stroke-linecap="round" transform="rotate(-90 40 40)"/>' +
          '</svg><div class="tp-ring__num">62%</div></div>' +
          '<div class="tp-muted">今日完成率 · 全部完成率</div>') +
        card('本周待办',
          '<div class="tp-badge">逾期 2</div>' +
          '<div class="tp-line tp-line--overdue">● 逾期：周报汇总</div>' +
          '<div class="tp-line">○ 本周：API 文档</div>' +
          '<div class="tp-line">○ 本周：视觉定稿</div>') +
        card('项目进度',
          '<div class="tp-stages">' +
          '<span class="tp-pip tp-pip--done"></span><span class="tp-pip tp-pip--done"></span>' +
          '<span class="tp-pip tp-pip--active"></span><span class="tp-pip"></span><span class="tp-pip"></span>' +
          '</div><div class="tp-muted">立项 → 规划 → 开发 → 测试 → 上线</div>') +
        card('笔记统计',
          '<div class="tp-hm">' + hm + '</div><div class="tp-muted">52 周热力图</div>') +
        card('倒计时',
          '<div class="tp-big">159</div><div class="tp-muted">年度剩余天数 · 第 28 周</div>') +
      '</div>' +
      // Calendar snippet
      '<div class="ad-card tp-card"><div class="ad-card__head"><span class="ad-card__title">日历（片段）</span></div>' +
      '<div class="tp-cal">' +
        calCell('12', 'normal') + calCell('13', 'overdue') + calCell('14', 'done') +
        calCell('15', 'normal') + calCell('16', 'normal') + calCell('17', '') + calCell('18', '') +
      '</div></div>' +
      // Kanban snippet
      '<div class="ad-card tp-card"><div class="ad-card__head"><span class="ad-card__title">看板（片段）</span></div>' +
      '<div class="tp-kanban">' +
        kanbanCol('待办', ['需求调研', '技术方案']) +
        kanbanCol('进行中', ['原型设计']) +
        kanbanCol('已阻塞', ['知识库迁移']) +
        kanbanCol('已完成', ['用户访谈']) +
      '</div></div>';
  }

  function stat(label, val) {
    return '<div class="tp-stat"><div class="tp-stat__v">' + val + '</div><div class="tp-stat__l">' + label + '</div></div>';
  }
  function card(title, body) {
    return '<div class="ad-card tp-card"><div class="ad-card__head"><span class="ad-card__title">' + title + '</span></div><div class="ad-card__body">' + body + '</div></div>';
  }
  function calCell(num, kind) {
    var cls = 'tp-day' + (kind ? ' tp-day--' + kind : '');
    var txt = num;
    if (kind === 'overdue') txt = num + ' ⚠';
    if (kind === 'done') txt = num + ' ✓';
    return '<div class="' + cls + '">' + txt + '</div>';
  }
  function kanbanCol(title, items) {
    var cards = items.map(function (t) { return '<div class="tp-kcard">' + t + '</div>'; }).join('');
    return '<div class="tp-kcol"><div class="tp-kcol__h">' + title + '</div>' + cards + '</div>';
  }

  function renderPreview() {
    stage.innerHTML = '';
    function make(theme) {
      var w = document.createElement('div');
      w.className = 'agent-dashboard tp-wrap';
      w.setAttribute('data-theme', theme === 'light' ? 'light' : '');
      var inner = document.createElement('div');
      inner.className = 'tp-preview';
      inner.innerHTML = previewHTML();
      w.appendChild(inner);
      stage.appendChild(w);
    }
    if (state.mode === 'side') { make('dark'); make('light'); }
    else { make(state.mode); }
    applyAll();
  }

  /* ---------- controls ---------- */
  function makeControl(name) {
    var row = document.createElement('div');
    row.className = 'tp-ctrl';
    var nm = document.createElement('div');
    nm.className = 'tp-ctrl__name';
    nm.textContent = name;
    nm.title = name;
    row.appendChild(nm);

    row.appendChild(makeInput(name, 'dark', state.dark[name]));
    var lightDefined = !!LIGHT_SET[name];
    var lc = makeInput(name, 'light', lightDefined ? state.light[name] : darkVars[name], !lightDefined);
    row.appendChild(lc);
    return row;
  }

  function makeInput(name, theme, value, disabled) {
    var wrap = document.createElement('div');
    wrap.className = 'tp-inp';
    var val = value;
    if (isHex(val)) {
      var cp = document.createElement('input');
      cp.type = 'color'; cp.value = val; cp.disabled = !!disabled;
      var tx = document.createElement('input');
      tx.type = 'text'; tx.value = val; tx.className = 'tp-tx'; tx.disabled = !!disabled;
      cp.addEventListener('input', function () { tx.value = cp.value; setVal(name, theme, cp.value); });
      tx.addEventListener('input', function () {
        if (isHex(tx.value)) cp.value = tx.value;
        setVal(name, theme, tx.value);
      });
      wrap.appendChild(cp); wrap.appendChild(tx);
    } else if (isPx(val)) {
      var num = parseInt(val, 10) || 0;
      var rg = document.createElement('input');
      rg.type = 'range'; rg.min = '0'; rg.max = '64'; rg.step = '1'; rg.value = String(num); rg.disabled = !!disabled;
      var out = document.createElement('span'); out.className = 'tp-rv'; out.textContent = val;
      rg.addEventListener('input', function () { out.textContent = rg.value + 'px'; setVal(name, theme, rg.value + 'px'); });
      wrap.appendChild(rg); wrap.appendChild(out);
    } else {
      var t2 = document.createElement('input');
      t2.type = 'text'; t2.value = val; t2.className = 'tp-tx'; t2.disabled = !!disabled;
      if (disabled) t2.placeholder = '继承深色';
      t2.addEventListener('input', function () { setVal(name, theme, t2.value); });
      wrap.appendChild(t2);
    }
    return wrap;
  }

  function setVal(name, theme, value) {
    if (theme === 'dark') state.dark[name] = value; else state.light[name] = value;
    applyAll();
  }

  function renderPanel() {
    panel.innerHTML = '';
    var hint = document.createElement('div');
    hint.className = 'tp-hint';
    hint.textContent = '每项：左=深色值，右=浅色值（灰显“继承深色”表示浅色沿用深色）。改完点右下「生成 CSS」。';
    panel.appendChild(hint);
    ALL.forEach(function (name) { panel.appendChild(makeControl(name)); });
  }

  /* ---------- export ---------- */
  function substitute(block, name, value) {
    var re = new RegExp(escRe(name) + '\\s*:\\s*[^;]+', 'g');
    return block.replace(re, name + ': ' + value);
  }
  function exportCSS() {
    var d = DARK_BLOCK;
    ALL.forEach(function (n) { d = substitute(d, n, state.dark[n]); });
    var l = LIGHT_BLOCK;
    Object.keys(state.light).forEach(function (n) { l = substitute(l, n, state.light[n]); });
    return '/* === Agent Dashboard 设计变量（由 token-playground 生成） === */\n' + d + '\n\n' + l + '\n';
  }
  function doExport() {
    var css = exportCSS();
    outCss.value = css;
    outCss.select();
    try { navigator.clipboard.writeText(css); flash('已生成 CSS 并复制'); }
    catch (e) { flash('已生成 CSS（请手动复制）'); }
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
      a.download = 'agent-dashboard-tokens.css'; a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {}
  }
  function doReset() {
    state.dark = Object.assign({}, darkVars);
    state.light = Object.assign({}, lightVars);
    renderPanel(); applyAll(); flash('已重置为默认');
  }
  function flash(msg) {
    var el = document.getElementById('tp-flash');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(flash._t); flash._t = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  /* ---------- init ---------- */
  function init() {
    stage = document.getElementById('tp-stage');
    panel = document.getElementById('tp-panel');
    outCss = document.getElementById('tp-out');

    document.getElementById('tp-md').addEventListener('click', function () { setMode('dark'); });
    document.getElementById('tp-ml').addEventListener('click', function () { setMode('light'); });
    document.getElementById('tp-ms').addEventListener('click', function () { setMode('side'); });
    document.getElementById('tp-export').addEventListener('click', doExport);
    document.getElementById('tp-reset').addEventListener('click', doReset);

    renderPanel();
    renderPreview();
  }
  function setMode(m) {
    state.mode = m;
    document.getElementById('tp-md').classList.toggle('active', m === 'dark');
    document.getElementById('tp-ml').classList.toggle('active', m === 'light');
    document.getElementById('tp-ms').classList.toggle('active', m === 'side');
    renderPreview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
