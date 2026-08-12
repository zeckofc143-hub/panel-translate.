const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_CANVAS_SIDE = 3200;
const MAX_CANVAS_PIXELS = 7_000_000;

const state = {
  chapter: null,
  pages: [],
  busy: false,
  stop: false,
  view: 'translated',
  health: null,
  memory: { summary: '', glossary: [], history: [] },
};

const el = {
  url: $('#url'), load: $('#load'), translate: $('#translate'), stop: $('#stop'),
  status: $('#status'), meta: $('#meta'), pages: $('#pages'), source: $('#source'), target: $('#target'),
  safe: $('#safe'), preserveSfx: $('#preserveSfx'), view: $('#view'), progress: $('#progress'), engine: $('#engine'),
};

async function api(path, options = {}, retries = 2) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 180000);
    try {
      const r = await fetch(path, { ...options, signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = new Error(j?.error?.message || `Erro HTTP ${r.status}`);
        e.status = r.status;
        if (attempt < retries && (r.status === 429 || r.status >= 500)) {
          last = e;
          await sleep(900 * (attempt + 1));
          continue;
        }
        throw e;
      }
      return j;
    } catch (e) {
      last = e;
      if (attempt < retries && (e.name === 'AbortError' || !e.status)) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

boot();
async function boot() {
  try {
    state.health = await api('/api/health', {}, 0);
    if (state.health.aiConfigured) {
      const auth = state.health.auth === 'vercel-oidc' ? 'OIDC' : 'Gateway';
      el.engine.textContent = state.health.workerConfigured
        ? `IA: worker especializado + ${auth}`
        : `IA: ${state.health.visionModel} · ${auth}`;
      el.engine.className = 'pill ok';
    } else {
      el.engine.textContent = 'IA ainda não autenticada';
      el.engine.className = 'pill warn';
    }
  } catch {
    el.engine.textContent = 'API indisponível';
    el.engine.className = 'pill err';
  }
}

el.load.onclick = loadChapter;
el.translate.onclick = translateAll;
el.stop.onclick = () => {
  state.stop = true;
  setStatus('Parando após a página atual…');
};
el.view.onchange = () => {
  state.view = el.view.value;
  state.pages.forEach((_, i) => applyView(i));
};
el.safe.onchange = () => redrawVisible();
el.preserveSfx.onchange = () => redrawVisible();

async function loadChapter() {
  setStatus('Carregando capítulo…');
  el.load.disabled = true;
  el.translate.disabled = true;
  try {
    const j = await api('/api/chapter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: el.url.value }),
    });
    state.chapter = j.chapter;
    state.pages = j.pages.map(p => ({ ...p, status: 'idle', analysis: null, visible: false }));
    state.memory = { summary: '', glossary: [], history: [] };
    el.meta.innerHTML = `<div class="meta-card"><div><strong>${esc(j.chapter.mangaTitle)}</strong><div class="muted">Capítulo ${esc(j.chapter.chapter || '?')}${j.chapter.title ? ` · ${esc(j.chapter.title)}` : ''}${j.chapter.group ? ` · ${esc(j.chapter.group)}` : ''}</div></div><div class="pill">${state.pages.length} páginas</div></div>`;
    renderPages();
    el.translate.disabled = false;
    updateProgress();
    setStatus('Capítulo pronto.');
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    el.load.disabled = false;
  }
}

let observer;
function renderPages() {
  observer?.disconnect();
  el.pages.innerHTML = '';
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const i = Number(entry.target.dataset.i);
      state.pages[i].visible = entry.isIntersecting;
      if (entry.isIntersecting) draw(i);
      else releaseCanvas(i);
    }
  }, { rootMargin: '900px 0px' });

  state.pages.forEach((p, i) => {
    const a = document.createElement('article');
    a.className = 'page';
    a.dataset.i = i;
    a.innerHTML = `<div class="toolbar"><div><b>Página ${i + 1}</b><span class="badge st">aguardando</span></div><div class="tools"><button class="one">Traduzir</button><button class="redraw" title="Refaz a composição usando a análise atual">Reaplicar</button></div></div><div class="viewer"><img class="original" loading="lazy" decoding="async" src="${p.imageUrl}" alt="Página ${i + 1}"><canvas class="clean"></canvas><div class="layer"></div></div><details class="details"><summary>Texto e revisão</summary><div class="blocks"></div></details>`;
    a.querySelector('.one').onclick = () => translateOne(i);
    a.querySelector('.redraw').onclick = () => draw(i, true);
    const img = a.querySelector('img');
    img.onload = () => { if (state.pages[i].visible) draw(i); applyView(i); };
    el.pages.appendChild(a);
    observer.observe(a);
  });
}

