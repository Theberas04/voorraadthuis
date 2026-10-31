// Tests voor het agenda-bestand (.ics): de planning van maaltijden en diensten
// als bestand dat je in de agenda van je telefoon of computer zet.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agenda-ics-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.MEDIA_DIR=path.join(dir,'fotos');
process.env.WEER_AUTO='0';
process.env.PLATEN_HOES_AUTO='0';
process.env.PLATEN_DISCOGS_DB='0';
process.env.PLATEN_TABEL='0';
const {maakAgenda, bestandsnaam}=require('../agenda');
const {server,db,RECIPES}=require('../server');
let base;
test.before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});
const call=(pad,method='GET',body)=>fetch(base+pad,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
const vastNu=new Date('2026-10-25T09:30:00Z');

// De regels zonder de vouwtekens, zodat we de inhoud kunnen vergelijken.
const ontvouw=ics=>ics.replace(/\r\n /g,'').split('\r\n');
const vindRegel=(regels,begin)=>regels.find(r=>r.startsWith(begin));
// Het versienummer van één bepaalde dag, ongeacht de andere dagen in het bestand.
const reeksVan=(ics,datum)=>{
  const blok=ontvouw(ics).join('\r\n').split('BEGIN:VEVENT').find(b=>b.includes(`voorraadthuis-${datum}-`));
  return blok?Number((/SEQUENCE:(\d+)/.exec(blok)||[])[1]):0;
};

test('het agenda-bestand is een geldige agenda met tijdzone en de juiste kop',()=>{
  const ics=maakAgenda([],{nu:vastNu});
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'),'een agenda begint met BEGIN:VCALENDAR');
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'),'en eindigt met END:VCALENDAR');
  assert.ok(ics.includes('\r\nVERSION:2.0\r\n'));
  assert.ok(ics.includes('PRODID:-//VoorraadThuis//Agenda//NL'));
  assert.ok(ics.includes('X-WR-CALNAME:VoorraadThuis'));
  assert.ok(ics.includes('BEGIN:VTIMEZONE\r\nTZID:Europe/Amsterdam\r\n'),'zonder tijdzone zouden diensten in de war raken');
  assert.ok(!/[^\r]\n/.test(ics),'elke regel eindigt op CRLF, zoals het formaat voorschrijft');
});

test('een gepland recept komt er als hele-dag-item in te staan',()=>{
  const ics=maakAgenda([{plan_date:'2026-10-27',recipe_id:42,cuisine:'Nederland',porties:4,shifts:[]}],{receptNaam:id=>id===42?'Erwtensoep':'',nu:vastNu});
  const regels=ontvouw(ics);
  assert.ok(ics.includes('SUMMARY:Avondeten: Erwtensoep'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261027'),'een hele-dag-item begint op de dag zelf');
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261028'),'en eindigt de dag erna');
  assert.ok(ics.includes('DESCRIPTION:Landkeuken: Nederland · Porties: 4'));
  assert.equal(regels.filter(r=>r.startsWith('BEGIN:VEVENT')).length,1);
});

test('een dagen zonder recept maar met landkeuken levert toch een item op',()=>{
  const ics=maakAgenda([{plan_date:'2026-10-28',recipe_id:null,cuisine:'Italië',shifts:[]}],{nu:vastNu});
  assert.ok(ics.includes('SUMMARY:Maaltijd: Italië'));
});

test('een dienst wordt een afspraak met tijd in de Nederlandse tijdzone',()=>{
  const ics=maakAgenda([{plan_date:'2026-10-27',shifts:[{name:'Avonddienst',startTime:'15:00',endTime:'23:30',notes:'Sleutel ophalen',color:'blauw'}]}],{nu:vastNu});
  assert.ok(ics.includes('SUMMARY:Dienst: Avonddienst'));
  assert.ok(ics.includes('DTSTART;TZID=Europe/Amsterdam:20261027T150000'));
  assert.ok(ics.includes('DTEND;TZID=Europe/Amsterdam:20261027T233000'));
  assert.ok(ics.includes('DESCRIPTION:Sleutel ophalen'));
  assert.ok(ics.includes('COLOR:#2f6fb5'),'de kleur van de dienst gaat mee voor agenda-apps die dat ondersteunen');
});

test('een nachtdienst die over middernacht loopt eindigt de volgende dag',()=>{
  const ics=maakAgenda([{plan_date:'2026-10-27',shifts:[{name:'Nachtdienst',startTime:'22:30',endTime:'06:15'}]}],{nu:vastNu});
  assert.ok(ics.includes('DTSTART;TZID=Europe/Amsterdam:20261027T223000'));
  assert.ok(ics.includes('DTEND;TZID=Europe/Amsterdam:20261028T061500'),'06:15 hoort bij de volgende dag, niet bij dezelfde dag');
});

test('dezelfde planning levert dezelfde kenmerken op, zodat importeren niet dubbel gaat',()=>{
  const plan=[{plan_date:'2026-10-27',recipe_id:7,cuisine:'',shifts:[{name:'Dagdienst',startTime:'07:00',endTime:'15:00'}]}];
  const uid=ics=>ontvouw(ics).filter(r=>r.startsWith('UID:'));
  const een=uid(maakAgenda(plan,{receptNaam:()=>'Soep',nu:vastNu}));
  const twee=uid(maakAgenda(plan,{receptNaam:()=>'Soep',nu:new Date('2026-11-01T00:00:00Z')}));
  assert.deepEqual(een,twee,'de kenmerken mogen niet van het moment van opvragen afhangen');
  assert.equal(new Set(een).size,een.length,'elk item heeft een eigen kenmerk');
  assert.ok(een[0].includes('2026-10-27'),'het kenmerk noemt de datum, zodat opnieuw importeren hetzelfde item bijwerkt');
});

test('lange regels worden gevouwen op 75 tekens en komen weer heel terug',()=>{
  const lang='Werkoverdracht met een hele lange omschrijving, inclusief komma\'s; en nog wat tekst om de regel echt te laten overlopen over de grens van vijfenzeventig tekens heen';
  const ics=maakAgenda([{plan_date:'2026-10-27',shifts:[{name:'Dienst met een behoorlijk lange naam erin',startTime:'09:00',endTime:'17:00',notes:lang}]}],{nu:vastNu});
  for(const regel of ics.split('\r\n')) assert.ok(Buffer.byteLength(regel,'utf8')<=75,`regel te lang: ${regel}`);
  assert.ok(ontvouw(ics).includes(`DESCRIPTION:${lang.replace(/;/g,'\\;').replace(/,/g,'\\,')}`),'na het ontvouwen staat de tekst er weer precies zo');
});

test('komma\'s, puntkomma\'s en aanhalingstekens in tekst worden gevlucht',()=>{
  const ics=maakAgenda([{plan_date:'2026-10-27',shifts:[{name:'Dienst; avond, laat',startTime:'09:00',endTime:'17:00'}]}],{nu:vastNu});
  const regels=ontvouw(ics);
  assert.ok(regels.includes('SUMMARY:Dienst: Dienst\\; avond\\, laat'),'een puntkomma en komma horen gevlucht te worden');
});

test('het adres levert een agenda-bestand met de juiste koppen',async()=>{
  const recept=RECIPES.find(r=>r.cuisine==='Nederland')||RECIPES[0];
  await call('/api/planner/2026-10-27','PUT',{recipeId:recept.id,cuisine:recept.cuisine,porties:2,shifts:[{name:'Avonddienst',startTime:'15:00',endTime:'23:00',notes:'',color:'groen'}]});
  const antwoord=await call('/api/agenda.ics');
  assert.equal(antwoord.status,200);
  assert.match(antwoord.headers.get('content-type'),/^text\/calendar; charset=utf-8$/);
  assert.match(antwoord.headers.get('content-disposition'),/attachment; filename="voorraadthuis-agenda\.ics"/);
  const ics=await antwoord.text();
  assert.ok(ics.includes(`SUMMARY:Avondeten: ${recept.name}`),'het geplande recept hoort erin te staan');
  assert.ok(ics.includes('SUMMARY:Dienst: Avonddienst'));
  assert.ok(ics.includes('DTSTART;TZID=Europe/Amsterdam:20261027T150000'));
  assert.ok(ics.includes('COLOR:#2f7d4f'));
});

test('met een maand erbij krijg je alleen die maand, en een onzin-maand wordt geweigerd',async()=>{
  await call('/api/planner/2026-12-24','PUT',{cuisine:'Nederland',shifts:[]});
  const oktober=await (await call('/api/agenda.ics?maand=2026-10')).text();
  assert.ok(oktober.includes('20261027'),'de dag in oktober staat erin');
  assert.ok(!oktober.includes('20261224'),'de dag in december niet');
  assert.ok(oktober.includes('X-WR-CALNAME:VoorraadThuis 2026-10'));
  const december=await call('/api/agenda.ics?maand=2026-12');
  assert.match(december.headers.get('content-disposition'),/voorraadthuis-agenda-2026-12\.ics/);
  assert.ok((await december.text()).includes('20261224'));
  assert.equal((await call('/api/agenda.ics?maand=2026-13')).status,400);
  assert.equal((await call('/api/agenda.ics?maand=onzin')).status,400);
});

test('op de kalenderpagina staan de twee agenda-knoppen en volgt de maandknop de maand',async()=>{
  const html=await (await call('/')).text();
  assert.match(html,/<a class="btn" id="agendaIcsMaand" href="\/api\/agenda\.ics" download>/);
  assert.match(html,/<a class="btn ghost" id="agendaIcsAlles" href="\/api\/agenda\.ics" download>/);
  assert.ok(html.includes("icsKnop.href='/api/agenda.ics?maand='+month"),'de knop voor deze maand hoort de zichtbare maand te volgen');
  assert.ok(html.includes('agendaIcsHint'),'de uitleg hoort erbij te staan');
});

test('de bestandsnaam noemt de maand als die er is',()=>{
  assert.equal(bestandsnaam('2026-10'),'voorraadthuis-agenda-2026-10.ics');
  assert.equal(bestandsnaam(''),'voorraadthuis-agenda.ics');
  assert.equal(bestandsnaam('onzin'),'voorraadthuis-agenda.ics');
});

test('het bestand zegt zelf hoe vaak het ververst mag worden',()=>{
  const ics=maakAgenda([],{nu:vastNu});
  assert.ok(ics.includes('REFRESH-INTERVAL;VALUE=DURATION:PT1H'),'zonder deze regel verversen agenda-apps een abonnement pas na dagen');
  assert.ok(ics.includes('X-PUBLISHED-TTL:PT1H'));
});

test('een wijziging krijgt een hoger versienummer en een tijdstip van wijziging',()=>{
  const een=maakAgenda([{plan_date:'2026-10-27',shifts:[{name:'Avonddienst',startTime:'15:00',endTime:'23:00'}]}],{nu:vastNu});
  assert.ok(een.includes('SEQUENCE:1'),'een nieuwe dag begint bij 1');
  assert.ok(!een.includes('LAST-MODIFIED'),'zonder tijdstip van wijziging laten we het weg');
  const twee=maakAgenda([{plan_date:'2026-10-27',rev:2,gewijzigd:'2026-10-26 08:15:00',shifts:[{name:'Avonddienst',startTime:'16:00',endTime:'23:30'}]}],{nu:vastNu});
  assert.ok(twee.includes('SEQUENCE:2'),'een gewijzigde dag komt hoger uit, zodat de agenda hem bijwerkt');
  assert.ok(twee.includes('LAST-MODIFIED:20261026T081500Z'),'het tijdstip van wijziging gaat mee in UTC');
  assert.ok(twee.includes('DTSTART;TZID=Europe/Amsterdam:20261027T160000'));
});

test('een wijziging in de app komt door in het agenda-bestand',async()=>{
  await call('/api/planner/2026-11-03','PUT',{cuisine:'Griekenland',shifts:[{name:'Dagdienst',startTime:'07:00',endTime:'15:00',notes:'',color:'groen'}]});
  const een=await (await call('/api/agenda.ics?maand=2026-11')).text();
  assert.ok(een.includes('DTSTART;TZID=Europe/Amsterdam:20261103T070000'));
  assert.ok(een.includes('SEQUENCE:1'));
  const etiketEen=(await call('/api/agenda.ics?maand=2026-11')).headers.get('etag');
  // De dienst verzetten: de app moet het bestand meteen anders opbouwen.
  await call('/api/planner/2026-11-03','PUT',{cuisine:'Griekenland',shifts:[{name:'Late dienst',startTime:'12:30',endTime:'21:00',notes:'',color:'rood'}]});
  const twee=await (await call('/api/agenda.ics?maand=2026-11')).text();
  assert.ok(twee.includes('SUMMARY:Dienst: Late dienst'));
  assert.ok(!twee.includes('SUMMARY:Dienst: Dagdienst'),'de oude dienst hoort er niet meer in te staan');
  assert.ok(twee.includes('DTSTART;TZID=Europe/Amsterdam:20261103T123000'));
  assert.ok(!twee.includes('20261103T070000'));
  assert.ok(twee.match(/SEQUENCE:[2-9]/),'de tweede versie heeft een hoger versienummer');
  assert.ok(twee.includes('LAST-MODIFIED:'),'en een tijdstip van wijziging');
  assert.notEqual((await call('/api/agenda.ics?maand=2026-11')).headers.get('etag'),etiketEen);
});

test('een gewiste dag verdwijnt uit het bestand en opnieuw plannen telt door',async()=>{
  await call('/api/planner/2026-11-05','PUT',{cuisine:'Japan',shifts:[{name:'Dienst',startTime:'09:00',endTime:'17:00'}]});
  const voor=await (await call('/api/agenda.ics?maand=2026-11')).text();
  assert.ok(voor.includes('20261105'));
  await call('/api/planner/2026-11-05','DELETE');
  const na=await (await call('/api/agenda.ics?maand=2026-11')).text();
  assert.ok(!na.includes('20261105'),'een gewiste dag hoort niet meer in het agenda-bestand te staan');
  await call('/api/planner/2026-11-05','PUT',{cuisine:'Japan',shifts:[{name:'Dienst',startTime:'10:00',endTime:'18:00'}]});
  const weer=await (await call('/api/agenda.ics?maand=2026-11')).text();
  assert.ok(reeksVan(weer,'2026-11-05')>=3,`opnieuw plannen na wissen komt hoger uit (kreeg ${reeksVan(weer,'2026-11-05')})`);
});

test('een agenda-app die niets nieuws ziet krijgt een kort antwoord in plaats van het hele bestand',async()=>{
  const eerste=await call('/api/agenda.ics');
  assert.equal(eerste.status,200);
  const etiket=eerste.headers.get('etag');
  assert.ok(etiket,'het antwoord hoort een etiket te hebben om op te kunnen verversen');
  assert.ok(Number(eerste.headers.get('content-length'))>0,'de lengte wordt meegegeven');
  const tweede=await fetch(base+'/api/agenda.ics',{headers:{'if-none-match':etiket}});
  assert.equal(tweede.status,304,'ongewijzigd betekent 304 en niets om te verwerken');
  assert.equal(await tweede.text(),'');
  // Na een wijziging is het etiket anders en komt er weer een volledig bestand.
  await call('/api/planner/2026-12-01','PUT',{cuisine:'Turkije',shifts:[]});
  const derde=await call('/api/agenda.ics');
  assert.equal(derde.status,200);
  assert.notEqual(derde.headers.get('etag'),etiket);
});

test('de pagina legt het abonnement uit en toont het adres van deze app',async()=>{
  const html=await (await call('/')).text();
  assert.ok(html.includes('Abonneer je agenda-app op'),'de uitleg over het abonnement hoort erbij te staan');
  assert.ok(html.includes('downloaden een momentopname'),'en dat de knoppen een momentopname geven');
  assert.ok(html.includes('id="agendaIcsAdres"'),'het adres hoort in de uitleg te staan');
  assert.ok(html.includes("icsAdres.textContent=location.origin+'/api/agenda.ics'"),'en gevuld te worden met het adres van deze app');
  assert.ok(html.includes('komt niet terug in deze app'),'de richting van de koppeling hoort duidelijk te zijn');
});
