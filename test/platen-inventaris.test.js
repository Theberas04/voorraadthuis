// Tests voor de waarde en de inventaris van de platenverzameling: wat is de
// verzameling waard, wat heeft nog geen prijs, en hoe zet je alles op papier voor
// de verzekering (printbare pagina en CSV).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platen-waarde-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.MEDIA_DIR=path.join(dir,'fotos');
process.env.WEER_AUTO='0';
// Geen internet in de test: hoezen en de barcodetabel blijven buiten beeld.
process.env.PLATEN_HOES_AUTO='0';
process.env.PLATEN_DISCOGS_DB='0';
process.env.PLATEN_TABEL='0';
const {server,db}=require('../server');
let base;
test.before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});

const call=(pad,method='GET',body)=>fetch(base+pad,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
async function zetPlaat(gegevens){
  const r=await call('/api/platen','POST',gegevens);
  const tekst=await r.text();
  assert.equal(r.status,201,tekst);
  return JSON.parse(tekst).plaat;
}

test('de verzameling heeft een totaalwaarde, en de verlanglijst telt niet mee',async()=>{
  const a=await zetPlaat({titel:'The Dark Side of the Moon',artiest:'Pink Floyd',jaar:'1973',prijs:'12,50',aantal:2,locatie:'Kast woonkamer'});
  const b=await zetPlaat({titel:'Rumours',artiest:'Fleetwood Mac',jaar:'1977',prijs:30,locatie:'Kast woonkamer'});
  await zetPlaat({titel:'Onbekende persing',artiest:'Iemand',jaar:'1985',locatie:'Zolder'});
  await zetPlaat({titel:'Toekomstige aankoop',artiest:'Niemand',prijs:100,gewenst:true});
  const waarde=await(await call('/api/platen/waarde')).json();
  assert.equal(waarde.stuks,4,'twee exemplaren van de eerste plaat tellen als vier stuks met Rumours erbij');
  assert.equal(waarde.metPrijs,2);
  assert.equal(waarde.zonderPrijs,1);
  assert.equal(waarde.totaal,55,'12,50 × 2 + 30');
  assert.equal(waarde.duurste[0].titel,'Rumours');
  const locatie=waarde.perLocatie.find(l=>l.locatie==='Kast woonkamer');
  assert.equal(locatie.totaal,55);
  assert.equal(waarde.perLocatie.find(l=>l.locatie==='Zolder').totaal,0);
  assert.equal(a.prijs,12.5,'een prijs met een komma wordt een getal');
  assert.equal(b.prijs,30);
});

test('de inventaris komt als printbare pagina met alle gegevens en het totaal',async()=>{
  const r=await call('/api/platen/inventaris');
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type'),/text\/html/);
  const html=await r.text();
  for(const stuk of ['Inventaris van mijn platenverzameling','The Dark Side of the Moon','Pink Floyd','Fleetwood Mac','Kast woonkamer','Onbekende persing','Afdrukken of bewaar als PDF','€ 55,00']){
    assert.ok(html.includes(stuk),`de inventaris hoort ${stuk} te bevatten`);
  }
  // De verlanglijst hoort niet in een verzekeringslijst te staan.
  assert.equal(html.includes('Toekomstige aankoop'),false);
  assert.ok(html.includes('4 stuks'),'het aantal exemplaren hoort erbij te staan');
  assert.ok(html.includes('geen prijs opgegeven'),'wat nog geen prijs heeft wordt eerlijk gemeld');
});

test('de inventaris is ook als CSV te bewaren, met een puntkomma als scheiding',async()=>{
  const r=await call('/api/platen/inventaris.csv');
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type'),/text\/csv/);
  assert.match(r.headers.get('content-disposition')||'',/attachment; filename="platen-inventaris-\d{4}-\d{2}-\d{2}\.csv"/);
  const csv=await r.text();
  const regels=csv.trim().split('\n');
  assert.match(regels[0],/^titel;artiest;jaar;label;formaat;locatie;aantal;prijs;totaal;notitie$/);
  assert.equal(regels.length,5,'kopregel plus vier regels (drie platen en het totaal)');
  assert.ok(regels.some(r=>r.startsWith('The Dark Side of the Moon;Pink Floyd')),'de eerste plaat staat erin');
  assert.ok(csv.includes('12,50'),'bedragen staan met een komma, zoals in Nederland gebruikelijk');
  assert.match(regels.at(-1),/^Totaal;;;;;;4;;55,00;$/);
});

test('de platenpagina toont de waarde en de knoppen voor de inventaris',async()=>{
  const html=await(await call('/')).text();
  for(const stuk of ['id="platenWaarde"','id="platenInventaris"','id="platenCsv"','/api/platen/inventaris','/api/platen/inventaris.csv']){
    assert.ok(html.includes(stuk),`de platenpagina hoort ${stuk} te bevatten`);
  }
  const bundel=await(await call('/platen.js')).text();
  assert.ok(bundel.includes("api('/api/platen/waarde')"),'de pagina hoort de waarde bij de server op te halen');
  assert.ok(bundel.includes('function toonWaarde'),'de waarde hoort ook echt in de kop te komen');
});

test('de platenfunctie staat standaard verborgen en is met PLATEN_ZICHTBAAR=1 weer zichtbaar',async()=>{
  const uit=await(await call('/api/instellingen/weergave')).json();
  assert.equal(uit.platen,false,'de platenfunctie hoort standaard verborgen te zijn');
  const html=await(await call('/')).text();
  assert.ok(html.includes('id="navPlaten"'),'de platenknop hoort een eigen id te hebben');
  assert.match(html,/<button[^>]*data-page="platen"[^>]*hidden/,'de platenknop hoort verborgen te staan');
  assert.ok(html.includes("api('/api/instellingen/weergave')"),'de pagina hoort de instelling bij de server op te halen');
  assert.ok(html.includes('function toonPlatenNav'),'de pagina hoort de knop pas te tonen als de functie aanstaat');
  const vorige=process.env.PLATEN_ZICHTBAAR;
  process.env.PLATEN_ZICHTBAAR='1';
  try{
    const aan=await(await call('/api/instellingen/weergave')).json();
    assert.equal(aan.platen,true,'met PLATEN_ZICHTBAAR=1 is de platenfunctie zichtbaar');
  }finally{
    if(vorige===undefined)delete process.env.PLATEN_ZICHTBAAR;else process.env.PLATEN_ZICHTBAAR=vorige;
  }
});