function card(i) { return el.pages.querySelector(`[data-i="${i}"]`); }
function setStatus(text, error = false) {
  el.status.textContent = text;
  el.status.className = error ? 'err' : '';
}
function updateProgress() {
  if (!state.pages.length) {
    el.progress.value = 0;
    el.progress.max = 1;
    return;
  }
  el.progress.max = state.pages.length;
  el.progress.value = state.pages.filter(p => p.analysis).length;
}
function redrawVisible() {
  state.pages.forEach((p, i) => { if (p.visible) draw(i, true); });
}

async function translateAll() {
  if (state.busy) return;
  state.busy = true;
  state.stop = false;
  el.translate.disabled = true;
  el.stop.disabled = false;
  try {
    for (let i = 0; i < state.pages.length; i++) {
      if (state.stop) break;
      if (!state.pages[i].analysis) {
        try { await translateOne(i, true); } catch { }
      }
    }
    setStatus(state.stop ? 'Tradução interrompida.' : 'Capítulo processado. Revise os blocos marcados em amarelo.');
  } finally {
    state.busy = false;
    el.translate.disabled = false;
    el.stop.disabled = true;
  }
}

async function translateOne(i, batch = false) {
  const p = state.pages[i];
  const c = card(i);
  const st = c.querySelector('.st');
  const btn = c.querySelector('.one');
  st.textContent = 'OCR + layout + tradução…';
  st.className = 'badge st working';
  btn.disabled = true;
  if (!batch) setStatus(`Analisando página ${i + 1}…`);
  try {
    const j = await api('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterId: state.chapter.id,
        pageIndex: i,
        sourceLanguage: el.source.value,
        targetLanguage: el.target.value,
        context: state.memory,
      }),
    });
    p.analysis = j.analysis;
    p.engine = j.engine;
    absorbContext(j.analysis);
    const review = j.analysis.blocks.filter(b => b.needsReview).length;
    st.textContent = `${j.analysis.blocks.length} blocos${review ? ` · ${review} revisar` : ''}`;
    st.className = review ? 'badge st warn' : 'badge st ok';
    if (p.visible) draw(i, true);
    renderBlocks(i);
    updateProgress();
    if (!batch) setStatus(`Página ${i + 1} pronta (${j.engine === 'specialized-worker' ? 'worker especializado' : 'AI Gateway'}).`);
  } catch (e) {
    st.textContent = e.message;
    st.className = 'badge st err';
    if (!batch) setStatus(e.message, true);
    throw e;
  } finally {
    btn.disabled = false;
  }
}

function absorbContext(analysis) {
  if (analysis.summary) state.memory.summary = `${state.memory.summary} ${analysis.summary}`.trim().slice(-4500);
  const glossary = new Map(state.memory.glossary.map(g => [g.source.toLowerCase(), g]));
  for (const g of analysis.glossary || []) {
    if (g.source && g.target) glossary.set(g.source.toLowerCase(), { source: g.source, target: g.target });
  }
  state.memory.glossary = [...glossary.values()].slice(-70);
  for (const b of analysis.blocks || []) state.memory.history.push({ original: b.original, translated: b.translated });
  state.memory.history = state.memory.history.slice(-90);
}

function applyView(i) {
  const c = card(i);
  if (!c) return;
  const img = c.querySelector('.original');
  const cv = c.querySelector('.clean');
  const layer = c.querySelector('.layer');
  if (state.view === 'original') {
    img.style.opacity = '1'; cv.style.opacity = '0'; layer.style.opacity = '0';
  } else if (state.view === 'compare') {
    img.style.opacity = '1'; cv.style.opacity = '.58'; layer.style.opacity = '.9';
  } else {
    img.style.opacity = '0'; cv.style.opacity = '1'; layer.style.opacity = '1';
  }
}

