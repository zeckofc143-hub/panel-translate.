# Panel Translate MAX

Tradutor automático de capítulos MangaDex com foco em scanlation: OCR/layout, tradução contextual, redraw conservador e typesetting adaptativo.

## Pipeline atual

1. Recebe URL/UUID de capítulo MangaDex.
2. Usa a API oficial do MangaDex e MangaDex@Home para obter as páginas.
3. AI Gateway/Vercel OIDC chama um modelo multimodal em duas etapas:
   - visão/OCR/layout/estilo;
   - tradução contextual PT-BR com memória de capítulo e glossário.
4. O frontend preserva posição/rotação/alinhamento, escolhe fonte por função visual, replica cor/contorno/peso e ajusta o tamanho até caber no balão.
5. Redraw seguro apaga apenas pixels semelhantes à cor do texto em fundos classificados como `flat`/`simple`. Regiões `complex`/`none` são preservadas e marcadas para revisão para evitar apagar arte.
6. SFX artístico é preservado por padrão e recebe tradução menor próxima ao efeito.

## Autenticação de IA

No Vercel, o backend usa nesta ordem:

- `AI_GATEWAY_API_KEY`, se definida;
- `VERCEL_OIDC_TOKEN`, disponibilizado automaticamente em deployments Vercel.

Não coloque chaves no frontend nem faça commit de segredos.

## Modelos

- `VISION_MODEL` (opcional), padrão: `google/gemini-3.6-flash`
- `TRANSLATION_MODEL` (opcional), padrão: o mesmo de visão

## Worker especializado opcional

O backend já aceita `MANGA_WORKER_URL` e `MANGA_WORKER_TOKEN`. Quando um worker compatível estiver configurado, ele tem prioridade e o AI Gateway vira fallback.

A versão futura do worker deve usar detector/segmentação próprio para quadrinhos (ex.: comic-text-detector), OCR dedicado (Manga OCR para japonês; PaddleOCR para idiomas CJK adicionais) e inpainting especializado (ex.: LaMa). Isso é melhor para redraw complexo, mas exige mais memória/CPU/GPU do que uma Vercel Function comum.

Contrato esperado:

`POST $MANGA_WORKER_URL/analyze`

Entrada JSON: `image` (data URL), `sourceLanguage`, `targetLanguage`, `context`.

Saída JSON: `{ "analysis": { ... } }` no mesmo formato retornado por `/api/analyze`.

## Segurança visual

O sistema é deliberadamente conservador: quando não consegue separar texto e desenho com confiança, não destrói a arte automaticamente. O bloco fica editável e marcado para revisão.
