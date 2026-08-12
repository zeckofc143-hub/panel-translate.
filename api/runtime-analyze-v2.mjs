const MD='https://api.mangadex.org';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UA='PanelTranslate/5.0';
const DEFAULT_WORKER='https://manga-process-worker--zeckofc143.replit.app';
const WORKER=String(process.env.MANGA_WORKER_URL||DEFAULT_WORKER).replace(/\/+$/,'');
const WORKER_TOKEN=process.env.MANGA_WORKER_TOKEN||'';

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
  if(buf.length>18*1024*1024) throw Error('Página grande demais para análise.');
  return {buf,type:r.headers.get('content-type')||'image/jpeg'};
}

function pickImage(j){
  return j?.renderedImageUrl||j?.rendered_image_url||j?.outputImageUrl||j?.output_image_url||j?.imageUrl||j?.image_url||j?.result?.renderedImageUrl||j?.result?.imageUrl||j?.renderedImageDataUrl||j?.rendered_image_data_url||j?.imageDataUrl||null;
}

function pickAnalysis(j){
  return j?.analysis||j?.result?.analysis||j?.data?.analysis||null;
}

async function callWorker(im,payload){
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),170000);
  try{
    const r=await fetch(`${WORKER}/analyze`,{
      method:'POST',
      signal:ctl.signal,
      headers:{'Content-Type':'application/json',...(WORKER_TOKEN?{Authorization:`Bearer ${WORKER_TOKEN}`}:{})},
      body:JSON.stringify({
        image:`data:${im.type};base64,${im.buf.toString('base64')}`,
        sourceLanguage:payload.sourceLanguage||'auto',
        targetLanguage:payload.targetLanguage||'pt-BR',
        context:payload.context||{},
        options:{
          detector:'ctd',
          ocr:'mocr',
          inpainter:'lama_large',
          renderer:'manga2eng',
          preserveArt:true,
          translateSfx:true,
          renderFinalImage:true
        }
      })
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok) return {ok:false,status:r.status,message:j?.detail||j?.error?.message||j?.message||`Worker falhou (${r.status}).`};
    const analysis=pickAnalysis(j);
    const renderedImageUrl=pickImage(j);
    if(!analysis && !renderedImageUrl) return {ok:false,status:502,message:'Worker respondeu sem análise nem imagem renderizada.'};
    return {ok:true,analysis,renderedImageUrl,worker:j?.worker||j?.components||j?.health||null};
  }catch(e){
    return {ok:false,status:e?.name==='AbortError'?504:502,message:e?.name==='AbortError'?'Worker excedeu o tempo de processamento.':(e?.message||'Worker indisponível.')};
  }finally{
    clearTimeout(timer);
  }
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try{
    if(req.method!=='POST') return res.status(405).json({ok:false,error:{message:'Use POST.'}});
    const p=await readBody(req);
    if(!UUID.test(p.chapterId||'')) return res.status(400).json({ok:false,error:{message:'ID do capítulo inválido.'}});
    const index=Number(p.pageIndex);
    if(!Number.isInteger(index)||index<0) return res.status(400).json({ok:false,error:{message:'Índice da página inválido.'}});
    const im=await getPage(p.chapterId,index);
    const worker=await callWorker(im,p);
    if(!worker.ok){
      return res.status(200).json({ok:true,fallback:true,workerError:worker.message,workerStatus:worker.status});
    }
    return res.status(200).json({
      ok:true,
      analysis:worker.analysis||{detectedLanguage:'',summary:'',glossary:[],blocks:[]},
      renderedImageUrl:worker.renderedImageUrl||null,
      engine:'specialized-worker',
      worker:worker.worker||null
    });
  }catch(e){
    return res.status(200).json({ok:true,fallback:true,workerError:e?.message||'Worker indisponível.'});
  }
}
