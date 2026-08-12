const RAF = new WeakMap();

const ROLE_FONTS = {
  dialogue: '"Comic Neue", "Noto Sans", Arial, sans-serif',
  narration: '"Noto Serif", Georgia, serif',
  handwritten: '"Caveat", "Comic Sans MS", cursive',
  whisper: '"Comic Neue", "Noto Sans", Arial, sans-serif',
  shout: '"Bangers", "Impact", "Arial Black", sans-serif',
  sfx: '"Bangers", "Impact", "Arial Black", sans-serif',
  system: '"Noto Sans", Arial, sans-serif',
};

const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
const luma = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = values => {
  if (!values.length) return 255;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function roleOf(el) {
  for (const role of Object.keys(ROLE_FONTS)) if (el.classList.contains(`role-${role}`)) return role;
  return 'dialogue';
}

function injectCss() {
  const s = document.createElement('style');
  s.textContent = `
    .txt{box-sizing:border-box!important;padding:5px 6px!important;text-wrap:balance!important;word-break:normal!important;overflow-wrap:anywhere!important;text-rendering:geometricPrecision!important;font-kerning:normal!important;font-synthesis:none!important;}
    .txt.pt-solid-panel{box-shadow:0 0 0 1px rgba(0,0,0,.05) inset!important;border-radius:8px!important;}
    .txt.role-dialogue{font-family:"Comic Neue","Noto Sans",Arial,sans-serif!important;}
    .txt.role-narration{font-family:"Noto Serif",Georgia,serif!important;}
    .txt.role-handwritten,.txt.role-whisper{font-family:"Caveat","Comic Neue",cursive!important;}
    .txt.role-sfx,.txt.role-shout{font-family:"Bangers","Impact","Arial Black",sans-serif!important;letter-spacing:.015em!important;}
    .txt.role-system{font-family:"Noto Sans",Arial,sans-serif!important;}
    .txt.pt-cleaned{background:transparent!important;box-shadow:none!important;}
  `;
  document.head.appendChild(s);
}

function percentBox(el) {
  return {
    x: parseFloat(el.style.left) || 0,
    y: parseFloat(el.style.top) || 0,
    w: parseFloat(el.style.width) || 1,
    h: parseFloat(el.style.height) || 1,
  };
}

function toPx(box, W, H) {
  return {
    x: Math.round(box.x / 100 * W),
    y: Math.round(box.y / 100 * H),
    w: Math.max(1, Math.round(box.w / 100 * W)),
    h: Math.max(1, Math.round(box.h / 100 * H)),
  };
}

function colorSamples(ctx, r) {
  const x0 = clamp(Math.floor(r.x), 0, ctx.canvas.width - 1);
  const y0 = clamp(Math.floor(r.y), 0, ctx.canvas.height - 1);
  const x1 = clamp(Math.ceil(r.x + r.w), x0 + 1, ctx.canvas.width);
  const y1 = clamp(Math.ceil(r.y + r.h), y0 + 1, ctx.canvas.height);
  const d = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  const rs = [], gs = [], bs = [], ls = [];
  const step = Math.max(1, Math.floor(Math.min(d.width, d.height) / 24));
  for (let y = 0; y < d.height; y += step) {
    for (let x = 0; x < d.width; x += step) {
      const edge = x < d.width * .22 || x > d.width * .78 || y < d.height * .22 || y > d.height * .78;
      if (!edge) continue;
      const k = (y * d.width + x) * 4;
      rs.push(d.data[k]); gs.push(d.data[k + 1]); bs.push(d.data[k + 2]);
      ls.push(luma(d.data[k], d.data[k + 1], d.data[k + 2]));
    }
  }
  const bg = [median(rs), median(gs), median(bs)];
  const L = luma(...bg);
  const variance = ls.length ? Math.sqrt(ls.reduce((a, v) => a + (v - L) ** 2, 0) / ls.length) : 999;
  return { bg, variance, lum: L };
}

function findBubble(ctx, sourceBox) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const b = toPx(sourceBox, W, H);
  const ex = Math.max(10, Math.round(b.w * .45));
  const ey = Math.max(10, Math.round(b.h * .45));
  const search = {
    x: clamp(b.x - ex, 0, W - 1),
    y: clamp(b.y - ey, 0, H - 1),
    w: clamp(b.w + ex * 2, 2, W),
    h: clamp(b.h + ey * 2, 2, H),
  };
  search.w = Math.min(search.w, W - search.x);
  search.h = Math.min(search.h, H - search.y);
  if (search.w < 8 || search.h < 8) return null;

  const d = ctx.getImageData(search.x, search.y, search.w, search.h);
  const center = {
    x: clamp(Math.round((b.x + b.w / 2) - search.x), 0, d.width - 1),
    y: clamp(Math.round((b.y + b.h / 2) - search.y), 0, d.height - 1),
  };

  const seedColors = [];
  const radii = [0, .12, -.12, .24, -.24];
  for (const dx of radii) for (const dy of radii) {
    const x = clamp(Math.round(center.x + b.w * dx), 0, d.width - 1);
    const y = clamp(Math.round(center.y + b.h * dy), 0, d.height - 1);
    const k = (y * d.width + x) * 4;
    seedColors.push([d.data[k], d.data[k + 1], d.data[k + 2]]);
  }
  const bg = [median(seedColors.map(c => c[0])), median(seedColors.map(c => c[1])), median(seedColors.map(c => c[2]))];
  const bgLum = luma(...bg);
  if (bgLum > 245 || bgLum < 18) {
    // still valid; many balloons are pure white/black
  }

  const step = Math.max(1, Math.round(Math.max(d.width, d.height) / 260));
  const gw = Math.ceil(d.width / step), gh = Math.ceil(d.height / step);
  const seen = new Uint8Array(gw * gh);
  const qx = new Int32Array(gw * gh), qy = new Int32Array(gw * gh);
  let head = 0, tail = 0;
  const sx = clamp(Math.round(center.x / step), 0, gw - 1);
  const sy = clamp(Math.round(center.y / step), 0, gh - 1);
  qx[tail] = sx; qy[tail++] = sy; seen[sy * gw + sx] = 1;
  let minX = sx, maxX = sx, minY = sy, maxY = sy, count = 0;
  const tolerance = bgLum > 190 || bgLum < 70 ? 46 : 38;

  while (head < tail && tail < seen.length) {
    const x = qx[head], y = qy[head++];
    const px = clamp(x * step, 0, d.width - 1), py = clamp(y * step, 0, d.height - 1);
    const k = (py * d.width + px) * 4;
    const rgb = [d.data[k], d.data[k + 1], d.data[k + 2]];
    if (dist(rgb, bg) > tolerance) continue;
    count++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
      const idx = ny * gw + nx;
      if (seen[idx]) continue;
      seen[idx] = 1; qx[tail] = nx; qy[tail++] = ny;
    }
  }

  const coverage = count / Math.max(1, gw * gh);
  if (coverage < .025) return null;
  const region = {
    x: search.x + minX * step,
    y: search.y + minY * step,
    w: Math.max(step * 2, (maxX - minX + 1) * step),
    h: Math.max(step * 2, (maxY - minY + 1) * step),
  };
  if (region.w < b.w * .55 || region.h < b.h * .55) return null;
  if (region.w > search.w * .98 && region.h > search.h * .98 && coverage > .88) return null;
  return { region, bg };
}

