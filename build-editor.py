# -*- coding: utf-8 -*-
"""生成自包含的 Dashboard 可视化编辑器 dashboard-editor.html。
把真实的 styles.css 与 16 个插件图标内联进单文件，双击即可在浏览器打开，
支持：拖动定位 / 改背景色 / 改前景(文字+图标)色 / 改边框与圆角(形状) / 替换并改色图标 / 导出精确坐标 JSON。
"""
import os, re, json

ROOT = '/storage/Users/currentUser/My Dashboard'
CSS = open(os.path.join(ROOT, 'styles.css'), encoding='utf-8').read()

ICON_DIR = os.path.join(ROOT, '插件图标')
icons = {}
for fn in sorted(os.listdir(ICON_DIR)):
    if fn.lower().endswith('.svg'):
        name = fn[:-4]
        svg = open(os.path.join(ICON_DIR, fn), encoding='utf-8').read()
        svg = re.sub(r'<\?xml.*?\?>', '', svg, flags=re.S)
        svg = re.sub(r'<!DOCTYPE.*?>', '', svg, flags=re.S)
        # 单色化：所有 fill 改为 currentColor，便于用 color 整体改色
        svg = re.sub(r'fill="#[^"]*"', 'fill="currentColor"', svg)
        svg = svg.replace('<svg ', '<svg class="ed-svg" ', 1)
        icons[name] = svg.strip()
ICONS_JSON = json.dumps(icons, ensure_ascii=False)

EDITOR_CSS = r"""
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  background: #1b1d23; color: #e8e6e0; display: flex; flex-direction: column;
}
#topbar {
  display: flex; align-items: center; gap: 14px; padding: 10px 16px;
  background: #24262e; border-bottom: 1px solid #34384a; flex: 0 0 auto;
}
#topbar strong { font-size: 14px; }
#topbar .hint { font-size: 12px; color: #9aa0b0; flex: 1; }
#topbar select, #topbar button {
  font-size: 13px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid #3a3f52; background: #2c2f3b; color: #e8e6e0;
}
#topbar button:hover { background: #353947; }
#work { flex: 1; display: flex; min-height: 0; }
#stageWrap { flex: 1; overflow: auto; padding: 24px; background:
  repeating-conic-gradient(#20232b 0% 25%, #1a1c22 0% 50%) 50% / 24px 24px; }
#stage { width: max-content; margin: 0 auto; }
#dash {
  position: relative; width: 1000px; min-height: 1092px;
  border-radius: 14px; overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,.45);
}
.ed-el {
  position: absolute; outline: 1px dashed transparent; cursor: grab;
  transition: outline-color .1s;
}
.ed-el:hover { outline-color: rgba(123,167,255,.5); }
.ed-el.selected { outline: 2px solid #7BA7FF; z-index: 50; }
.ed-target { width: 100%; height: 100%; }
.ed-svg { width: 18px; height: 18px; display: block; fill: currentColor; }
/* 卡片内部代表性内容（编辑态示意，落地以真实 TS 为准） */
.ed-body { flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.ed-todo { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.ed-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--ad-accent); flex: 0 0 auto; }
.ed-tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--ad-line); color: var(--ad-text-dim); margin-left: auto; }
.ed-ring { width: 80px; height: 80px; border-radius: 50%;
  background: conic-gradient(var(--ad-accent) 0 72%, var(--ad-s3) 72% 100%);
  display: flex; align-items: center; justify-content: center; margin: 6px auto; position: relative; }
.ed-ring::after { content: ""; position: absolute; inset: 12px; border-radius: 50%; background: var(--ad-card); }
.ed-ring span { position: relative; font-size: 18px; font-weight: 700; color: var(--ad-text); }
.ed-hm { display: grid; grid-template-columns: repeat(12, 1fr); gap: 3px; }
.ed-hm i { aspect-ratio: 1; border-radius: 2px; background: var(--ad-s3); }
.ed-hm i.lvl1 { background: #3a4a66; } .ed-hm i.lvl2 { background: #4f6da3; }
.ed-hm i.lvl3 { background: #6f93d6; } .ed-hm i.lvl4 { background: #7BA7FF; }
.ed-big { font-size: 30px; font-weight: 800; color: var(--ad-text); }
.ed-sub { font-size: 12px; color: var(--ad-text-dim); }
.ed-piprow { display: flex; gap: 5px; align-items: center; }
.ed-pip { width: 11px; height: 11px; border-radius: 50%; background: var(--ad-s3); border: 1px solid var(--ad-line); }
.ed-pip.on { background: var(--ad-accent); border-color: var(--ad-accent); }
/* 对齐参考线 */
.ed-guide-v, .ed-guide-h { position: absolute; background: #ff5d8f; pointer-events: none; z-index: 999; }
.ed-guide-v { width: 1px; top: 0; bottom: 0; }
.ed-guide-h { height: 1px; left: 0; right: 0; }
/* 右侧属性面板 */
#panel {
  flex: 0 0 300px; background: #24262e; border-left: 1px solid #34384a;
  padding: 16px; overflow: auto; font-size: 13px;
}
#panel h4 { margin: 0 0 4px; font-size: 13px; }
#panel .pid { color: #9aa0b0; font-family: monospace; font-size: 12px; margin-bottom: 12px; }
#panel .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
#panel label { flex: 0 0 76px; color: #b9bed0; }
#panel input[type=number] { width: 100%; }
#panel input[type=text], #panel input[type=number], #panel select {
  flex: 1; padding: 6px 8px; border-radius: 7px; border: 1px solid #3a3f52;
  background: #1d1f27; color: #e8e6e0; font-size: 13px;
}
#panel input[type=color] { width: 40px; height: 30px; padding: 0; border: 1px solid #3a3f52; border-radius: 6px; background: none; }
#panel .grp { border-top: 1px solid #34384a; margin-top: 6px; padding-top: 10px; }
#panel .empty { color: #8089a0; padding: 20px 0; }
#out { flex: 0 0 160px; border-top: 1px solid #34384a; background: #1b1d23; }
#jsonOut { width: 100%; height: 100%; border: 0; resize: none; background: #14161c; color: #9fe6b0; font-family: monospace; font-size: 11px; padding: 8px; }
"""

