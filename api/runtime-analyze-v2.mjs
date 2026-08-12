const MD='https://api.mangadex.org';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UA='PanelTranslate/6.0';
const HF_RENDER='https://kapanther-manga-translator.hf.space';

async function readBody(req){
  let s='';
  for await(const c of req){
    s+=c;
    if(s.length>1_500_000) throw Error('Requisição grande demais.');
  }
  return s?JSON.parse(s):{};
}

async function getPage(chapterId,index){
  const h=await fetch(`${MD}/at-home/server/${chapterId}`,{headers:{Accept:'application/json','User-Agent':UA}});
  if(!h.ok) throw Error(`MangaDex@Home falhou (${h.status}).`);
  const j=await h.json();
  const f=j.chapter?.data?.[index];
  if(!j.baseUrl||!j.chapter?.hash||!f) throw Error('Página não encontrada.');
  const r=await fetch(`${j.baseUrl}/data/${j.chapter.hash}/${encodeURIComponent(f)}`,{headers:{'User-Agent':UA}});
  if(!r.ok) throw Error(`Falha ao baixar a página (${r.status}).`);
  const buf=Buffer.from(await r.arrayBuffer());
  if(buf.length>18*1024*1024) throw Error('Página grande demais para renderização.');
  return {buf,type:r.headers.get('content-type')||'image/jpeg'};
}

function languageName(code){
  const c=String(code||'auto').toLowerCase();
  if(c==='ja'||c.startsWith('jap')) return 'Japanese';
  if(c==='ko'||c.startsWith('kor')) return 'Korean';
  if(c==='zh'||c.startsWith('chi')) return 'Chinese';
  if(c==='en'||c.startsWith('eng')) return 'English';
  if(c==='es'||c.startsWith('esp')) return 'Spanish';
  return 'Auto';
}

function targetName(code){
  const c=String(code||'pt-BR').toLowerCase();
  if(c.startsWith('pt')) return 'Portuguese (Brazil)';
  if(c.startsWith('en')) return 'English';
  if(c.startsWith('es')) return 'Spanish';
  return 'Portuguese (Brazil)';
}

function dataImage(buf,type){return `data:${type};base64,${buf.toString('base64')}`}

async function translateWithModel(im,p,model){
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),165000);
  try{
    const r=await fetch(`${HF_RENDER}/translate`,{
      method:'POST',
      signal:ctl.signal,
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({
        image:dataImage(im.buf,im.type),
        provider:'Google',
        api_key:process.env.GEMINI_API_KEY,
        model_name:model,
        input_language:languageName(p.sourceLanguage),
        output_language:targetName(p.targetLanguage),
        reading_direction:String(p.sourceLanguage||'auto').toLowerCase()==='ko'?'ltr':'rtl'
      })
    });
    const j=await r.json().catch(()=>null);
    if(!r.ok) throw Error(j?.detail||j?.error||j?.message||`Renderizador respondeu HTTP ${r.status}.`);
    const raw=j?.translated_image||j?.translatedImage;
    if(!raw||typeof raw!=='string') throw Error('Renderizador não devolveu a imagem traduzida.');
    const mime=j?.mime_type||j?.mimeType||'image/png';
    const b64=raw.includes(',')?raw.split(',',2)[1]:raw;
    return {buf:Buffer.from(b64,'base64'),mime,model};
  } finally {clearTimeout(timer)}
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method!=='POST') return res.status(405).json({ok:false,error:{message:'Use POST.'}});
    if(!process.env.GEMINI_API_KEY) return res.status(503).json({ok:false,error:{message:'GEMINI_API_KEY não configurada.'}});
    const p=await readBody(req);
    if(!UUID.test(p.chapterId||'')) return res.status(400).json({ok:false,error:{message:'ID do capítulo inválido.'}});
    const index=Number(p.pageIndex);
    if(!Number.isInteger(index)||index<0) return res.status(400).json({ok:false,error:{message:'Índice da página inválido.'}});

    const im=await getPage(p.chapterId,index);
    const candidates=[process.env.HF_RENDER_MODEL,process.env.GEMINI_MODEL,'gemini-3.6-flash','gemini-2.5-flash'].filter(Boolean);
    const models=[...new Set(candidates)];
    let out=null,last=null;
    for(const model of models){
      try{out=await translateWithModel(im,p,model);break}catch(e){last=e}
    }
    if(!out) throw last||Error('Renderizador indisponível.');

    res.statusCode=200;
    res.setHeader('Content-Type',out.mime||'image/png');
    res.setHeader('X-Panel-Render','huggingface-yolo-sam2');
    res.setHeader('X-Panel-Model',out.model);
    res.end(out.buf);
  }catch(e){
    res.statusCode=e?.name==='AbortError'?504:502;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify({ok:false,error:{message:e?.name==='AbortError'?'Renderização excedeu o tempo limite.':(e?.message||'Renderização indisponível.')}}));
  }
}