function canvasScale(w, h) {
  return Math.min(1, MAX_CANVAS_SIDE / Math.max(w, h), Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
}
function releaseCanvas(i) {
  const c = card(i);
  if (!c) return;
  const cv = c.querySelector('canvas');
  if (cv.width * cv.height > MAX_CANVAS_PIXELS * .2) {
    cv.width = 1;
    cv.height = 1;
    c.querySelector('.layer').innerHTML = '';
  }
}
function draw(i, force = false) {
  const p = state.pages[i];
  const c = card(i);
  if (!c) return;
  const img = c.querySelector('img');
  const cv = c.querySelector('canvas');
  const layer = c.querySelector('.layer');
  if (!img.complete || !img.naturalWidth) return;
  if (!p.visible && !force) return;

  const scale = canvasScale(img.naturalWidth, img.naturalHeight);
  const cw = Math.max(1, Math.round(img.naturalWidth * scale));
  const ch = Math.max(1, Math.round(img.naturalHeight * scale));
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  layer.innerHTML = '';

  const blocks = p.analysis?.blocks || [];
  if (el.safe.checked) for (const b of blocks) eraseSource(ctx, b, cw, ch);
  for (const b of blocks) addTextOverlay(layer, b, i);
  requestAnimationFrame(() => layer.querySelectorAll('.txt').forEach(fitText));
  applyView(i);
}

function pxBox(box, w, h, expand = 0) {
  const x = box.x / 100 * w;
  const y = box.y / 100 * h;
  const bw = box.w / 100 * w;
  const bh = box.h / 100 * h;
  const ex = Math.min(Math.max(2, Math.min(bw, bh) * expand), 24);
  const rx = Math.max(0, Math.floor(x - ex));
  const ry = Math.max(0, Math.floor(y - ex));
  const rw = Math.min(w - rx, Math.ceil(bw + ex * 2));
  const rh = Math.min(h - ry, Math.ceil(bh + ex * 2));
  return { x: rx, y: ry, w: Math.max(1, rw), h: Math.max(1, rh) };
}
function hexRgb(hex) {
  const clean = /^#[0-9a-f]{6}$/i.test(String(hex || '')) ? String(hex) : '#ffffff';
  const n = parseInt(clean.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function median(values) {
  if (!values.length) return 255;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}
function sampleBackground(ctx, r, fallback) {
  const pad = Math.max(3, Math.round(Math.min(r.w, r.h) * .1));
  const x0 = Math.max(0, r.x - pad);
  const y0 = Math.max(0, r.y - pad);
  const x1 = Math.min(ctx.canvas.width, r.x + r.w + pad);
  const y1 = Math.min(ctx.canvas.height, r.y + r.h + pad);
  const d = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  const rs = [], gs = [], bs = [];
  for (let yy = 0; yy < d.height; yy += 2) {
    for (let xx = 0; xx < d.width; xx += 2) {
      const inside = xx >= r.x - x0 && xx < r.x - x0 + r.w && yy >= r.y - y0 && yy < r.y - y0 + r.h;
      if (inside) continue;
      const k = (yy * d.width + xx) * 4;
      rs.push(d.data[k]); gs.push(d.data[k + 1]); bs.push(d.data[k + 2]);
    }
  }
  return rs.length < 8 ? hexRgb(fallback) : [median(rs), median(gs), median(bs)];
}

function eraseSource(ctx, b, W, H) {
  if (!b?.textBox || b.eraseMode === 'none' || b.eraseMode === 'complex') return;
  if (b.type === 'sfx' && el.preserveSfx.checked) return;
  const r = pxBox(b.textBox, W, H, b.eraseMode === 'flat' ? .1 : .06);
  if (r.w < 2 || r.h < 2) return;
  const bg = sampleBackground(ctx, r, b.backgroundColor);
  const text = hexRgb(b.style?.textColor || '#111111');
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const data = img.data;

  if (b.eraseMode === 'flat') {
    const marked = new Uint8Array(r.w * r.h);
    for (let p = 0, q = 0; p < data.length; p += 4, q++) {
      const rgb = [data[p], data[p + 1], data[p + 2]];
      if (dist(rgb, text) < 115 && dist(rgb, bg) > 28) marked[q] = 1;
    }
    const grown = marked.slice();
    for (let y = 1; y < r.h - 1; y++) {
      for (let x = 1; x < r.w - 1; x++) {
        const q = y * r.w + x;
        if (!marked[q]) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) grown[(y + dy) * r.w + (x + dx)] = 1;
      }
    }
    const coverage = grown.reduce((a, v) => a + v, 0) / grown.length;
    if (coverage > .42) return;
    for (let q = 0, p = 0; q < grown.length; q++, p += 4) {
      if (!grown[q]) continue;
      data[p] = bg[0]; data[p + 1] = bg[1]; data[p + 2] = bg[2];
    }
  } else {
    let marked = 0;
    for (let p = 0; p < data.length; p += 4) {
      const rgb = [data[p], data[p + 1], data[p + 2]];
      if (dist(rgb, text) < 86 && dist(rgb, bg) > 24) {
        marked++;
        const blend = .78;
        data[p] = data[p] * (1 - blend) + bg[0] * blend;
        data[p + 1] = data[p + 1] * (1 - blend) + bg[1] * blend;
        data[p + 2] = data[p + 2] * (1 - blend) + bg[2] * blend;
      }
    }
    if (marked / (r.w * r.h) > .32) return;
  }
  ctx.putImageData(img, r.x, r.y);
}

function fontFamily(role) {
  if (role === 'sfx' || role === 'shout') return '"Bangers", "Impact", "Arial Black", sans-serif';
  if (role === 'handwritten') return '"Caveat", "Comic Sans MS", cursive';
  if (role === 'narration') return '"Noto Serif", Georgia, serif';
  if (role === 'system') return '"Noto Sans", Arial, sans-serif';
  return '"Comic Neue", "Noto Sans", Arial, sans-serif';
}
function addTextOverlay(layer, b, pageIndex) {
  if (!b?.translated) return;
  const box = b.containerDetected ? b.containerBox : b.textBox;
  if (!box) return;
  const s = b.style || {};
  const d = document.createElement('div');
  const unsafe = b.eraseMode === 'complex' || b.eraseMode === 'none';
  d.className = `txt role-${s.role || 'dialogue'}${b.needsReview ? ' review' : ''}${unsafe ? ' unsafe' : ''}`;
  d.contentEditable = 'true';
  d.spellcheck = false;
  d.dataset.id = b.id;
  d.textContent = s.uppercase ? String(b.translated).toUpperCase() : b.translated;
  const preserveVertical = s.orientation === 'vertical' && (b.type === 'sfx' || b.type === 'sign');
  const strokePx = Math.max(0, Number(s.strokeWidth || 0)) * .38;
  const shadows = strokePx > 0 ? [
    `${strokePx}px 0 ${s.strokeColor || '#fff'}`, `-${strokePx}px 0 ${s.strokeColor || '#fff'}`,
    `0 ${strokePx}px ${s.strokeColor || '#fff'}`, `0 -${strokePx}px ${s.strokeColor || '#fff'}`,
  ].join(',') : 'none';

  Object.assign(d.style, {
    left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
    transform: `rotate(${b.rotation || 0}deg)`, transformOrigin: 'center',
    fontFamily: fontFamily(s.role), fontWeight: String(s.weight || 700), fontStyle: s.italic ? 'italic' : 'normal',
    color: s.textColor || '#111111', textAlign: s.align || 'center',
    letterSpacing: `${s.letterSpacing || 0}em`, lineHeight: String(s.lineHeight || 1.05),
    WebkitTextStroke: `${strokePx}px ${s.strokeColor || '#ffffff'}`, textShadow: shadows,
    writingMode: preserveVertical ? 'vertical-rl' : 'horizontal-tb',
    textOrientation: preserveVertical ? 'upright' : 'mixed',
  });

  if (unsafe && el.safe.checked && !(b.type === 'sfx' && el.preserveSfx.checked)) {
    d.style.background = `${b.backgroundColor || '#ffffff'}e8`;
    d.style.borderRadius = '8px';
    d.style.padding = '3px';
  }
  if (b.type === 'sfx' && el.preserveSfx.checked) {
    d.classList.add('sfx-translation');
    d.style.width = `${Math.max(5, Math.min(box.w * .72, 22))}%`;
    d.style.height = `${Math.max(box.h * .4, 3)}%`;
  }
  d.onblur = () => {
    b.translated = d.textContent.trim();
    renderBlocks(pageIndex);
  };
  layer.appendChild(d);
}

function fitText(d) {
  if (!d.clientWidth || !d.clientHeight) return;
  const vertical = d.style.writingMode.startsWith('vertical');
  let lo = 5.5;
  let hi = Math.max(12, Math.min(110, (vertical ? d.clientWidth : d.clientHeight) * .96));
  let best = lo;
  for (let n = 0; n < 10; n++) {
    const mid = (lo + hi) / 2;
    d.style.fontSize = `${mid}px`;
    const fits = d.scrollHeight <= d.clientHeight + 1 && d.scrollWidth <= d.clientWidth + 1;
    if (fits) { best = mid; lo = mid + .25; }
    else hi = mid - .25;
  }
  d.style.fontSize = `${Math.max(5.5, best)}px`;
}

function renderBlocks(i) {
  const p = state.pages[i];
  const host = card(i).querySelector('.blocks');
  host.innerHTML = '';
  for (const b of p.analysis?.blocks || []) {
    const d = document.createElement('div');
    d.className = `block${b.needsReview ? ' needs-review' : ''}`;
    d.innerHTML = `<div class="block-head"><span class="pill">${esc(b.type)}</span><span class="muted">conf. ${Math.round((b.confidence || 0) * 100)}% · ${esc(b.style?.role || '')} · limpeza ${esc(b.eraseMode)}</span></div><div class="original-text">${esc(b.original)}</div>`;
    const ta = document.createElement('textarea');
    ta.value = b.translated;
    ta.onchange = () => { b.translated = ta.value; if (p.visible) draw(i, true); };
    d.appendChild(ta);
    if (b.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = b.note;
      d.appendChild(note);
    }
    host.appendChild(d);
  }
}
