// Live Subtitle server — no dependencies, needs Node 18+
const http=require('http'),fs=require('fs'),path=require('path');
const PORT=process.env.PORT||3000, HOST=process.env.HOST||'0.0.0.0', KEY=(process.env.GOOGLE_API_KEY||'').trim(), ADMIN=(process.env.ADMIN_KEY||'').trim();
const SF=path.join(__dirname,'settings.json');
let settings={mode:'both',font:54,bottom:90,thChars:26,enChars:46,hold:3};
try{Object.assign(settings,JSON.parse(fs.readFileSync(SF)))}catch{}
const clients=new Set(),cache=new Map();
// if ADMIN_KEY is set, the control page and POST endpoints need ?key=...
const ok=req=>!ADMIN||new URL(req.url,'http://x').searchParams.get('key')?.trim()===ADMIN;
setInterval(()=>clients.forEach(c=>c.write(': ping\n\n')),20000); // keep SSE alive behind proxies
const send=o=>{const s=`data: ${JSON.stringify(o)}\n\n`;clients.forEach(c=>c.write(s))};

async function translate(text,lang){
  const th=lang.startsWith('th'),sl=th?'th':'en',tl=th?'en':'th',k=sl+text;
  if(cache.has(k))return cache.get(k);
  let out;
  if(KEY){ // official Google Cloud Translation
    const r=await fetch('https://translation.googleapis.com/language/translate/v2?key='+KEY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:text,source:sl,target:tl,format:'text'})});
    out=(await r.json()).data.translations[0].translatedText;
  }else{ // free unofficial endpoint: fine for testing, may be rate-limited
    const r=await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`);
    out=(await r.json())[0].map(x=>x[0]).join('');
  }
  if(cache.size>500)cache.clear();
  cache.set(k,out);return out;
}
// one translation at a time; only the newest pending text is kept
let busy=false,pending=null;
async function pump(){
  if(busy||!pending)return;
  busy=true;const p=pending;pending=null;
  try{send({type:'trans',seq:p.seq,text:await translate(p.text,p.lang)})}catch(e){console.log('translate error:',e.message)}
  busy=false;pump();
}
const body=req=>new Promise(r=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{try{r(JSON.parse(b))}catch{r({})}})});

http.createServer(async(req,res)=>{
  const u=req.url.split('?')[0];
  if(u==='/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
    res.write(`data: ${JSON.stringify({type:'settings',...settings})}\n\n`);
    clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(req.method==='POST'&&u==='/caption'){
    if(!ok(req))return res.writeHead(401).end('key required');
    const b=await body(req);
    send({type:'orig',seq:b.seq,text:b.text,final:!!b.final,lang:b.lang});
    if(settings.mode!=='orig'&&b.text){pending={text:b.text,seq:b.seq,lang:b.lang||'th-TH'};pump()}
    return res.end('ok');
  }
  if(req.method==='POST'&&u==='/settings'){
    if(!ok(req))return res.writeHead(401).end('key required');
    Object.assign(settings,await body(req));
    try{fs.writeFileSync(SF,JSON.stringify(settings))}catch{}
    send({type:'settings',...settings});return res.end('ok');
  }
  const f=u==='/'?'control.html':u==='/overlay'?'overlay.html':null;
  if(!f)return res.writeHead(404).end();
  if(f==='control.html'&&!ok(req))return res.writeHead(401,{'Content-Type':'text/plain; charset=utf-8'}).end('รหัสไม่ตรง: เปิดด้วย /?key=รหัสที่ตั้งใน ADMIN_KEY');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(fs.readFileSync(path.join(__dirname,f)));
}).listen(PORT,HOST,()=>console.log(`Control:  http://localhost:${PORT}/\nOverlay:  http://localhost:${PORT}/overlay  (ใส่ใน OBS Browser Source)`));
