import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = ROOT;
const ALLOWED_STATIC = new Set(['index.html','app.js','style.css']);
for (const line of (fs.existsSync(path.join(ROOT,'.env')) ? fs.readFileSync(path.join(ROOT,'.env'),'utf8') : '').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const MAX_CALLS = Math.max(2, Math.min(8, Number(process.env.MAX_AI_CALLS || 6)));
const LIMIT = 250_000;
const history = [];
const active = new Set();
const perIp = new Map();

function json(res, status, body) { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(body)); }
function basicAuth(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  const raw = (req.headers.authorization || '').replace(/^Basic\s+/i, '');
  let candidate = '';
  try { candidate = Buffer.from(raw, 'base64').toString('utf8').split(':').slice(1).join(':'); } catch {}
  const a = Buffer.from(candidate), b = Buffer.from(pw);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
function clean(v, max=300) { return String(v || '').trim().slice(0,max); }
function score(v) { const n=Number(v); return Number.isFinite(n) ? Math.max(0,Math.min(10,n)) : 0; }
function normalizeSong(raw) {
  return {title:clean(raw.title,100), concept:clean(raw.concept,600), lyrics:clean(raw.lyrics,18000), style:clean(raw.style,900), exclude:clean(raw.exclude,350), hook:clean(raw.hook,600)};
}
function normalizeReview(raw) {
  const s=raw.scores||{};
  const scores=Object.fromEntries(['rhymes','flow','naturalness','hook','story','originality'].map(k=>[k,score(s[k])]));
  return {scores, issues:Array.isArray(raw.issues)?raw.issues.slice(0,10).map(x=>clean(x,450)):[], fixes:Array.isArray(raw.fixes)?raw.fixes.slice(0,10).map(x=>clean(x,450)):[], verdict:clean(raw.verdict,900), passed:Object.values(scores).every(v=>v>=9)};
}
async function ai(messages, usage) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST', headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:MODEL,temperature:0.75,response_format:{type:'json_object'},messages,max_completion_tokens:5000}),
    signal:AbortSignal.timeout(110000)
  });
  const data=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(`API ${response.status}: ${clean(data.error?.message || 'Błąd odpowiedzi',300)}`);
  usage.input += Number(data.usage?.prompt_tokens||0); usage.output += Number(data.usage?.completion_tokens||0); usage.calls++;
  const txt=data.choices?.[0]?.message?.content;
  if (!txt) throw new Error('Model nie zwrócił treści.');
  try { return JSON.parse(txt); } catch { throw new Error('Model zwrócił niepoprawny JSON.'); }
}
const artistRules = `Jesteś polskim tekściarzem rapowym i redaktorem muzycznym. Projekt KARASKO. Pisz po polsku, naturalnie, bez sztucznych metafor i moralizowania. Oryginalna historia, konkretne sceny, wiarygodne postaci. Mocne sensowne rymy, w tym wielosylabowe tam gdzie naturalne; nie poświęcaj sensu dla rymu. Równy, możliwy do zarapowania flow; unikaj rozwlekłych wersów. Mocny krótki refren zaczyna się w 0:00, chwytliwy w pierwszych 3–5 sekundach. Pełny utwór: 2–3 rozbudowane zwrotki, co najmniej 2 refreny, bridge i finał. Dobierz długość do gatunku; nie rozwlekaj klubowych hooków. Każdy wers powinien brzmieć naturalnie i mieć wyraźny rytm. Używaj tagów [Chorus], [Verse 1], [Verse 2], [Verse 3], [Bridge], [Final Chorus], [Outro]. Wokal naturalny niski męski; bez disco polo, bez krzyku, bez plastikowego autotune. Bit dynamiczny, ciężki 808, przerwy i mocniejszy finalny drop. Nie powtarzaj znanych motywów o udowadnianiu innym, czasie, pieniądzach i zegarku, chyba że temat tego wymaga. Nie kopiuj cudzych tekstów ani melodii. Style po angielsku: konkretne brzmienie, tempo, wokal, instrumenty, przerwy, różniące się dropy, bez generycznych fraz. Nie stosuj jednego schematu do wszystkich gatunków.`;
const rubric = `Oceń surowo 0–10 OSOBNO: rhymes (rzeczywiste i naturalne rymy), flow (metryka i akcenty, realistyczny rap przy BPM), naturalness (żywy polski język), hook (zapamiętywalność refrenu), story (spójność i rozwój historii), originality (brak klisz). Dodatkowo zweryfikuj, czy styl muzyczny i tempo odpowiadają historii, emocjom, wokalowi i akcentom w tekście; opisz niespójności w issues. Nie przyznawaj 9 za samą długość. Wskaż konkretne wersy i problemy. Każda kategoria >=9 to próg, ale ocena jest szacunkiem redakcyjnym, nie obiektywnym pomiarem.`;
async function build(payload) {
  const usage={input:0,output:0,calls:0};
  const genre=clean(payload.genre,80)||'Polski uliczny hip-hop';
  const topic=clean(payload.topic,450);
  const mood=clean(payload.mood,120)||'mocny, wiarygodny, energetyczny';
  const bpm=Math.max(75,Math.min(160,Number(payload.bpm)||96));
  const auto=payload.autoMatch!==false && payload.autoMatch!=='false';
  let direction=null;
  if(auto){
    direction=await ai([{role:'system',content:`Jesteś producentem muzycznym i redaktorem Karasko. Dobierasz TEMAT, tytuł, gatunek, tempo, nastrój, wokal i aranżację jako spójny pakiet. Wybierz kierunek z największym potencjałem na naturalny polski tekst i wyrazisty refren. Nie kopiuj cudzych utworów. Unikaj disco polo, krzyku, banalnych motywów i słabych rymów. Zwróć wyłącznie JSON: {"genre":"...","bpm":96,"mood":"...","topic":"...","vocal":"...","production":"...","why":"..."}. BPM 80–150. Jeśli użytkownik podał temat, zachowaj go, dobierając odpowiedni styl.`},{role:'user',content:JSON.stringify({topic:topic||null,preferences:'rap uliczny / klubowe electro / energetyczne melodyjne, refren od 0:00, niski męski wokal'})}],usage);
    direction={genre:clean(direction.genre,90),bpm:Math.max(80,Math.min(150,Number(direction.bpm)||96)),mood:clean(direction.mood,120),topic:clean(direction.topic,450),vocal:clean(direction.vocal,180),production:clean(direction.production,500),why:clean(direction.why,500)};
  }
  const instructions=`Gatunek: ${auto?direction.genre:genre}; BPM: ${auto?direction.bpm:bpm}; klimat: ${auto?direction.mood:mood}; temat lub wskazówki: ${auto?direction.topic:(topic||'Wymyśl świeży, konkretny temat i tytuł, inne niż oklepane motywy')}. ${auto?`Dobór producenta: wokal ${direction.vocal}; aranżacja ${direction.production}. Zachowaj ścisłą zgodność słów, tempa, emocji i Style. Nie zmieniaj wybranego kierunku w trakcie redakcji.`:''} Przygotuj kompletny gotowy numer. Zwróć JSON: {"title":"...","concept":"...","hook":"...","lyrics":"...","style":"...","exclude":"..."}. Style i Exclude po angielsku, Lyrics po polsku.`;
  const original=normalizeSong(await ai([{role:'system',content:artistRules},{role:'user',content:instructions}],usage));
  function structuralProblems(s) {
    const issues=[];
    if(!s.title || !s.lyrics || !s.style || !s.exclude) issues.push('Brak tytułu, Lyrics, Style lub Exclude.');
    if(!/^\s*\[(?:Chorus|Hook|Refrain|Refren)[^\]]*\]/i.test(s.lyrics)) issues.push('Tekst nie rozpoczyna się od refrenu/hooka.');
    if((s.lyrics.match(/\[(?:Verse|Zwrotka)\b/gi)||[]).length<2) issues.push('Za mało zwrotek.');
    if(s.lyrics.length<700) issues.push('Tekst zbyt krótki na pełny utwór.');
    if(s.style.length<70) issues.push('Style jest zbyt ogólnikowy.');
    return issues;
  }
  function avg(r) { return Object.values(r.scores).reduce((a,b)=>a+b,0)/6; }
  async function evaluate(song) {
    const review=normalizeReview(await ai([{role:'system',content:`Jesteś niezależnym, surowym redaktorem rapowym. ${rubric} Zwróć tylko JSON: {"scores":{"rhymes":0,"flow":0,"naturalness":0,"hook":0,"story":0,"originality":0},"issues":["..."],"fixes":["..."],"verdict":"..."}.`},{role:'user',content:JSON.stringify({bpm:auto?direction.bpm:bpm,direction,song})}],usage));
    const structural=structuralProblems(song);
    review.issues.unshift(...structural);
    review.passed=review.passed && structural.length===0;
    return review;
  }
  let song=original;
  let review=await evaluate(song);
  let bestSong=song, bestReview=review;
  const revisions=[{iteration:1,scores:review.scores,issues:review.issues,selected:true}];
  while(!bestReview.passed && usage.calls+2<=MAX_CALLS) {
    const candidate=normalizeSong(await ai([{role:'system',content:artistRules+' Popraw wyłącznie wykazane problemy. Zachowaj mocne wersy, refren, temat i historię. Zwróć kompletny JSON, bez komentarza.'},{role:'user',content:JSON.stringify({originalInstructions:instructions,song:bestSong,review:bestReview,outputFormat:{title:'',concept:'',hook:'',lyrics:'',style:'',exclude:''}})}],usage));
    const candidateReview=await evaluate(candidate);
    const currentProblems=structuralProblems(bestSong).length;
    const candidateProblems=structuralProblems(candidate).length;
    const better=candidateProblems<currentProblems || (candidateProblems===currentProblems && avg(candidateReview)>avg(bestReview)+0.15 && Math.min(...Object.values(candidateReview.scores))>=Math.min(...Object.values(bestReview.scores))-1);
    revisions.push({iteration:revisions.length+1,scores:candidateReview.scores,issues:candidateReview.issues,selected:better});
    if(better){bestSong=candidate;bestReview=candidateReview;}
  }
  song=bestSong;
  review=bestReview;
  const rates={input:Number(process.env.INPUT_USD_PER_M||0),output:Number(process.env.OUTPUT_USD_PER_M||0)};
  const estimatedUsd=(usage.input*rates.input+usage.output*rates.output)/1e6;
  return {song,direction,review,revisions,usage,estimatedUsd:rates.input||rates.output?estimatedUsd:null,model:MODEL,createdAt:new Date().toISOString()};
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async (req,res)=>{
  if (!basicAuth(req)) {res.writeHead(401,{'WWW-Authenticate':'Basic realm="Karasko Hit Control"'});res.end('Wymagane hasło');return;}
  const pathname=new URL(req.url,'http://localhost').pathname;
  if (pathname==='/api/status') return json(res,200,{configured:!!process.env.OPENAI_API_KEY,model:MODEL,maxCalls:MAX_CALLS,hasPassword:!!process.env.APP_PASSWORD});
  if (pathname==='/api/history' && req.method==='GET') return json(res,200,{items:history.map(({song,review,createdAt})=>({title:song.title,scores:review.scores,createdAt}))});
  if (pathname==='/api/generate' && req.method==='POST') {
    if (!process.env.OPENAI_API_KEY) return json(res,503,{error:'Brak OPENAI_API_KEY. Ustaw go w .env lub panelu hostingu.'});
    const ip=req.socket.remoteAddress||'unknown';
    const last=perIp.get(ip)||0;
    if (Date.now()-last<15000) return json(res,429,{error:'Odczekaj 15 sekund przed kolejną generacją.'});
    if (active.size>=2) return json(res,429,{error:'Dwie generacje już trwają. Spróbuj później.'});
    perIp.set(ip,Date.now()); active.add(ip);
    try {
      let body=''; for await (const chunk of req) {body+=chunk; if (body.length>LIMIT) throw new Error('Za duże żądanie.');}
      const payload=JSON.parse(body);
      const result=await build(payload);
      history.unshift(result); if(history.length>15) history.pop();
      return json(res,200,result);
    } catch(err) {return json(res,500,{error:clean(err.message,500)});} finally {active.delete(ip);}
  }
  if (req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Metoda niedozwolona'});
  const file=pathname==='/'?'index.html':pathname.replace(/^\//,'');
  if (!ALLOWED_STATIC.has(file)) return json(res,404,{error:'Nie znaleziono'});
  const resolved=path.join(PUBLIC,file);
  try {const data=fs.readFileSync(resolved);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-cache'});res.end(data);} catch {json(res,404,{error:'Nie znaleziono'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`KARASKO HIT CONTROL: http://localhost:${PORT}`));