function eraseTextPixels(ctx, region, bg) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const insetX = Math.max(2, Math.round(region.w * .055));
  const insetY = Math.max(2, Math.round(region.h * .055));
  const r = {
    x: clamp(Math.round(region.x + insetX), 0, W - 1),
    y: clamp(Math.round(region.y + insetY), 0, H - 1),
    w: Math.max(1, Math.round(region.w - insetX * 2)),
    h: Math.max(1, Math.round(region.h - insetY * 2)),
  };
  r.w = Math.min(r.w, W - r.x); r.h = Math.min(r.h, H - r.y);
  if (r.w < 4 || r.h < 4) return false;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const data = img.data;
  const bgLum = luma(...bg);
  const mask = new Uint8Array(r.w * r.h);
  let marked = 0;
  for (let p = 0, q = 0; p < data.length; p += 4, q++) {
    const rgb = [data[p], data[p + 1], data[p + 2]];
    const L = luma(...rgb);
    const contrast = bgLum > 135 ? (L < bgLum - 42) : (L > bgLum + 42);
    if (contrast && dist(rgb, bg) > 36) { mask[q] = 1; marked++; }
  }
  const ratio = marked / mask.length;
  if (ratio < .001 || ratio > .28) return false;
  const grown = mask.slice();
  const radius = Math.max(1, Math.round(Math.max(W, H) / 1800));
  for (let y = radius; y < r.h - radius; y++) for (let x = radius; x < r.w - radius; x++) {
    const q = y * r.w + x;
    if (!mask[q]) continue;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) grown[(y + dy) * r.w + (x + dx)] = 1;
  }
  for (let q = 0, p = 0; q < grown.length; q++, p += 4) {
    if (!grown[q]) continue;
    data[p] = bg[0]; data[p + 1] = bg[1]; data[p + 2] = bg[2]; data[p + 3] = 255;
  }
  ctx.putImageData(img, r.x, r.y);
  return true;
}

