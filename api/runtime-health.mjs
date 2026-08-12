const DEFAULT_WORKER='https://manga-process-worker--zeckofc143.replit.app';

export default async function handler(req, res) {
  const gemini = process.env.GEMINI_API_KEY || '';
  const headerToken = req.headers?.['x-vercel-oidc-token'] || '';
  const apiKey = process.env.AI_GATEWAY_API_KEY || '';
  const envOidc = process.env.VERCEL_OIDC_TOKEN || '';
  const gateway = apiKey || headerToken || envOidc;
  const workerUrl = String(process.env.MANGA_WORKER_URL || DEFAULT_WORKER).replace(/\/+$/,'');
  const auth = gemini ? 'gemini-direct' : apiKey ? 'ai-gateway-key' : headerToken ? 'vercel-oidc' : envOidc ? 'vercel-oidc-env' : 'none';

  let workerReachable = false;
  let worker = null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(`${workerUrl}/health`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (r.ok) {
      workerReachable = true;
      worker = await r.json().catch(() => null);
    }
  } catch {}

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    aiConfigured: Boolean(gemini || gateway),
    auth,
    preferredEngine: workerReachable ? 'specialized-worker' : gemini ? 'gemini-direct' : gateway ? 'ai-gateway' : 'none',
    visionModel: gemini ? (process.env.GEMINI_MODEL || 'gemini-3.6-flash') : (process.env.VISION_MODEL || 'google/gemini-3.6-flash'),
    translationModel: gemini ? (process.env.GEMINI_MODEL || 'gemini-3.6-flash') : (process.env.TRANSLATION_MODEL || 'openai/gpt-5.6-sol'),
    gatewayAvailable: Boolean(gateway),
    workerConfigured: true,
    workerReachable,
    workerUrl,
    worker,
  });
}
