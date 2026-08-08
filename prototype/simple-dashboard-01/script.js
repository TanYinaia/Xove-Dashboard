/* ==========================================================
   Agent Dashboard · prototype runtime
   - Loads mock-data.json (or uses embedded fallback).
   - Hydrates DOM, wires interactions (mock-only).
   - No external deps.
   ========================================================== */

(() => {
  'use strict';

  /* ---------- inline fallback (used if fetch fails on file://) ---------- */
  const FALLBACK = {
    today: '2026-06-29',
    weekday: '星期一',
    lunar: '农历 五月十五',
    header: { eyebrow: 'AGENTIC VAULT', title: 'XINGWANG 个人中心', subtitle: 'obsidian · agent dashboard · v0.1' },
    pulse:  { notes: 156, pending: 23, delta_today: 4, streak_days: 12 },
    quick_capture: { placeholder: '把念头、闪念或链接丢进来…  ⌘ + ⏎ 直送进 inbox', primary_cta: '创建' },
    today_todos: [
      { id: 't1', priority: 'p0', text: '提交 GA 项目 PRD v2 给评审', done: false, tag: 'GA' },
      { id: 't2', priority: 'p1', text: '补全 agent-dashboard 的 ItemView 骨架', done: false, tag: 'dev' },
      { id: 't3', priority: 'p1', text: '回 3 条 async 留言（@bobo @lily @mark）', done: false, tag: 'sync' },
      { id: 't4', priority: 'p2', text: '整理“weekly review”模板', done: true, tag: 'note' },
      { id: 't5', priority: 'p2', text: '读 Diff Screenshot Service RFC', done: false, tag: 'read' },
      { id: 't6', priority: 'p3', text: '为新笔记 archive/2026-06 归档', done: false, tag: 'chore' },
      { id: 't7', priority: 'p3', text: '清理 inbox 里 5 条临时文件', done: true, tag: 'chore' },
      { id: 't8', priority: 'p3', text: 'Backup vault 增量校验', done: false, tag: 'chore' }
    ],
    daily_progress: { completed: 5, total: 10, delta_vs_yesterday: '+2' },
    weekly_and_overdue: {
      overdue: [
        { id: 'o1', date: '06-25', text: '向 mentor 提交 Q2 复盘', owner: '@xw' },
        { id: 'o2', date: '06-27', text: '修 Obsidian 0.15 兼容：WorkspaceLeaf.onload', owner: '@xw' }
      ],
      this_week: [
        { id: 'w1', date: '06-29', text: 'Agent Dashboard 静态原型验收', state: 'today' },
        { id: 'w2', date: '06-30', text: 'GA 立项会 · 准备 deck 23p', state: 'soon' },
        { id: 'w3', date: '07-01', text: 'Notes pipeline 重构设计评审', state: 'later' },
        { id: 'w4', date: '07-02', text: '写一篇关于 vault-as-state 的博客草稿', state: 'later' },
        { id: 'w5', date: '07-03', text: '周五 weekly review（30min）', state: 'recurring' },
        { id: 'w6', date: '07-04', text: '整理读书笔记《Designing Data-Intensive Apps》', state: 'later' }
      ]
    },
    projects: [
      { id: 'p1', name: 'Agent Dashboard',       owner: '@xw',     type: 'dev', stage: 2, stages: ['立项','规划','开发','测试','上线'], percent: 42, next: '完善 ItemView 骨架 & 设置面板' },
      { id: 'p2', name: 'Diff Screenshot Service', owner: '@team',  type: 'dev', stage: 3, stages: ['立项','规划','开发','测试','上线'], percent: 68, next: '测试用例补全 & 性能 profile' },
      { id: 'p3', name: 'Q2 GA 上线',              owner: '@ops',    type: 'ga',  stage: 1, stages: ['立项','规划','开发','测试','上线'], percent: 18, next: '对齐 GTM 时间线' },
      { id: 'p4', name: 'Notes Pipeline v2',      owner: '@xw',     type: 'dev', stage: 1, stages: ['立项','规划','开发','测试','上线'], percent: 25, next: '细化 ingestion 接口' },
      { id: 'p5', name: '品牌资产 GA',             owner: '@design', type: 'ga',  stage: 4, stages: ['立项','规划','开发','测试','上线'], percent: 90, next: '上线 checklist 校验' },
      { id: 'p6', name: 'Blog 长文 · vault-as-state', owner: '@xw', type: 'ga',  stage: 0, stages: ['立项','规划','开发','测试','上线'], percent: 8,  next: '定 outline & 写开篇' }
    ],
    project_summary: { dev: 3, ga: 6 },
    notes_stats: { total: 200, active_days: 180, longest_streak_days: 41, current_streak_days: 12, year_label: '2026' },
    countdown: { year: 2026, days_left: 186, weeks_left: 27, percent_done: 49.2, milestone: 'Q4 OKR 启动准备' },
    settings_menu: ['切换浅色 / 深色','布局密度：紧凑','导入 CSV','刷新 vault 数据','关于 Agent Dashboard']
  };

  /* ---------- data loader ---------- */
  async function loadData() {
    let data = FALLBACK;
    try {
      const res = await fetch('mock-data.json', { cache: 'no-store' });
      if (res.ok) data = await res.json();
    } catch (_) { /* keep fallback */ }
    return data;
  }

  /* ---------- helpers ---------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class')      e.className = attrs[k];
      else if (k === 'text')  e.textContent = attrs[k];
      else if (k === 'html')  e.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  /* ---------- header ---------- */
  function paintHeader(d) {
    setText('header-date', d.today);
    setText('header-weekday', d.weekday);
    setText('header-lunar', d.lunar);

    const h = d.header || {};
    const left = document.querySelector('.header__left');
    if (left) {
      const sub = left.querySelector('.subtitle');
      if (sub && h.subtitle) sub.textContent = h.subtitle;
    }
  }

  /* ---------- pulse ---------- */
  function paintPulse(d) {
    const p = d.pulse || {};
    setText('pulse-notes',   p.notes ?? '—');
    setText('pulse-pending', p.pending ?? '—');
    const delta = p.delta_today ?? 0;
    const node = document.getElementById('pulse-delta');
    if (node) {
      node.textContent = (delta >= 0 ? '+' : '') + delta;
      node.classList.toggle('pulse__delta--neg', delta < 0);
    }
    setText('pulse-streak', (p.streak_days ?? 0) + 'd');
  }

  /* ---------- settings dropdown ---------- */
  function wireSettings(d) {
    const btn = $('#settings-btn');
    const menu = $('#settings-menu');
    if (!btn || !menu) return;
    (d.settings_menu || []).forEach((label, idx) => {
      if (idx === 3) {
        menu.appendChild(el('div', { class: 'dropdown__sep' }));
      }
      menu.appendChild(el('div', { class: 'dropdown__item', role: 'menuitem', tabindex: '0', text: label }));
    });
    function close() { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    function toggle() {
      const open = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  /* ---------- toolbar (mock) ---------- */
  function wireToolbar() {
    const buttons = $$('.toolbar__btn');
    const LABEL_TO_KEY = { '新日记': 'n', '新建任务': 't', '新建项目': 'p', '全部项目': 'g' };
    let lastActive = null;

    function flash(name) {
      console.log('[mock action]', name);
    }
    buttons.forEach((b) => {
      b.addEventListener('click', () => {
        buttons.forEach((x) => x.classList.remove('is-active'));
        b.classList.add('is-active');
        if (lastActive && lastActive !== b) { /* nothing extra */ }
        lastActive = b;
        flash(b.textContent.trim());
        setTimeout(() => b.classList.remove('is-active'), 350);
      });
    });

    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (!['n','t','p','g'].includes(k)) return;
      buttons.forEach((b) => {
        const label = b.textContent.trim();
        if (LABEL_TO_KEY[label] === k) b.click();
      });
    });
  }

  /* ---------- quick capture ---------- */
  function wireQuickCapture() {
    const area  = $('#qc-text');
    const btn   = $('#qc-submit');
    if (!area || !btn) return;
    btn.addEventListener('click', () => {
      if (!area.value.trim()) { area.focus(); return; }
      btn.textContent = '已创建 ✓';
      btn.style.background = 'var(--success)';
      btn.style.borderColor = 'var(--success)';
      setTimeout(() => {
        area.value = '';
        btn.textContent = '创建';
        btn.style.background = '';
        btn.style.borderColor = '';
      }, 1100);
    });
    area.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); btn.click(); }
      if (e.key === 'Escape') area.value = '';
    });
  }

  /* ---------- todo list ---------- */
  function paintTodos(d) {
    const list  = $('#todo-list');
    if (!list) return;
    list.innerHTML = '';
    const order = { p0:0, p1:1, p2:2, p3:3 };
    const items = [...(d.today_todos || [])].sort((a, b) => order[a.priority] - order[b.priority]);

    items.forEach((it) => {
      const row = el('div', { class: 'todo__item' + (it.done ? ' is-done' : ''), role: 'listitem' });
      row.appendChild(el('span', { class: 'todo__check' }));
      row.appendChild(el('span', { class: 'todo__text', text: it.text }));
      row.appendChild(el('span', { class: 'todo__tag', text: it.tag, 'data-prio': it.priority }));
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('todo__tag')) return;
        it.done = !it.done;
        row.classList.toggle('is-done', it.done);
      });
      list.appendChild(row);
    });

    const done = items.filter((x) => x.done).length;
    setText('todo-summary', `${done} / ${items.length} done · 按优先级`);
  }

  /* ---------- daily progress ring ---------- */
  function paintProgress(d) {
    const p = d.daily_progress || {};
    const pct = Math.max(0, Math.min(100, Math.round(((p.completed || 0) / (p.total || 1)) * 100)));
    const C = 263.9;
    const fill = $('#dp-ring .fill');
    if (fill) {
      fill.setAttribute('stroke-dasharray', C.toFixed(2));
      fill.setAttribute('stroke-dashoffset', (C * (1 - pct / 100)).toFixed(2));
    }
    setText('dp-pct', pct + '%');
    setText('dp-line', `今日已完成 ${p.completed ?? 0} / 今日任务 ${p.total ?? 0}`);
    setText('dp-vs', p.delta_vs_yesterday || '');

    // project total progress ring
    const projs = d.projects || [];
    if (projs.length) {
      const avg = Math.round(projs.reduce((s, x) => s + (x.percent || 0), 0) / projs.length);
      const active = projs.filter((x) => x.stage > 0 && x.stage < (x.stages || []).length).length;
      const projFill = $('#dp-ring-proj .fill');
      if (projFill) {
        projFill.setAttribute('stroke-dasharray', C.toFixed(2));
        projFill.setAttribute('stroke-dashoffset', (C * (1 - avg / 100)).toFixed(2));
      }
      setText('dp-proj-pct', avg + '%');
      setText('dp-proj-line', `项目总进度 ${avg}% · ${active} 进行中`);
    }
  }

  /* ---------- weekly + overdue ---------- */
  function paintWeekly(d) {
    const over = d.weekly_and_overdue && d.weekly_and_overdue.overdue || [];
    const week = d.weekly_and_overdue && d.weekly_and_overdue.this_week || [];
    const ulO = $('#wo-overdue');
    const ulW = $('#wo-week');
    if (ulO) {
      ulO.innerHTML = '';
      if (!over.length) ulO.appendChild(el('li', { html: '<span class="wo__text" style="color:var(--text-dim)">无逾期·一切按时</span>' }));
      over.forEach((it) => {
        const li = el('li');
        li.appendChild(el('span', { class: 'wo__date', text: it.date }));
        const tx = el('span', { class: 'wo__text' });
        tx.appendChild(el('strong', { text: 'OVERDUE' }));
        tx.appendChild(document.createTextNode(it.text));
        li.appendChild(tx);
        li.appendChild(el('span', { class: 'wo__state', text: it.owner || '' }));
        ulO.appendChild(li);
      });
    }
    if (ulW) {
      ulW.innerHTML = '';
      week.forEach((it) => {
        const li = el('li');
        li.appendChild(el('span', { class: 'wo__date', text: it.date }));
        li.appendChild(el('span', { class: 'wo__text', text: it.text }));
        li.appendChild(el('span', { class: 'wo__state', text: it.state, 'data-state': it.state }));
        ulW.appendChild(li);
      });
    }
    setText('wo-summary', `${over.length} 项逾期 · ${week.length} 项本周`);
  }

  /* ---------- projects ---------- */
  function paintProjects(d) {
    const list = $('#proj-list');
    if (!list) return;
    list.innerHTML = '';
    let active = 0;
    (d.projects || []).forEach((p) => {
      if (p.stage > 0 && p.stage < p.stages.length) active++;
      const row = el('div', { class: 'proj__row', 'data-type': p.type });

      row.appendChild(el('span', { class: 'proj__dot', title: p.type === 'ga' ? 'GA 项目' : '开发项目' }));

      const name = el('div', { class: 'proj__name' });
      name.appendChild(document.createTextNode(p.name));
      const meta = el('span', { class: 'meta', text: `${p.owner}  ·  ${p.percent}%` });
      name.appendChild(meta);
      row.appendChild(name);

      const track = el('div', { class: 'proj__track' });
      track.appendChild(el('div', { class: 'proj__rail', style: `--progress:${p.percent}%` }));
      const stages = el('div', { class: 'proj__stages' });
      (p.stages || []).forEach((label, i) => {
        const cls = i < p.stage ? 'is-done' : (i === p.stage ? 'is-current' : '');
        const s = el('div', { class: 'proj__stage ' + cls });
        s.appendChild(el('span', { class: 'pip' }));
        s.appendChild(document.createTextNode(label));
        stages.appendChild(s);
      });
      track.appendChild(stages);
      row.appendChild(track);

      row.appendChild(el('div', { class: 'proj__chev', text: '›' }));

      list.appendChild(row);
    });

    const sum = d.project_summary || {};
    setText('proj-dev', sum.dev ?? 0);
    setText('proj-ga',  sum.ga  ?? 0);
    setText('proj-active', active + ' 进行中');
    setText('proj-summary-hint', `${(d.projects || []).length} 个项目 · pipeline view`);
  }

  /* ---------- deterministic PRNG ---------- */
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- notes heatmap ---------- */
  function buildHeatmap(d) {
    const cells = $('#ns-cells');
    const months = $('#ns-months');
    const stats = d.notes_stats || {};
    setText('ns-total', stats.total ?? '—');
    setText('ns-active', `${stats.active_days ?? '—'} 天活跃`);
    setText('ns-streak', '');
    const cur = stats.current_streak_days ?? '—';
    const stat = $('#ns-streak');
    if (stat) stat.innerHTML = `当前连续 <strong>${cur}</strong> 天`;
    if (stat) stat.previousSibling;

    if (!cells || !months) return;

    // 53 weeks x 7 days, ending on the week of `today`. Today is column 52, row = wday.
    const today = new Date(d.today || new Date().toISOString().slice(0,10));
    if (isNaN(today)) return;

    const totalWeeks = 53;
    const dayMs = 86400000;
    const cellUnit = 13 + 3; // matches CSS -- 13px + 3px gap

    const rng = mulberry32(parseInt((d.today || '20260101').replace(/-/g,'')) ^ 0x9E37);
    cells.innerHTML = '';

    // compute month labels first
    const monthCells = [];
    let lastMonth = -1;
    for (let w = 0; w < totalWeeks; w++) {
      const colDate = new Date(today.getTime() - (totalWeeks - 1 - w) * 7 * dayMs);
      const m = colDate.getMonth();
      if (m !== lastMonth) {
        // align to the first day of week in this column that lands in `m`
        const firstOfMonth = new Date(colDate.getTime() + (m - colDate.getMonth() === 0 ? 0 : 0));
        monthCells.push({ week: w, label: `${firstOfMonth.getMonth() + 1}月` });
        lastMonth = m;
      }
    }
    months.innerHTML = '';
    let lastWeek = 0;
    monthCells.forEach((mc, i) => {
      const wWidth = (i === monthCells.length - 1) ? (totalWeeks - mc.week) : (monthCells[i+1].week - mc.week);
      const span = document.createElement('span');
      span.style.minWidth = (wWidth * cellUnit - 3) + 'px';
      span.textContent = mc.label;
      months.appendChild(span);
      lastWeek = mc.week + wWidth;
    });

    // generate cells
    for (let w = 0; w < totalWeeks; w++) {
      for (let dow = 0; dow < 7; dow++) {
        let level = 0;
        // More zeros, occasional clusters: simulate "streaks" of activity.
        const r = rng();
        let lvl;
        if (r < 0.55)      lvl = 0;
        else if (r < 0.72) lvl = 1;
        else if (r < 0.86) lvl = 2;
        else if (r < 0.96) lvl = 3;
        else               lvl = 4;
        // occasional boosts for "streak weeks"
        if (r > 0.93) lvl = Math.min(4, lvl + (rng() > 0.5 ? 1 : 0));
        level = lvl;

        const cell = document.createElement('div');
        cell.className = 'ns__cell' + (level ? ' l' + level : '');
        cell.title = level === 0 ? '今日未记录' : `${level * 3} 次创作`;
        cells.appendChild(cell);
      }
    }

    // size the months container to match cells width
    const monthsWidth = 22 + 4 + 53 * cellUnit - 3; // label col + gap + cells
    if (months) months.style.minWidth = monthsWidth + 'px';
  }

  /* ---------- countdown ---------- */
  function paintCountdown(d) {
    const c = d.countdown || {};
    setText('cd-days', c.days_left ?? '—');
    setText('cd-weeks', c.weeks_left ?? '—');
    setText('cd-pct', ((c.percent_done ?? 0).toFixed(1)) + '%');
    setText('cd-milestone', c.milestone || '—');
    const fill = $('#cd-fill');
    if (fill) fill.style.width = (c.percent_done ?? 0) + '%';
  }

  /* ---------- banner ---------- */
  function wireBanner() {
    const banner = document.querySelector('.banner');
    const btn = document.querySelector('.banner__replace');
    if (!banner || !btn) return;
    btn.addEventListener('click', () => {
      btn.innerHTML = '<span aria-hidden="true">…</span><span>选择本地图片</span>';
      setTimeout(() => {
        btn.innerHTML = '<span aria-hidden="true">↻</span><span>更换图片</span>';
      }, 900);
    });
  }

  /* ---------- boot ---------- */
  (async function boot() {
    const d = await loadData();
    paintHeader(d);
    paintPulse(d);
    paintTodos(d);
    paintProgress(d);
    paintWeekly(d);
    paintProjects(d);
    buildHeatmap(d);
    paintCountdown(d);
    wireSettings(d);
    wireToolbar();
    wireQuickCapture();
    wireBanner();

    // mark as hydrated
    document.body.setAttribute('data-ready', '1');
  })();
})();
