(()=>{
  const nativeFetch=window.fetch.bind(window);
  const OFFICIAL='https://cotrans.touhou.ai';
  const rendered=new Map();
  const jobs=new Map();
  const applyTimers=new Map();

  function parseAnalyzeRequest(input,init){
    const url=typeof input==='string'?input:input?.url||'';
    if(!/\/api\/analyze(?:\?|$)/.test(url)) return null;
    if(String(init?.method||'GET').toUpperCase()!=='POST') return null;
    try{return JSON.parse(init?.body||'{}')}catch{return null}
  }

  function pageEl(i){return document.querySelector(`.page[data-i="${i}"]`)}
  function originalUrl(i){
    const img=pageEl(i)?.querySelector('img.original');
    if(!img) return null;
    try{return new URL(img.currentSrc||img.src,location.href).href}catch{return null}
  }

  function setPageStatus(i,text,kind='working'){
    const st=pageEl(i)?.querySelector('.st');
    if(!st) return;
    st.textContent=text;
    st.className=`badge st ${kind}`;
  }

  function targetCode(target){
    const t=String(target||'pt-BR').toLowerCase();
    if(t.startsWith('pt')) return 'PTB';
    if(t.startsWith('en')) return 'ENG';
    if(t.startsWith('es')) return 'ESP';
    return 'PTB';
  }

  function ocrFor(source){
    return String(source||'auto').toLowerCase()==='ja'?'mocr':'48px';
  }

  function configFor(req,translator){
    return {
      render:{renderer:'manga2eng',alignment:'auto',direction:'auto',disable_font_border:false,no_hyphenation:true},
      translator:{translator,target_lang:targetCode(req.targetLanguage),enable_post_translation_check:true,post_check_max_retry_attempts:2},
      detector:{detector:'default',detection_size:2048,text_threshold:.45,box_threshold:.62,unclip_ratio:2.3,det_auto_rotate:true},
      inpainter:{inpainter:'lama_large',inpainting_size:2048,inpainting_precision:'bf16'},
      ocr:{ocr:ocrFor(req.sourceLanguage),use_mocr_merge:true,min_text_length:1,ignore_bubble:0},
      kernel_size:7,
      mask_dilation_offset:26,
      force_simple_sort:false
    };
  }

  async function officialImage(imageUrl,req,translator,timeoutMs){
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),timeoutMs);
    try{
      const r=await nativeFetch(`${OFFICIAL}/translate/image`,{
        method:'POST',
        mode:'cors',
        signal:ctl.signal,
        headers:{'Content-Type':'application/json','Accept':'image/png'},
        body:JSON.stringify({image:imageUrl,config:configFor(req,translator)})
      });
      if(!r.ok) throw new Error(`Servidor oficial: HTTP ${r.status}`);
      const type=r.headers.get('content-type')||'';
      if(!type.includes('image')) throw new Error('Servidor oficial não devolveu imagem.');
      return await r.blob();
    } finally {
      clearTimeout(timer);
    }
  }

  async function renderOfficial(i,req){
    if(jobs.has(i)) return jobs.get(i);
    const task=(async()=>{
      let imageUrl=null;
      for(let n=0;n<30 && !imageUrl;n++){
        imageUrl=originalUrl(i);
        if(!imageUrl) await new Promise(r=>setTimeout(r,100));
      }
      if(!imageUrl) return;
      setPageStatus(i,'OCR + redraw oficial…','working');
      let blob;
      try{
        blob=await officialImage(imageUrl,req,'gemini_2stage',120000);
      }catch(primary){
        try{
          blob=await officialImage(imageUrl,req,'offline',120000);
        }catch(fallback){
          console.warn('[Panel Translate] pipeline oficial indisponível',primary,fallback);
          const st=pageEl(i)?.querySelector('.st');
          if(st && /redraw oficial/.test(st.textContent||'')) setPageStatus(i,'análise pronta · render oficial indisponível','warn');
          return;
        }
      }
      const old=rendered.get(i);
      if(old) URL.revokeObjectURL(old);
      const url=URL.createObjectURL(blob);
      rendered.set(i,url);
      scheduleApply(i,true);
      setPageStatus(i,'traduzida · pipeline oficial','ok');
    })().finally(()=>jobs.delete(i));
    jobs.set(i,task);
    return task;
  }

  window.fetch=async function(input,init={}){
    const req=parseAnalyzeRequest(input,init);
    if(!req) return nativeFetch(input,init);
    const i=Number(req.pageIndex);
    if(Number.isInteger(i) && i>=0) renderOfficial(i,req);
    return nativeFetch('/api/analyze-base',init);
  };

  function scheduleApply(i,immediate=false){
    const old=applyTimers.get(i);
    if(old) clearTimeout(old);
    const t=setTimeout(()=>applyRendered(i),immediate?0:90);
    applyTimers.set(i,t);
  }

  function applyRendered(i){
    const url=rendered.get(i);
    const page=pageEl(i);
    if(!url||!page) return;
    const canvas=page.querySelector('canvas.clean');
    const layer=page.querySelector('.layer');
    const original=page.querySelector('img.original');
    if(!canvas||!original) return;
    const img=new Image();
    img.onload=()=>{
      const W=img.naturalWidth||original.naturalWidth;
      const H=img.naturalHeight||original.naturalHeight;
      if(!W||!H) return;
      canvas.width=W;
      canvas.height=H;
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,W,H);
      ctx.drawImage(img,0,0,W,H);
      canvas.dataset.officialRendered='1';
      if(layer){layer.innerHTML='';layer.style.opacity='0';layer.dataset.officialRendered='1';}
      page.dataset.officialRendered='1';
    };
    img.src=url;
  }

  const obs=new MutationObserver(muts=>{
    const touched=new Set();
    for(const m of muts){
      const el=m.target?.nodeType===1?m.target:m.target?.parentElement;
      const page=el?.closest?.('.page[data-i]');
      if(page) touched.add(Number(page.dataset.i));
    }
    for(const i of touched) if(rendered.has(i)) scheduleApply(i);
  });

  const start=()=>{
    const pages=document.querySelector('#pages');
    if(pages) obs.observe(pages,{subtree:true,childList:true,attributes:true,attributeFilter:['width','height','style']});
    else setTimeout(start,50);
  };
  start();

  addEventListener('beforeunload',()=>{for(const url of rendered.values()) URL.revokeObjectURL(url)});
  window.__panelOfficialRendered=rendered;
})();
