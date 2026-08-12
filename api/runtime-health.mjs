const OFFICIAL='https://cotrans.touhou.ai';

export default async function handler(req, res) {
  const gemini = process.env.GEMINI_API_KEY || '';
  const headerToken = req.headers?.['x-vercel-oidc-token'] || '';
  const apiKey = process.env.AI_GATEWAY_API_KEY || '';
  const envOidc = process.env.VERCEL_OIDC_TOKEN || '';
  const gateway = apiKey || headerToken || envOidc;
  const auth = gemini ? 'gemini-direct' : apiKey ? 'ai-gateway-key' : headerToken ? 'vercel-oidc' : envOidc ? 'vercel-oidc-env' : 'none';

  let officialPipelineReachable = false;
  let officialQueueSize = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4500);
    const r = await fetch(`${OFFICIAL}/queue-size`, { method:'POST', signal: ctl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (r.ok) {
      officialPipelineReachable = true;
      officialQueueSize = await r.json().catch(() => null);
    }
  } catch {}

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    aiConfigured: Boolean(gemini || gateway),
    auth,
    preferredEngine: officialPipelineReachable ? 'manga-image-translator+gemini' : gemini ? 'gemini-direct' : gateway ? 'ai-gateway' : 'none',
    visionModel: gemini ? (process.env.GEMINI_MODEL || 'gemini-3.6-flash') : (process.env.VISION_MODEL || 'google/gemini-3.6-flash'),
    translationModel: gemini ? (process.env.GEMINI_MODEL || 'gemini-3.6-flash') : (process.env.TRANSLATION_MODEL || 'openai/gpt-5.6-sol'),
    gatewayAvailable: Boolean(gateway),
    workerConfigured: officialPipelineReachable,
    officialPipelineReachable,
    officialQueueSize,
    officialPipeline: OFFICIAL,
  });
}
