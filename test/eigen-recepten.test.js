const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eigen-recepten-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.MEDIA_DIR=path.join(dir,'fotos');
process.env.WEER_AUTO='0';
const {server,db}=require('../server');
let base;
test.before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});

const call=(pad,method='GET',body)=>fetch(base+pad,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
// Een echte, kleine JPEG (rood blok) om de fotoupload mee te testen.
const MINI_JPEG='/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYxLjE5LjEwMQD/2wBDAAgKCgsKCw0NDQ0NDRAPEBAQEBAQEBAQEBASEhIVFRUSEhIQEBISFBQVFRcXFxUVFRUXFxkZGR4eHBwjIyQrKzP/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAQABAAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AiwEo38AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/9k=';

const eigenRecept={
  name:'Oma’s erwtensoep', cuisine:'Nederland', servings:4, time:90,
  description:'Stevige snert met rookworst, een dag later nog lekkerder.',
  ingredients:[{name:'Spliterwten',quantity:500,unit:'gram'},{name:'Rookworst',quantity:1,unit:'stuk'},{name:'Prei',quantity:1,unit:'stuk'}],
  steps:['Week de erwten een nacht.','Kook de erwten 60 minuten zacht.','Voeg prei en rookworst toe en warm nog 15 minuten door.'],
  dieet:['glutenvrij'], voedingswaarde:{kcal:420,eiwit:24.5,koolhydraten:48,vet:14},
};

async function maakEigenRecept(extra={}){
  const r=await call('/api/recepten','POST',{...eigenRecept,...extra});
  const tekst=await r.text();
  assert.equal(r.status,201,tekst);
  return JSON.parse(tekst);
}

test('een eigen recept komt in het receptenboek, is op te halen met zijn eigen id en weer te verwijderen',async()=>{
  const recept=await maakEigenRecept();
  assert.ok(recept.id>=900000,`eigen recepten krijgen een eigen id-reeks, kreeg ${recept.id}`);
  assert.equal(recept.eigen,true);
  assert.equal(recept.name,eigenRecept.name);
  assert.deepEqual(recept.dieet,['glutenvrij']);
  assert.equal(recept.voedingswaarde.kcal,420);

  const alle=await(await call('/api/recipes')).json();
  assert.ok(alle.some(r=>r.id===recept.id),'het eigen recept hoort in het receptenboek te staan');
  assert.equal(alle.length,9808,'er komt precies één recept bij');

  const een=await(await call(`/api/recipes/${recept.id}`)).json();
  assert.equal(een.name,eigenRecept.name);
  assert.equal(een.ingredients.length,3);
  assert.equal(een.steps.length,3);
  assert.equal(een.voedingswaarde.vet,14);
  assert.equal(een.eigen,true);

  const landen=await(await call('/api/recipes/landen')).json();
  assert.ok(landen.some(l=>l.cuisine==='Nederland'),'het land van het eigen recept hoort in de keuzelijst');

  const weg=await call(`/api/recepten/${recept.id}`,'DELETE');
  assert.equal(weg.status,200);
  assert.equal((await call(`/api/recepten/${recept.id}`,'DELETE')).status,404);
  const na=await(await call('/api/recipes')).json();
  assert.equal(na.length,9807);
  assert.equal(na.some(r=>r.id===recept.id),false);
});

test('een eigen recept vraagt om een naam, kloppende getallen en een bekende dieetkeuze',async()=>{
  const fout=async(payload,verwacht=400)=>{
    const r=await call('/api/recepten','POST',payload);
    assert.equal(r.status,verwacht,`onverwachte status voor ${JSON.stringify(payload).slice(0,90)}`);
    const antwoord=await r.json();
    assert.match(antwoord.error,/naam|porties|dieet|voedingswaarde|minuten|hoeveelheid|eenheid|stap|ingrediënt/i);
  };
  await fout({...eigenRecept,name:'   '});
  await fout({...eigenRecept,servings:0});
  await fout({...eigenRecept,servings:99});
  await fout({...eigenRecept,time:-5});
  await fout({...eigenRecept,dieet:['koolhydraatarm']});
  await fout({...eigenRecept,voedingswaarde:{kcal:-1}});
  await fout({...eigenRecept,voedingswaarde:{eiwit:900}});
  await fout({...eigenRecept,ingredients:'geen lijst'});
  await fout({...eigenRecept,ingredients:[{name:'Zout',quantity:0,unit:'gram'}]});
  await fout({...eigenRecept,ingredients:[{name:'Zout',quantity:1,unit:'x'.repeat(40)}]});
  await fout({...eigenRecept,steps:['']});
  // Een leeg dieetfilter mag wel: een recept zonder dieetgegevens is geen fout.
  const kaal=await maakEigenRecept({name:'Tomatensoep',dieet:[],voedingswaarde:{},ingredients:[{name:'Tomaten',quantity:500,unit:'gram'}],steps:['Kook de tomaten.']});
  assert.deepEqual(kaal.dieet,[]);
  assert.deepEqual(kaal.voedingswaarde,{kcal:null,eiwit:null,koolhydraten:null,vet:null});
  await call(`/api/recepten/${kaal.id}`,'DELETE');
});

test('een eigen recept is te wijzigen en de wijziging is meteen te zien',async()=>{
  const recept=await maakEigenRecept();
  const r=await call(`/api/recepten/${recept.id}`,'PATCH',{servings:6,dieet:['vegetarisch','lactosevrij'],voedingswaarde:{kcal:380}});
  assert.equal(r.status,200);
  const gewijzigd=await r.json();
  assert.equal(gewijzigd.servings,6);
  assert.deepEqual(gewijzigd.dieet,['vegetarisch','lactosevrij']);
  assert.equal(gewijzigd.voedingswaarde.kcal,380);
  assert.equal(gewijzigd.voedingswaarde.eiwit,24.5,'wat je niet meestuurt blijft staan');
  assert.equal((await call('/api/recepten/999999','PATCH',{servings:2})).status,404);
  assert.equal((await call('/api/recepten/1','PATCH',{servings:2})).status,404,'een ingebouwd recept is niet via deze route te wijzigen');
  await call(`/api/recepten/${recept.id}`,'DELETE');
});

test('de dieetfilters en voedingswaarde filteren het receptenboek',async()=>{
  const vega=await maakEigenRecept({name:'Groentelasagne',dieet:['vegetarisch'],cuisine:'Italië'});
  const vlees=await maakEigenRecept({name:'Hachee',dieet:[],cuisine:'Nederland'});
  // Het boek is groot en komt in stukjes; zoek daarom op naam in plaats van te
  // vertrouwen op de eerste pagina.
  const vegaLijst=await(await call('/api/recipes?compact=1&dieet=vegetarisch&aantal=200&q=groentelasagne')).json();
  assert.ok(vegaLijst.items.some(r=>r.id===vega.id),'het vegetarische recept hoort in de filterlijst');
  assert.ok(vegaLijst.items.every(r=>r.dieet.includes('vegetarisch')));
  const zonderDieet=await(await call('/api/recipes?compact=1&aantal=200&q=groentelasagne')).json();
  assert.ok(zonderDieet.items.some(r=>r.id===vega.id),'zonder dieetfilter hoort het recept er ook te zijn');
  const vleesBijVega=await(await call('/api/recipes?compact=1&dieet=vegetarisch&aantal=200&q=hachee')).json();
  assert.equal(vleesBijVega.items.some(r=>r.id===vlees.id),false,'een recept zonder dieetkeuze hoort er niet in');
  const een=await(await call(`/api/recipes/${vega.id}`)).json();
  assert.deepEqual(een.voedingswaarde,{kcal:420,eiwit:24.5,koolhydraten:48,vet:14},'de voedingswaarde hoort per portie mee te komen');
  assert.deepEqual(een.dieet,['vegetarisch']);
  assert.equal((await call('/api/recipes?compact=1&dieet=onzin')).status,400);
  const keuzes=await(await call('/api/recipes/dieetfilters')).json();
  assert.deepEqual(keuzes.map(k=>k.id),['vegetarisch','veganistisch','glutenvrij','lactosevrij','notenvrij']);
  assert.ok(keuzes.every(k=>k.naam));
  await call(`/api/recepten/${vega.id}`,'DELETE');
  await call(`/api/recepten/${vlees.id}`,'DELETE');
});

test('een foto bij een eigen recept wordt bewaard en daarna uitgeserveerd',async()=>{
  const recept=await maakEigenRecept();
  const leeg=await call(`/api/recepten/${recept.id}/foto`,'POST',{afbeelding:'niet-basis64'});
  assert.equal(leeg.status,400);
  const r=await call(`/api/recepten/${recept.id}/foto`,'POST',{afbeelding:MINI_JPEG});
  const fotoTekst=await r.text();
  assert.equal(r.status,200,fotoTekst);
  const uitkomst=JSON.parse(fotoTekst);
  assert.match(uitkomst.foto,/^\/media\/recept-\d+\.jpg$/);
  const beeld=await call(uitkomst.foto);
  assert.equal(beeld.status,200);
  assert.equal(beeld.headers.get('content-type'),'image/jpeg');
  assert.ok((await beeld.arrayBuffer()).byteLength>200);
  const recept2=await(await call(`/api/recipes/${recept.id}`)).json();
  assert.equal(recept2.foto,uitkomst.foto,'de foto hoort bij het recept te staan');
  const compact=await(await call('/api/recipes?compact=1&aantal=200&q=erwtensoep')).json();
  assert.equal(compact.items.find(x=>x.id===recept.id)?.foto,uitkomst.foto,'ook de lijst toont de foto');
  assert.equal((await call('/api/recepten/999999/foto','POST',{afbeelding:MINI_JPEG})).status,404);
  await call(`/api/recepten/${recept.id}`,'DELETE');
});

test('de pagina heeft een eigen-receptformulier met foto, dieetkeuzes en voedingswaarde',async()=>{
  const html=await(await call('/')).text();
  for(const stuk of ['id="eigenReceptDialog"','id="eigenReceptForm"','id="eigenReceptToevoegen"','id="eigenIngredienten"','id="eigenStappen"','id="eigenDieet"','id="eigenFoto"','id="eigenKcal"','id="recipeDieet"','data-eigen-wijzig=','data-eigen-verwijder=','function bewaarEigenRecept','function openEigenRecept','function verwijderEigenRecept','parseIngredientRegels','leesEigenFoto','/api/recepten/${recept.id}/foto']){
    assert.ok(html.includes(stuk),`de pagina hoort ${stuk} te bevatten`);
  }
  // De dieetkeuzes komen van de server; de pagina haalt ze daar op in plaats van ze zelf te verzinnen.
  assert.ok(html.includes("api('/api/recipes/dieetfilters')"),'de pagina hoort de dieetkeuzes bij de server op te halen');
});