EDITOR_HTML_TOP = r"""
<div id="topbar">
  <strong>Dashboard 可视化编辑器</strong>
  <span class="hint">点击选中 → 拖动定位；右侧改背景/前景/边框/圆角；按钮可换图标并改色；满意后点「导出 JSON」交我落地</span>
  <label>主题
    <select id="themeSel">
      <option value="dark">深色</option>
      <option value="light">浅色</option>
    </select>
  </label>
  <button id="exportBtn">导出 JSON</button>
  <button id="resetBtn">重置</button>
</div>
<div id="work">
  <div id="stageWrap"><div id="stage"><div id="dash" class="agent-dashboard" data-theme="dark"></div></div></div>
  <aside id="panel"><div class="empty">点击画布中的任意组件开始编辑。</div></aside>
</div>
<div id="out"><textarea id="jsonOut" readonly placeholder="导出的布局 JSON 会显示在这里…"></textarea></div>
"""

EDITOR_JS = r"""
const ICON_NAMES = Object.keys(ICONS);

const LAYOUT = [
  {id:'banner',        type:'banner',   x:8,   y:8,   w:984, h:150},
  {id:'banner-btn',    type:'bannerbtn',x:842, y:116, w:130, h:34},
  {id:'header',        type:'header',   x:8,   y:170, w:984, h:84},
  {id:'header-theme',  type:'hbtn',     x:812, y:186, w:64,  h:40, icon:'更多', label:'主题'},
  {id:'header-settings',type:'hbtn',    x:884, y:186, w:64,  h:40, icon:'设置', label:'设置'},
  {id:'tb-home',       type:'tbtn',     x:8,   y:270, w:156, h:48, icon:'主页',   label:'主页'},
  {id:'tb-diary',      type:'tbtn',     x:172, y:270, w:156, h:48, icon:'新建日记', label:'新建日记'},
  {id:'tb-task',       type:'tbtn',     x:336, y:270, w:156, h:48, icon:'新建任务', label:'新建任务'},
  {id:'tb-project',    type:'tbtn',     x:500, y:270, w:156, h:48, icon:'新建项目', label:'新建项目'},
  {id:'tb-all',        type:'tbtn',     x:664, y:270, w:156, h:48, icon:'全部项目', label:'全部项目'},
  {id:'tb-opportunity',type:'tbtn',     x:828, y:270, w:156, h:48, icon:'机会点',  label:'机会点'},
  {id:'card-capture',  type:'card', card:'capture',   x:8,   y:336, w:320, h:240},
  {id:'card-todo',     type:'card', card:'todo',      x:336, y:336, w:320, h:240},
  {id:'card-progress', type:'card', card:'progress',  x:664, y:336, w:320, h:240},
  {id:'card-weekly',   type:'card', card:'weekly',    x:8,   y:584, w:320, h:240},
  {id:'card-project',  type:'card', card:'project',   x:336, y:584, w:320, h:240},
  {id:'card-heatmap',  type:'card', card:'heatmap',   x:664, y:584, w:320, h:240},
  {id:'card-countdown',type:'card', card:'countdown', x:8,   y:832, w:320, h:240},
];

const state = {};
let selected = null;
const dash = document.getElementById('dash');

function iconSVG(name){ return ICONS[name] || ''; }

function innerHTML(item){
  switch(item.type){
    case 'banner':
      return '<div class="ad-banner ed-target" style="height:100%">'
           + '<div class="ad-banner__ph">[ banner 封面 · 拖到右侧可插入图片 ]</div></div>';
    case 'bannerbtn':
      return '<button class="ad-banner__btn ed-target" style="width:100%;height:100%">更换图片</button>';
    case 'header':
      return '<header class="ad-header ed-target" style="height:100%">'
           + '<div class="ad-header__left"><div class="ad-header__title">我的工作台</div>'
           + '<div class="ad-header__sub">个人工作台 · 运动相机品类</div></div>'
           + '<div class="ad-header__right"><div class="ad-header__date">2026-08-07 周五</div>'
           + '<div class="ad-header__meta"><span class="ad-chip">12 待办</span><span class="ad-chip">3 进行中</span></div></div></header>';
    case 'hbtn':
      return '<button class="ad-header__'+item.label+' ed-target" style="width:100%;height:100%;display:inline-flex;align-items:center;gap:6px;justify-content:center">'
           + '<span class="ad-glyph">'+iconSVG(item.icon)+'</span><span>'+item.label+'</span></button>';
    case 'tbtn':
      return '<button class="ad-toolbar__btn ed-target" style="width:100%;height:100%;display:inline-flex;align-items:center;gap:8px;justify-content:center">'
           + '<span class="ad-glyph">'+iconSVG(item.icon)+'</span><span class="ad-toolbar__label">'+item.label+'</span></button>';
    case 'card':
      return cardInner(item.card);
  }
  return '';
}

function cardInner(kind){
  const head = (t)=>'<div class="ad-card__head"><h3 class="ad-card__title">'+t+'</h3></div>';
  let body = '';
  if(kind==='capture'){
    body = '<div class="ed-body"><textarea class="ad-qc__area" placeholder="快速记录灵感…" style="flex:1"></textarea>'
         + '<div style="display:flex;justify-content:flex-end"><button class="ad-qc__cta">捕捉</button></div></div>';
  } else if(kind==='todo'){
    body = '<div class="ed-body">'
      + todo('写竞品周报', '重要') + todo('回复供应商邮件', '紧急') + todo('整理测评素材', '普通') + '</div>';
  } else if(kind==='progress'){
    body = '<div class="ed-body"><div class="ed-ring"><span>72%</span></div>'
         + '<div class="ed-sub" style="text-align:center">12 / 17 任务完成</div></div>';
  } else if(kind==='weekly'){
    body = '<div class="ed-body"><div class="ed-sub" style="color:var(--ad-danger)">⚠ 逾期：提交 8 月预算</div>'
         + todo('评审 SVGO3 样机', '进行中') + todo('更新路线图', '待办') + '</div>';
  } else if(kind==='project'){
    body = '<div class="ed-body">'
      + proj('SVGO3 量产', 3) + proj('海外上架', 5) + '</div>';
  } else if(kind==='heatmap'){
    let cells=''; for(let i=0;i<84;i++){ const l=[0,0,1,2,1,3,4,2,0,1][i%10]; cells+='<i'+(l?' class="lvl'+l+'"':'')+'></i>'; }
    body = '<div class="ed-body"><div class="ed-sub">本年已记录 142 篇 · 连续 18 天</div><div class="ed-hm">'+cells+'</div></div>';
  } else if(kind==='countdown'){
    body = '<div class="ed-body" style="align-items:center;justify-content:center">'
         + '<div class="ed-big">128 天</div><div class="ed-sub">距 2026 年终</div></div>';
  }
  const gridCls = {capture:'ad-b-capture',todo:'ad-b-todo',progress:'ad-b-progress',weekly:'ad-b-weekly',project:'ad-b-project',heatmap:'ad-b-heatmap',countdown:'ad-b-countdown'}[kind]||'';
  const titles = {capture:'快速捕捉',todo:'待办 TODO',progress:'工作进度',weekly:'本周待办 & 逾期提醒',project:'项目进度',heatmap:'笔记统计',countdown:'倒计时 · 2026'};
  return '<div class="ad-card '+gridCls+' ed-target" style="height:100%">'+head(titles[kind])+body+'</div>';
}
function todo(t, tag){ return '<div class="ed-todo"><span class="ed-dot"></span><span>'+t+'</span><span class="ed-tag">'+tag+'</span></div>'; }
function proj(name, done){ let p=''; for(let i=0;i<5;i++) p+='<span class="ed-pip'+(i<done?' on':'')+'"></span>'; return '<div class="ed-todo" style="width:100%"><span style="min-width:84px">'+name+'</span><span class="ed-piprow">'+p+'</span></div>'; }

/* ---- 构建 ---- */
function build(){
  LAYOUT.forEach(function(item){
    const el = document.createElement('div');
    el.className = 'ed-el'; el.dataset.id = item.id;
    el.style.left = item.x+'px'; el.style.top = item.y+'px';
    el.style.width = item.w+'px'; el.style.height = item.h+'px';
    el.innerHTML = innerHTML(item);
    dash.appendChild(el);
    const st = {x:item.x, y:item.y, w:item.w, h:item.h,
      bg:'', color:'', borderColor:'', bw:'', radius:'', icon:item.icon||'', iconColor:''};
    // 读取真实计算样式作为默认值
    const t = el.querySelector('.ed-target');
    if(t){
      const cs = getComputedStyle(t);
      st.bg = rgbToHex(cs.backgroundColor);
      st.color = rgbToHex(cs.color);
      st.borderColor = rgbToHex(cs.borderTopColor);
      st.bw = parseInt(cs.borderTopWidth)||0;
      st.radius = parseInt(cs.borderTopLeftRadius)||0;
    }
    const g = el.querySelector('.ad-glyph');
    if(g){ st.iconColor = rgbToHex(getComputedStyle(g).color); }
    state[item.id] = st;
    el.addEventListener('pointerdown', function(e){ startDrag(e, el, item.id); });
  });
}

function rgbToHex(c){
  if(!c || c==='transparent') return '';
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if(!m) return c;
  return '#'+[m[1],m[2],m[3]].map(function(v){return ('0'+parseInt(v).toString(16)).slice(-2);}).join('');
}

/* ---- 选择 / 面板 ---- */
const panel = document.getElementById('panel');
function select(id){
  selected = id;
  document.querySelectorAll('.ed-el').forEach(function(e){ e.classList.toggle('selected', e.dataset.id===id); });
  renderPanel(id);
}
function renderPanel(id){
  const st = state[id];
  const isBtn = /^(tb-|header-)/.test(id) || id==='banner-btn';
  let html = '<h4>'+id+'</h4><div class="pid">data-id = "'+id+'"</div>';
  html += field('X','x',st.x,'number') + field('Y','y',st.y,'number')
        + field('宽 W','w',st.w,'number') + field('高 H','h',st.h,'number');
  html += '<div class="grp">';
  html += colorField('背景色','bg',st.bg) + colorField('前景色(文字/图标)','color',st.color)
        + colorField('边框色','borderColor',st.borderColor)
        + field('圆角(px)','radius',st.radius,'number') + field('边框宽(px)','bw',st.bw,'number');
  html += '</div>';
  if(isBtn){
    html += '<div class="grp">';
    html += '<div class="row"><label>图标</label><select id="f-icon">';
    ICON_NAMES.forEach(function(n){ html += '<option'+(n===st.icon?' selected':'')+'>'+n+'</option>'; });
    html += '</select></div>';
    html += colorField('图标色','iconColor', st.iconColor||st.color);
    html += '</div>';
  }
  panel.innerHTML = html;
  bindPanel(id);
}
function field(label, key, val, type){
  return '<div class="row"><label>'+label+'</label><input id="f-'+key+'" type="'+type+'" value="'+val+'"></div>';
}
function colorField(label, key, val){
  const v = val || '#000000';
  return '<div class="row"><label>'+label+'</label><input id="f-'+key+'" type="color" value="'+v+'"><input id="t-'+key+'" type="text" value="'+val+'"></div>';
}
function bindPanel(id){
  const st = state[id];
  ['x','y','w','h','radius','bw'].forEach(function(k){
    const inp = document.getElementById('f-'+k);
    if(inp) inp.addEventListener('input', function(){ st[k] = parseFloat(inp.value)||0; applyPos(id); });
  });
  ['bg','color','borderColor'].forEach(function(k){
    const c = document.getElementById('f-'+k), t = document.getElementById('t-'+k);
    if(c) c.addEventListener('input', function(){ if(t) t.value=c.value; st[k]=c.value; applyStyle(id); });
    if(t) t.addEventListener('input', function(){ st[k]=t.value; applyStyle(id); });
  });
  const iconSel = document.getElementById('f-icon');
  if(iconSel) iconSel.addEventListener('change', function(){ st.icon = iconSel.value; applyStyle(id); });
  const ic = document.getElementById('f-iconColor');
  if(ic) ic.addEventListener('input', function(){ st.iconColor = ic.value; applyStyle(id); });
}
function applyPos(id){
  const el = dash.querySelector('[data-id="'+id+'"]'); const st = state[id];
  el.style.left = st.x+'px'; el.style.top = st.y+'px';
  el.style.width = st.w+'px'; el.style.height = st.h+'px';
}
function applyStyle(id){
  const el = dash.querySelector('[data-id="'+id+'"]'); const st = state[id];
  const t = el.querySelector('.ed-target');
  if(st.bg) t.style.background = st.bg;
  if(st.color) t.style.color = st.color;
  if(st.borderColor){ t.style.borderColor = st.borderColor; t.style.borderStyle = 'solid'; }
  if(st.bw!=null && st.bw!=='') t.style.borderWidth = st.bw+'px';
  if(st.radius!=null && st.radius!=='') t.style.borderRadius = st.radius+'px';
  if(st.icon){ const g = el.querySelector('.ad-glyph'); if(g) g.innerHTML = iconSVG(st.icon); }
  if(st.iconColor){ const g = el.querySelector('.ad-glyph'); if(g) g.style.color = st.iconColor; }
}

/* ---- 拖动 + 对齐参考线 ---- */
let drag = null;
function startDrag(e, el, id){
  e.preventDefault(); select(id);
  const r = el.getBoundingClientRect(); const cr = dash.getBoundingClientRect();
  drag = { id:id, el:el, offX: e.clientX - r.left, offY: e.clientY - r.top, cr:cr };
  el.setPointerCapture(e.pointerId);
  el.addEventListener('pointermove', onDrag);
  el.addEventListener('pointerup', endDrag);
}
function onDrag(e){
  if(!drag) return;
  const st = state[drag.id];
  let nx = e.clientX - drag.cr.left - drag.offX;
  let ny = e.clientY - drag.cr.top - drag.offY;
  nx = Math.max(0, nx); ny = Math.max(0, ny);
  // 参考线吸附
  clearGuides();
  const snapped = snap(drag.id, nx, ny);
  nx = snapped.x; ny = snapped.y;
  st.x = Math.round(nx); st.y = Math.round(ny);
  drag.el.style.left = st.x+'px'; drag.el.style.top = st.y+'px';
  const fx = document.getElementById('f-x'), fy = document.getElementById('f-y');
  if(fx) fx.value = st.x; if(fy) fy.value = st.y;
}
function endDrag(e){
  if(!drag) return;
  drag.el.releasePointerCapture(e.pointerId);
  drag.el.removeEventListener('pointermove', onDrag);
  drag.el.removeEventListener('pointerup', endDrag);
  clearGuides(); drag = null;
}
function others(id){
  return LAYOUT.filter(function(o){ return o.id!==id; })
    .map(function(o){ return {x1:o.x, xc:o.x+o.w/2, x2:o.x+o.w, y1:o.y, yc:o.y+o.h/2, y2:o.y+o.h}; });
}
function snap(id, nx, ny){
  const T = 6; const st = state[id];
  const W = st.w, H = st.h;
  const selfX1 = nx, selfXc = nx+W/2, selfX2 = nx+W;
  const selfY1 = ny, selfYc = ny+H/2, selfY2 = ny+H;
  const targets = others(id);
  let bestX = null, bestXs=1e9, bestY=null, bestYs=1e9;
  targets.forEach(function(t){
    [t.x1,t.xc,t.x2].forEach(function(tx){
      [[selfX1,0],[selfXc,tx-selfXc],[selfX2,tx-selfX2]].forEach(function(p){
        if(Math.abs(p[1])<T && Math.abs(p[1])<Math.abs(bestXs)){ bestXs=p[1]; bestX=tx; }
      });
    });
    [t.y1,t.yc,t.y2].forEach(function(ty){
      [[selfY1,0],[selfYc,ty-selfYc],[selfY2,ty-selfY2]].forEach(function(p){
        if(Math.abs(p[1])<T && Math.abs(p[1])<Math.abs(bestYs)){ bestYs=p[1]; bestY=ty; }
      });
    });
  });
  // 画布中线
  if(Math.abs(selfXc - 500)<T){ bestXs = 500-selfXc; bestX=500; }
  if(Math.abs(selfYc - 546)<T){ bestYs = 546-selfYc; bestY=546; }
  if(bestX!==null){ nx += bestXs; showGuide('v', bestX); }
  if(bestY!==null){ ny += bestYs; showGuide('h', bestY); }
  return {x:nx, y:ny};
}
function showGuide(dir, pos){
  const g = document.createElement('div');
  g.className = 'ed-guide-'+dir; g.style[dir==='v'?'left':'top'] = pos+'px';
  dash.appendChild(g);
}
function clearGuides(){ dash.querySelectorAll('.ed-guide-v,.ed-guide-h').forEach(function(g){ g.remove(); }); }

/* ---- 键盘微调 ---- */
document.addEventListener('keydown', function(e){
  if(!selected) return;
  const st = state[selected]; const step = e.shiftKey?10:1;
  if(e.key==='ArrowLeft'){ st.x-=step; } else if(e.key==='ArrowRight'){ st.x+=step; }
  else if(e.key==='ArrowUp'){ st.y-=step; } else if(e.key==='ArrowDown'){ st.y+=step; }
  else return;
  e.preventDefault(); applyPos(selected);
  const fx=document.getElementById('f-x'), fy=document.getElementById('f-y');
  if(fx) fx.value=st.x; if(fy) fy.value=st.y;
});

/* ---- 主题 / 导出 / 重置 ---- */
document.getElementById('themeSel').addEventListener('change', function(e){
  const v = e.target.value;
  dash.setAttribute('data-theme', v);
  document.body.classList.toggle('theme-light', v==='light');
  document.body.classList.toggle('theme-dark', v==='dark');
  // 重新读取计算样式默认值（颜色随主题变）
  LAYOUT.forEach(function(item){
    const el = dash.querySelector('[data-id="'+item.id+'"]');
    const t = el.querySelector('.ed-target'); const st = state[item.id];
    const cs = getComputedStyle(t);
    st.bg = rgbToHex(cs.backgroundColor); st.color = rgbToHex(cs.color);
    st.borderColor = rgbToHex(cs.borderTopColor);
    if(selected===item.id) renderPanel(item.id);
  });
});
document.getElementById('exportBtn').addEventListener('click', function(){
  const out = { meta:{ tool:'dashboard-editor', generatedAt:new Date().toISOString(), unit:'px', root:'agent-dashboard' }, elements: [] };
  LAYOUT.forEach(function(item){
    const st = state[item.id];
    out.elements.push({ id:item.id, type:item.type, card:item.card||null,
      x:st.x, y:st.y, w:st.w, h:st.h,
      background:st.bg||null, color:st.color||null, borderColor:st.borderColor||null,
      borderWidth:st.bw||null, radius:st.radius||null,
      icon:st.icon||null, iconColor:st.iconColor||null });
  });
  const json = JSON.stringify(out, null, 2);
  document.getElementById('jsonOut').value = json;
  const blob = new Blob([json], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'dashboard-layout.json'; a.click();
});
document.getElementById('resetBtn').addEventListener('click', function(){
  if(!confirm('重置为初始布局？')) return;
  LAYOUT.forEach(function(item){
    const st = state[item.id]; st.x=item.x; st.y=item.y; st.w=item.w; st.h=item.h;
    applyPos(item.id);
  });
  if(selected) renderPanel(selected);
});

build();
"""

html = []
html.append('<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">')
html.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
html.append('<title>Dashboard 可视化编辑器</title>')
html.append('<style>')
html.append(EDITOR_CSS)
html.append('/* ===== 真实插件样式（内联，确保与 Obsidian 内渲染一致） ===== */')
html.append(CSS)
html.append('</style></head><body>')
html.append(EDITOR_HTML_TOP)
html.append('<script>')
html.append('const ICONS = ' + ICONS_JSON + ';')
html.append(EDITOR_JS)
html.append('</script></body></html>')

out_path = os.path.join(ROOT, 'dashboard-editor.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(html))
print('WROTE', out_path, os.path.getsize(out_path), 'bytes')
print('icons:', len(icons))
