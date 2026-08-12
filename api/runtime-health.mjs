export default async function handler(req, res) {
  const headerToken = req.headers?.['x-vercel-oidc-token'] || '';
  const apiKey = process.env.AI_GATEWAY_API_KEY || '';
  const envOidc = process.env.VERCEL_OIDC_TOKEN || '';
  const token = apiKey || headerToken || envOidc;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    aiConfigured: Boolean(token),
    auth: apiKey ? 'ai-gateway-key' : headerToken ? 'vercel-oidc' : envOidc ? 'vercel-oidc-env' : 'none',
    visionModel: process.env.VISION_MODEL || 'google/gemini-3.6-flash',
    translationModel: process.env.TRANSLATION_MODEL || 'openai/gpt-5.6-sol',
    workerConfigured: Boolean(process.env.MANGA_WORKER_URL),
  });
}
