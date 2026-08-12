(()=>{
  const nativeFetch=window.fetch.bind(window);
  const rendered=new Map();
  const inflight=new Set();

  function parseAnalyzeRequest(input,init){
    const url=typeof input==='string'?input:input?.url||'';
    if(!/\/api\/analyze(?:\?|$)/.test(url)) return null;
    if(String(init?.method||'GET').toUpperCase()!=='POST') return null;
    try{return JSON.parse(init?.body||'{}')}catch{return null}
  }

  async function jsonResponse(data,status=200,headers={}){
    return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});
  }

  window.fetch=async function(input,init={}){
    const req=parseAnalyzeRequest(input,init);
    if(!req) return nativeFetch(input,init);

    let specialized;
    try{
      specialized=await nativeFetch('/api/analyze-v2',init);
      const sj=await specialized.clone().json().catch(()=>null);
      if(specialized.ok && sj && !sj.fallback && (sj.analysis||sj.renderedImageUrl)){
        if(sj.renderedImageUrl && Number.isInteger(Number(req.pageIndex))){
          rendered.set(Number(req.pageIndex),sj.renderedImageUrl);
          scheduleApply(Number(req.pageIndex));
        }
        return jsonResponse(sj,200);
      }
    }catch{}

    return nativeFetch('/api/analyze-base',init);
  };

  function findPage(i){return document.querySelector(`.page[data-i="${i}"]`)}

  function scheduleApply(i){
    if(inflight.has(i)) return;
    inflight.add(i);
    const tries=[0,80,220,600,1200];
    for(const ms of tries) setTimeout(()=>apply(i),ms);
    setTimeout(()=>inflight.delete(i),1500);
  }

  function apply(i){
    const url=rendered.get(i);
    const page=findPage(i);
    if(!url||!page) return;
    const canvas=page.querySelector('canvas.clean');
    const layer=page.querySelector('.layer');
    const original=page.querySelector('img.original');
    if(!canvas||!original) return;

    const img=new Image();
    img.crossOrigin='anonymous';
    img.onload=()=>{
      const W=img.naturalWidth||original.naturalWidth;
      const H=img.naturalHeight||original.naturalHeight;
      if(!W||!H) return;
      canvas.width=W;
      canvas.height=H;
      const ctx=canvas.getContext('2d');
      ctx.clearRect(0,0,W,H);
      ctx.drawImage(img,0,0,W,H);
      canvas.dataset.workerRendered='1';
      if(layer){layer.innerHTML='';layer.style.opacity='0';layer.dataset.workerRendered='1';}
      page.dataset.workerRendered='1';
      const st=page.querySelector('.st');
      if(st && !/worker/.test(st.textContent||'')) st.textContent=`${st.textContent} · worker`;
    };
    img.onerror=()=>{};
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

  window.__panelWorkerRendered=rendered;
})();
