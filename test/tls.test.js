// De app luistert ook op https zodra er een certificaat staat. Dat is nodig voor de
// camera op een telefoon: browsers geven camera en service worker alleen vrij op een
// beveiligde verbinding. Hier starten we de app echt als proces en praten we met beide
// poorten, inclusief het certificaat dat de app zelf aanbiedt.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const https=require('node:https');
const {spawn,execFileSync}=require('node:child_process');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voorraadthuis-tls-'));
const cert=path.join(dir,'cert.pem'),key=path.join(dir,'key.pem');
const PROCESSEN=[];

test.before(()=>{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2',
    '-keyout',key,'-out',cert,'-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],
    {stdio:'ignore'});
});

test.after(()=>{
  for(const kind of PROCESSEN)kind.kill('SIGKILL');
  fs.rmSync(dir,{recursive:true,force:true});
});

const vrijePoort=()=>new Promise(resolve=>{
  const s=net.createServer();
  s.listen(0,'127.0.0.1',()=>{const poort=s.address().port;s.close(()=>resolve(poort))});
});

async function startApp({tls=true}={}){
  const poort=await vrijePoort();
  const tlsPoort=await vrijePoort();
  const env={...process.env,PORT:String(poort),HOST:'127.0.0.1',DB_PATH:path.join(dir,'app.db'),
    MEDIA_DIR:path.join(dir,'fotos'),TLS_PORT:String(tlsPoort),
    ...(tls?{TLS_CERT:cert,TLS_KEY:key}:{TLS_CERT:path.join(dir,'geen.pem'),TLS_KEY:path.join(dir,'geen.pem')})};
  const kind=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env,stdio:['ignore','pipe','pipe']});
  PROCESSEN.push(kind);
  let uit='';
  kind.stdout.on('data',d=>{uit+=d});
  await new Promise((resolve,reject)=>{
    const klaar=setTimeout(()=>reject(new Error(`app startte niet: ${uit}`)),15000);
    kind.stdout.on('data',()=>{ if(uit.includes('luistert op')){clearTimeout(klaar);resolve()} });
    kind.on('exit',code=>{clearTimeout(klaar);reject(new Error(`app stopte met code ${code}: ${uit}`))});
  });
  for(let i=0;i<40;i++){
    try{const r=await fetch(`http://127.0.0.1:${poort}/health`);if(r.ok)break}catch{await new Promise(r=>setTimeout(r,150))}
  }
  return {poort,tlsPoort,uit};
}

const haalTls=(poort,pad)=>new Promise((resolve,reject)=>{
  const verzoek=https.request({host:'127.0.0.1',port:poort,path:pad,rejectUnauthorized:false},res=>{
    let tekst='';
    res.on('data',d=>{tekst+=d});
    res.on('end',()=>resolve({status:res.statusCode,kop:res.headers['x-voorraadthuis'],tekst}));
  });
  verzoek.on('error',reject);
  verzoek.end();
});

test('met een certificaat luistert de app ook op https en is de pagina beveiligd',async()=>{
  const {poort,tlsPoort,uit}=await startApp();
  assert.match(uit,/ook op https/);
  const gezond=await haalTls(tlsPoort,'/healthz');
  assert.equal(gezond.status,200);
  assert.equal(gezond.kop,'app','dezelfde app hoort op https te antwoorden');
  assert.equal(gezond.tekst.trim(),'ok');
  const lijst=await haalTls(tlsPoort,'/api/products');
  assert.equal(lijst.status,200);
  assert.equal(JSON.parse(lijst.tekst).length,0);
  // En het gewone http-adres blijft werken naast https.
  const gewoon=await fetch(`http://127.0.0.1:${poort}/healthz`);
  assert.equal(gewoon.status,200);
});

test('de app biedt het certificaat zelf aan om op een telefoon te installeren',async()=>{
  const {poort}=await startApp();
  const r=await fetch(`http://127.0.0.1:${poort}/certificaat.crt`);
  assert.equal(r.status,200);
  assert.equal(r.headers.get('content-type'),'application/x-x509-ca-cert');
  assert.match(r.headers.get('content-disposition'),/voorraadthuis\.crt/);
  assert.match(await r.text(),/BEGIN CERTIFICATE/);
});

test('zonder certificaat luistert er alleen http',async()=>{
  const {tlsPoort,uit}=await startApp({tls:false});
  assert.doesNotMatch(uit,/ook op https/);
  await assert.rejects(haalTls(tlsPoort,'/healthz'));
});

test('zonder certificaat geeft de certificaatroute een nette melding',async()=>{
  const {poort}=await startApp({tls:false});
  const r=await fetch(`http://127.0.0.1:${poort}/certificaat.crt`);
  assert.equal(r.status,404);
  assert.match((await r.json()).error,/certificaat/i);
});