function setBoxFromPixels(el, r, W, H) {
  const padX = Math.max(2, r.w * .045), padY = Math.max(2, r.h * .05);
  const x = clamp((r.x + padX) / W * 100, 0, 99.8);
  const y = clamp((r.y + padY) / H * 100, 0, 99.8);
  const w = clamp((r.w - padX * 2) / W * 100, .2, 100 - x);
  const h = clamp((r.h - padY * 2) / H * 100, .2, 100 - y);
  el.style.left = `${x}%`; el.style.top = `${y}%`; el.style.width = `${w}%`; el.style.height = `${h}%`;
}

function rgbCss(bg) { return `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`; }

function fitText(el) {
  if (!el.clientWidth || !el.clientHeight) return;
  const vertical = getComputedStyle(el).writingMode.startsWith('vertical');
  let lo = 6, hi = Math.max(12, Math.min(96, (vertical ? el.clientWidth : el.clientHeight) * .9)), best = lo;
  const oldSpacing = parseFloat(getComputedStyle(el).letterSpacing) || 0;
  for (let i = 0; i < 11; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = `${mid}px`;
    const fits = el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
    if (fits) { best = mid; lo = mid + .15; } else hi = mid - .15;
  }
  el.style.fontSize = `${Math.max(6, best)}px`;
  if ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && !vertical) {
    el.style.letterSpacing = `${Math.min(0, oldSpacing - .25)}px`;
    el.style.lineHeight = '.98';
  }
}

function enhanceText(ctx, el) {
  const role = roleOf(el);
  el.style.fontFamily = ROLE_FONTS[role] || ROLE_FONTS.dialogue;
  if (role === 'shout' || role === 'sfx') el.style.fontWeight = '800';
  if (role === 'whisper') el.style.fontWeight = '500';

  if (role === 'sfx' || el.classList.contains('sfx-translation')) {
    el.style.background = 'transparent';
    el.classList.add('pt-cleaned');
    fitText(el);
    return;
  }

  const sourceBox = percentBox(el);
  const found = findBubble(ctx, sourceBox);
  if (found) {
    const cleaned = eraseTextPixels(ctx, found.region, found.bg);
    if (cleaned) {
      setBoxFromPixels(el, found.region, ctx.canvas.width, ctx.canvas.height);
      el.style.background = 'transparent';
      el.classList.remove('pt-solid-panel');
      el.classList.add('pt-cleaned');
    } else {
      el.style.background = rgbCss(found.bg);
      el.classList.add('pt-solid-panel');
    }
  } else {
    const px = toPx(sourceBox, ctx.canvas.width, ctx.canvas.height);
    const sampled = colorSamples(ctx, px);
    const bg = sampled.bg;
    el.style.background = rgbCss(bg);
    el.style.borderRadius = role === 'narration' || role === 'system' ? '4px' : '9px';
    el.classList.add('pt-solid-panel');
  }
  fitText(el);
}

function enhanceArticle(article) {
  const canvas = article.querySelector('canvas.clean');
  const layer = article.querySelector('.layer');
  if (!canvas || !layer || canvas.width < 8 || canvas.height < 8) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const texts = [...layer.querySelectorAll('.txt')];
  if (!texts.length) return;
  for (const el of texts) enhanceText(ctx, el);
}

function schedule(article) {
  if (!article || RAF.has(article)) return;
  RAF.set(article, requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      RAF.delete(article);
      try { enhanceArticle(article); } catch (e) { console.debug('lettering-fix', e); }
    });
  }));
}

injectCss();
const observer = new MutationObserver(mutations => {
  const pages = new Set();
  for (const m of mutations) {
    const page = m.target?.closest?.('.page');
    if (page) pages.add(page);
    for (const n of m.addedNodes || []) {
      if (!(n instanceof Element)) continue;
      const p = n.closest?.('.page') || n.querySelector?.('.page');
      if (p) pages.add(p);
    }
  }
  for (const p of pages) schedule(p);
});
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('resize', () => document.querySelectorAll('.page').forEach(schedule), { passive: true });
setInterval(() => document.querySelectorAll('.page').forEach(p => {
  const layer = p.querySelector('.layer');
  if (layer?.children.length) schedule(p);
}), 1800);
