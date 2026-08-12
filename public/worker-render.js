(()=>{
  const nativeFetch=window.fetch.bind(window);
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
  function setPageStatus(i,text,kind='working'){
    const st=pageEl(i)?.querySelector('.st');
    if(!st) return;
    st.textContent=text;
    st.className=`badge st ${kind}`;
  }

  async function renderRemote(i,init){
    if(jobs.has(i)) return jobs.get(i);
    const task=(async()=>{
      setPageStatus(i,'análise + redraw especializado…','working');
      try{
        const r=await nativeFetch('/api/analyze-v2',init);
        if(!r.ok){
          const j=await r.json().catch(()=>({}));
          throw new Error(j?.error?.message||`render HTTP ${r.status}`);
        }
        const type=r.headers.get('content-type')||'';
        if(!type.startsWith('image/')) throw new Error('backend não devolveu imagem');
        const blob=await r.blob();
        const old=rendered.get(i);
        if(old) URL.revokeObjectURL(old);
        const url=URL.createObjectURL(blob);
        rendered.set(i,url);
        scheduleApply(i,true);
        setPageStatus(i,'traduzida · redraw especializado','ok');
      }catch(e){
        console.warn('[Panel Translate] redraw especializado falhou',e);
        setPageStatus(i,`análise pronta · redraw falhou: ${String(e.message||e).slice(0,90)}`,'warn');
      }
    })().finally(()=>jobs.delete(i));
    jobs.set(i,task);
    return task;
  }

  window.fetch=async function(input,init={}){
    const req=parseAnalyzeRequest(input,init);
    if(!req) return nativeFetch(input,init);
    const i=Number(req.pageIndex);
    if(Number.isInteger(i)&&i>=0) renderRemote(i,init);
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
      canvas.dataset.specializedRendered='1';
      if(layer){layer.innerHTML='';layer.style.opacity='0';layer.dataset.specializedRendered='1';}
      page.dataset.specializedRendered='1';
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
  window.__panelSpecializedRendered=rendered;
})();
