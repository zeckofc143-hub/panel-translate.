(()=>{
  const timers=new WeakMap();
  const signatures=new WeakMap();
  const urls=new WeakMap();
  const $=s=>document.querySelector(s);
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const median=a=>{if(!a.length)return 255;const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]};

  function pct(v){const n=parseFloat(String(v||'0'));return Number.isFinite(n)?n:0}
  function roleFont(el){
    if(el.classList.contains('role-sfx')||el.classList.contains('role-shout'))return 'Bangers, Impact, Arial Black, sans-serif';
    if(el.classList.contains('role-handwritten')||el.classList.contains('role-whisper'))return 'Caveat, Comic Neue, cursive';
    if(el.classList.contains('role-narration'))return 'Noto Serif, Georgia, serif';
    return 'Comic Neue, Noto Sans, Arial, sans-serif';
  }
  function rotation(el){const m=String(el.style.transform||'').match(/rotate\((-?[\d.]+)deg\)/);return m?+m[1]:0}
  function rgb(css,fallback='#111111'){
    const c=String(css||fallback).trim();
    const m=c.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/i);if(m)return[+m[1],+m[2],+m[3]];
    const h=c.match(/^#([0-9a-f]{6})$/i);if(h){const n=parseInt(h[1],16);return[(n>>16)&255,(n>>8)&255,n&255]}
    return rgb(fallback,'#111111');
  }
  function sample(ctx,r){
    const x=clamp(Math.floor(r.x),0,ctx.canvas.width-1),y=clamp(Math.floor(r.y),0,ctx.canvas.height-1);
    const w=Math.max(1,Math.min(ctx.canvas.width-x,Math.ceil(r.w))),h=Math.max(1,Math.min(ctx.canvas.height-y,Math.ceil(r.h)));
    const d=ctx.getImageData(x,y,w,h),rs=[],gs=[],bs=[];
    const band=Math.max(2,Math.round(Math.min(w,h)*.12));
    for(let yy=0;yy<h;yy+=2)for(let xx=0;xx<w;xx+=2){
      if(xx>band&&xx<w-band&&yy>band&&yy<h-band)continue;
      const k=(yy*w+xx)*4;rs.push(d.data[k]);gs.push(d.data[k+1]);bs.push(d.data[k+2]);
    }
    return[median(rs),median(gs),median(bs)];
  }
  function rounded(ctx,x,y,w,h,r){
    const rr=Math.min(r,w/2,h/2);ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(x,y,w,h,rr);else ctx.rect(x,y,w,h);
  }
  function patchBackground(ctx,el,box){
    const isSfx=el.classList.contains('role-sfx')||el.classList.contains('role-shout');
    if(isSfx&&$('#preserveSfx')?.checked)return;
    const pad=isSfx?.045:.075;
    const px=box.w*pad,py=box.h*pad;
    const r={x:clamp(box.x-px,0,ctx.canvas.width-1),y:clamp(box.y-py,0,ctx.canvas.height-1),w:Math.min(ctx.canvas.width-box.x+px,box.w+px*2),h:Math.min(ctx.canvas.height-box.y+py,box.h+py*2)};
    if(r.w<2||r.h<2)return;
    const bg=sample(ctx,r);
    ctx.save();ctx.fillStyle=`rgb(${bg[0]},${bg[1]},${bg[2]})`;ctx.globalAlpha=.992;
    rounded(ctx,r.x,r.y,r.w,r.h,Math.max(2,Math.min(r.w,r.h)*(isSfx?.05:.14)));ctx.fill();ctx.restore();
  }
  function breakLong(ctx,word,maxWidth){
    const out=[];let cur='';
    for(const ch of word){const n=cur+ch;if(cur&&ctx.measureText(n).width>maxWidth){out.push(cur);cur=ch}else cur=n}
    if(cur)out.push(cur);return out;
  }
  function wrap(ctx,text,maxWidth){
    const lines=[];
    for(const paragraph of String(text||'').split(/\n/)){
      const words=paragraph.trim().split(/\s+/).filter(Boolean);
      if(!words.length){lines.push('');continue}
      let line='';
      for(const word of words){
        if(ctx.measureText(word).width>maxWidth){
          if(line){lines.push(line);line=''}
          const chunks=breakLong(ctx,word,maxWidth);lines.push(...chunks.slice(0,-1));line=chunks.at(-1)||'';continue;
        }
        const test=line?`${line} ${word}`:word;
        if(line&&ctx.measureText(test).width>maxWidth){lines.push(line);line=word}else line=test;
      }
      if(line)lines.push(line);
    }
    return lines.length?lines:[''];
  }
  function textMetrics(ctx,el,box,size){
    const st=getComputedStyle(el),weight=st.fontWeight||'700',italic=st.fontStyle==='italic'?'italic ':'';
    ctx.font=`${italic}${weight} ${size}px ${roleFont(el)}`;
    const pad=Math.max(2,size*.12),maxW=Math.max(4,box.w-pad*2),lhRatio=(()=>{const l=parseFloat(st.lineHeight),f=parseFloat(st.fontSize);return Number.isFinite(l)&&Number.isFinite(f)&&f>0?clamp(l/f,.78,1.6):1.06})();
    const lines=wrap(ctx,el.textContent||'',maxW);
    const h=lines.length*size*lhRatio;
    const w=Math.max(...lines.map(x=>ctx.measureText(x).width),0);
    return{lines,h,w,lh:size*lhRatio,pad};
  }
  function drawHorizontal(ctx,el,box){
    const st=getComputedStyle(el),base=Math.max(8,parseFloat(st.fontSize)||18);
    const scale=box.displayScale||1;let lo=6*scale,hi=Math.max(lo,base*scale*1.12),best=lo,bm=null;
    for(let n=0;n<10;n++){
      const mid=(lo+hi)/2,m=textMetrics(ctx,el,box,mid);
      if(m.h<=box.h*.94&&m.w<=box.w*.96){best=mid;bm=m;lo=mid+.2}else hi=mid-.2;
    }
    const m=bm||textMetrics(ctx,el,box,best),align=st.textAlign||'center';
    const [fr,fg,fb]=rgb(st.color,'#111111');const stroke=rgb(st.webkitTextStrokeColor||st.textShadow,'#ffffff');
    const sw=Math.max(0,(parseFloat(st.webkitTextStrokeWidth)||0)*scale);
    ctx.font=`${st.fontStyle==='italic'?'italic ':''}${st.fontWeight||'700'} ${best}px ${roleFont(el)}`;
    ctx.fillStyle=`rgb(${fr},${fg},${fb})`;ctx.strokeStyle=`rgb(${stroke[0]},${stroke[1]},${stroke[2]})`;ctx.lineWidth=Math.max(1,sw*2);
    ctx.textBaseline='middle';ctx.textAlign=align==='left'?'left':align==='right'?'right':'center';
    const x=align==='left'?box.x+m.pad:align==='right'?box.x+box.w-m.pad:box.x+box.w/2;
    const start=box.y+box.h/2-((m.lines.length-1)*m.lh)/2;
    m.lines.forEach((line,i)=>{const y=start+i*m.lh;if(sw>0)ctx.strokeText(line,x,y);ctx.fillText(line,x,y)});
  }
  function drawVertical(ctx,el,box){
    const st=getComputedStyle(el),chars=[...(el.textContent||'')];if(!chars.length)return;
    let size=Math.min(box.w*.58,box.h/Math.max(1,chars.length)*.92);size=Math.max(6,size);
    const [fr,fg,fb]=rgb(st.color,'#111111');const stroke=rgb(st.webkitTextStrokeColor,'#ffffff');const sw=Math.max(0,parseFloat(st.webkitTextStrokeWidth)||0)*(box.displayScale||1);
    ctx.font=`${st.fontWeight||'700'} ${size}px ${roleFont(el)}`;ctx.fillStyle=`rgb(${fr},${fg},${fb})`;ctx.strokeStyle=`rgb(${stroke[0]},${stroke[1]},${stroke[2]})`;ctx.lineWidth=Math.max(1,sw*2);ctx.textAlign='center';ctx.textBaseline='middle';
    const x=box.x+box.w/2,step=size*1.04,start=box.y+box.h/2-((chars.length-1)*step)/2;
    chars.forEach((ch,i)=>{const y=start+i*step;if(sw>0)ctx.strokeText(ch,x,y);ctx.fillText(ch,x,y)});
  }
  function drawText(ctx,el,box){
    ctx.save();const a=rotation(el)*Math.PI/180,cx=box.x+box.w/2,cy=box.y+box.h/2;ctx.translate(cx,cy);ctx.rotate(a);ctx.translate(-cx,-cy);
    const vertical=getComputedStyle(el).writingMode.startsWith('vertical');
    if(vertical)drawVertical(ctx,el,box);else drawHorizontal(ctx,el,box);ctx.restore();
  }
  function getBox(el,W,H,viewer){
    const left=pct(el.style.left),top=pct(el.style.top),width=pct(el.style.width),height=pct(el.style.height);
    const displayScale=W/Math.max(1,viewer.getBoundingClientRect().width);
    return{x:left/100*W,y:top/100*H,w:Math.max(2,width/100*W),h:Math.max(2,height/100*H),displayScale};
  }
  function signature(page,original,layer){
    const blocks=[...layer.querySelectorAll('.txt')].map(el=>[el.textContent,el.style.left,el.style.top,el.style.width,el.style.height,el.style.transform,getComputedStyle(el).fontSize,getComputedStyle(el).fontWeight,getComputedStyle(el).color].join('|')).join('||');
    return`${original.naturalWidth}x${original.naturalHeight}|${$('#preserveSfx')?.checked}|${blocks}`;
  }
  function syncView(page){
    const final=page.querySelector('img.translated-final'),original=page.querySelector('img.original'),cv=page.querySelector('canvas.clean'),layer=page.querySelector('.layer');if(!original)return;
    if(cv){cv.style.opacity='0';cv.style.visibility='hidden'}if(layer){layer.style.opacity='0';layer.style.visibility='hidden'}
    const mode=$('#view')?.value||'translated';
    if(!final){original.style.opacity='1';return}
    final.style.opacity=mode==='original'?'0':mode==='compare'?'.62':'1';
    original.style.opacity=mode==='translated'?'0':'1';
  }
  async function render(page){
    const original=page.querySelector('img.original'),layer=page.querySelector('.layer'),viewer=page.querySelector('.viewer');
    if(!original||!layer||!viewer||!original.complete||!original.naturalWidth)return;
    const els=[...layer.querySelectorAll('.txt')];if(!els.length){syncView(page);return}
    const sig=signature(page,original,layer);if(signatures.get(page)===sig){syncView(page);return}signatures.set(page,sig);
    const W=original.naturalWidth,H=original.naturalHeight,out=document.createElement('canvas');out.width=W;out.height=H;
    const ctx=out.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(original,0,0,W,H);
    for(const el of els){const box=getBox(el,W,H,viewer);patchBackground(ctx,el,box)}
    for(const el of els){const box=getBox(el,W,H,viewer);drawText(ctx,el,box)}
    const blob=await new Promise(r=>out.toBlob(r,'image/webp',.96));if(!blob)return;
    const old=urls.get(page);if(old)URL.revokeObjectURL(old);const url=URL.createObjectURL(blob);urls.set(page,url);
    let img=page.querySelector('img.translated-final');if(!img){img=document.createElement('img');img.className='translated-final';img.alt='Página traduzida';viewer.appendChild(img)}
    img.width=W;img.height=H;img.dataset.originalWidth=String(W);img.dataset.originalHeight=String(H);img.src=url;
    page.classList.add('final-ready');syncView(page);
  }
  function schedule(page,delay=130){const old=timers.get(page);if(old)clearTimeout(old);timers.set(page,setTimeout(()=>render(page),delay))}
  const obs=new MutationObserver(ms=>{for(const m of ms){const n=m.target?.nodeType===1?m.target:m.target?.parentElement;const p=n?.closest?.('.page');if(p)schedule(p);for(const a of m.addedNodes||[]){if(a.nodeType!==1)continue;const p=a.matches?.('.page')?a:a.closest?.('.page');if(p)schedule(p);a.querySelectorAll?.('.page').forEach(x=>schedule(x))}}});
  function start(){const host=$('#pages');if(!host)return setTimeout(start,50);obs.observe(host,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class']});host.addEventListener('input',e=>{const p=e.target.closest?.('.page');if(p)schedule(p,180)},true);$('#view')?.addEventListener('change',()=>document.querySelectorAll('.page').forEach(syncView));$('#preserveSfx')?.addEventListener('change',()=>document.querySelectorAll('.page').forEach(p=>{signatures.delete(p);schedule(p,30)}));setInterval(()=>document.querySelectorAll('.page').forEach(p=>{if(p.querySelector('.txt'))schedule(p,0)}),1500)}
  addEventListener('beforeunload',()=>{document.querySelectorAll('.page').forEach(p=>{const u=urls.get(p);if(u)URL.revokeObjectURL(u)})});start();
})();