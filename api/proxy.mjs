const MANGADEX_API = 'https://api.mangadex.org';
const USER_AGENT = 'PanelTranslate/2.0 (+https://vercel.app)';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AI_TOKEN = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || '';
const VISION_MODEL = process.env.VISION_MODEL || 'google/gemini-3.6-flash';
const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL || VISION_MODEL;
const WORKER_URL = String(process.env.MANGA_WORKER_URL || '').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.MANGA_WORKER_TOKEN || '';
const AI_BASE = 'https://ai-gateway.vercel.sh/v1';

function send(res, status, data, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })) res.setHeader(k, v);
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
function fail(res, status, code, message, detail) {
  return send(res, status, { ok: false, error: { code, message, ...(detail ? { detail } : {}) } });
}
function clamp(n, min, max) { n = Number(n); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
function cleanHex(v, fallback) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : fallback; }
function cleanBox(b = {}) {
  return {
    x: clamp(b.x, 0, 100), y: clamp(b.y, 0, 100),
    w: clamp(b.w, 0.2, 100), h: clamp(b.h, 0.2, 100),
  };
}
function boxInside(b) {
  b.x = Math.min(b.x, 100 - b.w); b.y = Math.min(b.y, 100 - b.h); return b;
}
function chapterId(value) {
  const raw = String(value || '').trim();
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  let u;
  try { u = new URL(raw); } catch { throw new Error('URL inválida. Cole o link do capítulo do MangaDex.'); }
  if (!/(^|\.)mangadex\.org$/i.test(u.hostname)) throw new Error('Por enquanto, use um link de capítulo do MangaDex.');
  const parts = u.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('chapter');
  const id = parts[idx + 1];
  if (!UUID_RE.test(id || '')) throw new Error('Não encontrei um ID de capítulo válido no link.');
  return id.toLowerCase();
}
async function md(path) {
  return fetch(MANGADEX_API + path, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
}
async function chapterMeta(id) {
  const r = await md(`/chapter/${id}?includes[]=manga&includes[]=scanlation_group`);
  if (!r.ok) throw new Error(`MangaDex recusou os metadados (${r.status}).`);
  const j = await r.json();
  const a = j.data?.attributes || {};
  const rel = j.data?.relationships || [];
  const manga = rel.find(x => x.type === 'manga');
  const group = rel.find(x => x.type === 'scanlation_group');
  const title = manga?.attributes?.title || {};
  return {
    id: j.data.id,
    mangaTitle: title.en || title['pt-br'] || title.ja || Object.values(title)[0] || 'Mangá',
    chapter: a.chapter || '', title: a.title || '', volume: a.volume || '',
    translatedLanguage: a.translatedLanguage || '',
    group: group?.attributes?.name || '',
    externalUrl: a.externalUrl || null,
  };
}
async function atHome(id) {
  const r = await md(`/at-home/server/${id}`);
  if (!r.ok) throw new Error(`MangaDex não liberou as páginas (${r.status}).`);
  const j = await r.json();
  if (!j.baseUrl || !j.chapter?.hash || !j.chapter?.data?.length) throw new Error('Este capítulo não possui páginas disponíveis no MangaDex@Home.');
  return j;
}
async function pageBytes(id, index) {
  const h = await atHome(id);
  const file = h.chapter.data[Number(index)];
  if (!file) throw new Error('Página não encontrada.');
  const r = await fetch(`${h.baseUrl}/data/${h.chapter.hash}/${encodeURIComponent(file)}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!r.ok) throw new Error(`Falha ao baixar página (${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 18 * 1024 * 1024) throw new Error('Página grande demais para processamento automático.');
  return { buf, type: r.headers.get('content-type') || 'image/jpeg' };
}

const BOX_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
  required: ['x', 'y', 'w', 'h'],
};
const STYLE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    orientation: { type: 'string', enum: ['horizontal', 'vertical'] },
    align: { type: 'string', enum: ['left', 'center', 'right'] },
    role: { type: 'string', enum: ['dialogue', 'narration', 'shout', 'whisper', 'sfx', 'handwritten', 'system'] },
    weight: { type: 'integer', minimum: 300, maximum: 900 },
    italic: { type: 'boolean' }, uppercase: { type: 'boolean' },
    textColor: { type: 'string' }, strokeColor: { type: 'string' },
    strokeWidth: { type: 'number', minimum: 0, maximum: 6 },
    letterSpacing: { type: 'number', minimum: -0.08, maximum: 0.25 },
    lineHeight: { type: 'number', minimum: 0.75, maximum: 1.6 },
  },
  required: ['orientation', 'align', 'role', 'weight', 'italic', 'uppercase', 'textColor', 'strokeColor', 'strokeWidth', 'letterSpacing', 'lineHeight'],
};
const VISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    detectedLanguage: { type: 'string' },
    pageSummary: { type: 'string' },
    blocks: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, original: { type: 'string' },
          type: { type: 'string', enum: ['dialogue', 'narration', 'sfx', 'caption', 'sign', 'other'] },
          readingOrder: { type: 'integer' },
          textBox: BOX_SCHEMA, containerBox: BOX_SCHEMA,
          containerDetected: { type: 'boolean' }, rotation: { type: 'number' },
          confidence: { type: 'number', minimum: 0, maximum: 1 }, needsReview: { type: 'boolean' },
          eraseMode: { type: 'string', enum: ['flat', 'simple', 'complex', 'none'] },
          backgroundColor: { type: 'string' }, style: STYLE_SCHEMA,
        },
        required: ['id', 'original', 'type', 'readingOrder', 'textBox', 'containerBox', 'containerDetected', 'rotation', 'confidence', 'needsReview', 'eraseMode', 'backgroundColor', 'style'],
      },
    },
  },
  required: ['detectedLanguage', 'pageSummary', 'blocks'],
};
const TRANSLATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    pageSummaryPt: { type: 'string' },
    glossary: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { source: { type: 'string' }, target: { type: 'string' } }, required: ['source', 'target'] } },
    blocks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, translated: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, note: { type: 'string' } }, required: ['id', 'translated', 'confidence', 'note'] } },
  }, required: ['pageSummaryPt', 'glossary', 'blocks'],
};
function contextText(ctx) {
  const c = ctx || {};
  const glossary = Array.isArray(c.glossary) ? c.glossary.slice(-40) : [];
  const history = Array.isArray(c.history) ? c.history.slice(-50) : [];
  return [
    c.summary ? `Resumo acumulado: ${c.summary}` : '',
    glossary.length ? `Glossário fixado:\n${glossary.map(g => `${g.source} => ${g.target}`).join('\n')}` : '',
    history.length ? `Trechos anteriores:\n${history.map(h => `${h.original} => ${h.translated}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n') || '(sem contexto anterior)';
}
async function gateway(model, messages, schema, maxTokens = 12000) {
  if (!AI_TOKEN) throw new Error('AI Gateway ainda não está autenticado neste deployment. Faça um novo deploy para o Vercel disponibilizar o OIDC.');
  const r = await fetch(`${AI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_TOKEN}` },
    body: JSON.stringify({
      model, messages, stream: false, temperature: 0.1, max_tokens: maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: 'panel_translate_result', strict: true, schema } },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `AI Gateway falhou (${r.status}).`);
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error('O modelo não retornou uma análise utilizável.');
  try { return typeof content === 'string' ? JSON.parse(content) : content; }
  catch { throw new Error('O modelo retornou JSON inválido.'); }
}
function visionPrompt(sourceLanguage) {
  return `Você é o estágio de VISÃO/OCR de uma scanlation profissional. Analise a página inteira de mangá/manhwa/manhua em alta resolução.
OBJETIVO: detectar TODO texto relevante e medir layout/estilo com extrema precisão. NÃO traduza.
Idioma esperado: ${sourceLanguage || 'auto'}.
Regras:
- original deve conter somente texto realmente visível; nunca invente.
- Um bloco deve representar uma fala/narração/SFX/sign coerente, não cada caractere.
- Coordenadas x,y,w,h são percentuais 0..100 relativos à página.
- textBox envolve SOMENTE os glifos com pouca margem.
- containerBox representa a área segura do balão/caixa que pode receber a tradução. Se não houver balão/caixa, use uma área mínima ao redor do texto e containerDetected=false.
- readingOrder deve seguir a leitura natural da obra (mangá japonês geralmente direita→esquerda; webtoon/manhwa geralmente cima→baixo).
- rotation mede a inclinação visual real do texto em graus.
- style deve imitar o original: orientação, alinhamento, peso, itálico, caixa alta, cor, contorno, espaçamento e altura de linha.
- eraseMode=flat para balão quase uniforme; simple para textura leve; complex quando o texto cruza desenho/cenário; none quando apagar automaticamente for arriscado (logos, lettering artístico impossível de separar etc.).
- SFX integrado ao desenho deve ser type=sfx e normalmente complex/none.
- needsReview=true se OCR, caixa, cor ou separação texto/arte forem duvidosos.
- backgroundColor é uma estimativa hexadecimal do fundo imediatamente atrás dos glifos, útil só para flat/simple.
- Preserve pontuação, elongamentos, honoríficos, nomes e tom no OCR.`;
}
function translationPrompt(layout, targetLanguage, ctx) {
  const ordered = [...(layout.blocks || [])].sort((a, b) => a.readingOrder - b.readingOrder);
  return `Você é tradutor e editor de scanlation. Traduza do idioma detectado (${layout.detectedLanguage || 'auto'}) para ${targetLanguage || 'pt-BR'}.
A tradução deve soar natural em português brasileiro e manter intenção, personalidade, gênero de fala, piada, formalidade, honoríficos quando relevantes e continuidade da cena.
NÃO acrescente explicações dentro da tradução. Não traduza nomes próprios sem motivo. Preserve SFX curtos de forma natural para leitor brasileiro quando houver equivalente; se não houver, translitere/expresse o efeito de modo curto.
A tradução precisa CABER no mesmo balão. Prefira frases concisas sem perder sentido. Preserve reticências, exclamações e intensidade.
Use o contexto anterior apenas para consistência; ele não é texto a ser traduzido.

Contexto anterior:
${contextText(ctx)}

Resumo visual desta página: ${layout.pageSummary || ''}

Blocos em ordem:
${ordered.map(b => `[${b.id}] ${b.type}: ${b.original}`).join('\n')}`;
}
function sanitize(layout, translation) {
  const map = new Map((translation?.blocks || []).map(x => [String(x.id), x]));
  const blocks = (layout?.blocks || []).map((b, i) => {
    const t = map.get(String(b.id)) || {};
    const style = b.style || {};
    return {
      id: String(b.id || `b${i + 1}`), original: String(b.original || '').trim(), translated: String(t.translated || b.original || '').trim(),
      type: ['dialogue', 'narration', 'sfx', 'caption', 'sign', 'other'].includes(b.type) ? b.type : 'other',
      readingOrder: Number.isFinite(Number(b.readingOrder)) ? Number(b.readingOrder) : i,
      textBox: boxInside(cleanBox(b.textBox)), containerBox: boxInside(cleanBox(b.containerBox)),
      containerDetected: Boolean(b.containerDetected), rotation: clamp(b.rotation, -90, 90),
      confidence: Math.min(clamp(b.confidence, 0, 1), clamp(t.confidence ?? 1, 0, 1)),
      needsReview: Boolean(b.needsReview) || clamp(t.confidence ?? 1, 0, 1) < 0.72,
      eraseMode: ['flat', 'simple', 'complex', 'none'].includes(b.eraseMode) ? b.eraseMode : 'none',
      backgroundColor: cleanHex(b.backgroundColor, '#ffffff'),
      note: String(t.note || ''),
      style: {
        orientation: style.orientation === 'vertical' ? 'vertical' : 'horizontal',
        align: ['left', 'center', 'right'].includes(style.align) ? style.align : 'center',
        role: ['dialogue', 'narration', 'shout', 'whisper', 'sfx', 'handwritten', 'system'].includes(style.role) ? style.role : (b.type === 'sfx' ? 'sfx' : 'dialogue'),
        weight: Math.round(clamp(style.weight, 300, 900) / 100) * 100,
        italic: Boolean(style.italic), uppercase: Boolean(style.uppercase),
        textColor: cleanHex(style.textColor, '#111111'), strokeColor: cleanHex(style.strokeColor, '#ffffff'),
        strokeWidth: clamp(style.strokeWidth, 0, 6), letterSpacing: clamp(style.letterSpacing, -0.08, 0.25), lineHeight: clamp(style.lineHeight, 0.75, 1.6),
      },
    };
  }).filter(b => b.original);
  return {
    detectedLanguage: String(layout?.detectedLanguage || ''),
    summary: String(translation?.pageSummaryPt || layout?.pageSummary || ''),
    glossary: Array.isArray(translation?.glossary) ? translation.glossary.slice(0, 60).map(g => ({ source: String(g.source || ''), target: String(g.target || '') })).filter(g => g.source && g.target) : [],
    blocks,
  };
}
async function analyzeWithGateway(id, pageIndex, sourceLanguage, targetLanguage, context) {
  const im = await pageBytes(id, pageIndex);
  const image = `data:${im.type};base64,${im.buf.toString('base64')}`;
  const layout = await gateway(VISION_MODEL, [{ role: 'user', content: [
    { type: 'text', text: visionPrompt(sourceLanguage) },
    { type: 'image_url', image_url: { url: image, detail: 'high' } },
  ] }], VISION_SCHEMA, 14000);
  const translation = await gateway(TRANSLATION_MODEL, [{ role: 'user', content: translationPrompt(layout, targetLanguage, context) }], TRANSLATION_SCHEMA, 9000);
  return sanitize(layout, translation);
}
async function workerAnalyze(id, pageIndex, sourceLanguage, targetLanguage, context) {
  if (!WORKER_URL) return null;
  const im = await pageBytes(id, pageIndex);
  const r = await fetch(`${WORKER_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(WORKER_TOKEN ? { Authorization: `Bearer ${WORKER_TOKEN}` } : {}) },
    body: JSON.stringify({ image: `data:${im.type};base64,${im.buf.toString('base64')}`, sourceLanguage, targetLanguage, context }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.analysis || null;
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_500_000) throw new Error('Requisição grande demais.');
  }
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  try {
    const path = '/' + String(req.query.__path || '').replace(/^\/+|\/+$/g, '');
    if (req.method === 'GET' && path === '/health') {
      return send(res, 200, { ok: true, aiConfigured: Boolean(AI_TOKEN), auth: process.env.AI_GATEWAY_API_KEY ? 'api-key' : (process.env.VERCEL_OIDC_TOKEN ? 'vercel-oidc' : 'none'), visionModel: VISION_MODEL, translationModel: TRANSLATION_MODEL, workerConfigured: Boolean(WORKER_URL) });
    }
    if (req.method === 'POST' && path === '/chapter') {
      const body = await readBody(req); const id = chapterId(body.url || body.chapterId);
      const meta = await chapterMeta(id);
      if (meta.externalUrl) return fail(res, 409, 'EXTERNAL_CHAPTER', 'Este capítulo aponta para uma fonte externa e não fornece páginas pelo MangaDex@Home.');
      const home = await atHome(id);
      return send(res, 200, { ok: true, chapter: meta, pages: home.chapter.data.map((_, index) => ({ index, imageUrl: `/api/page/${id}/${index}` })) });
    }
    const pm = path.match(/^\/page\/([0-9a-f-]+)\/(\d+)$/i);
    if (req.method === 'GET' && pm) {
      const im = await pageBytes(pm[1], Number(pm[2]));
      res.statusCode = 200; res.setHeader('Content-Type', im.type); res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800'); res.setHeader('X-Content-Type-Options', 'nosniff'); return res.end(im.buf);
    }
    if (req.method === 'POST' && path === '/analyze') {
      const body = await readBody(req);
      if (!UUID_RE.test(body.chapterId || '')) return fail(res, 400, 'BAD_ID', 'ID de capítulo inválido.');
      const idx = Number(body.pageIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx > 999) return fail(res, 400, 'BAD_PAGE', 'Número de página inválido.');
      let analysis = await workerAnalyze(body.chapterId, idx, body.sourceLanguage, body.targetLanguage, body.context).catch(() => null);
      let engine = 'specialized-worker';
      if (!analysis) { analysis = await analyzeWithGateway(body.chapterId, idx, body.sourceLanguage, body.targetLanguage, body.context); engine = 'ai-gateway-vision'; }
      return send(res, 200, { ok: true, engine, analysis });
    }
    return fail(res, 404, 'NOT_FOUND', 'Rota não encontrada.');
  } catch (e) {
    return fail(res, 500, 'SERVER_ERROR', e?.message || 'Erro interno.');
  }
}
