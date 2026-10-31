const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voorraadthuis-'));
process.env.DB_PATH=path.join(dir,'test.db');
// De tests halen geen weerbericht op: het ophalen zelf wordt apart getest.
process.env.WEER_AUTO='0';
const {server,db}=require('../server');
let base;
test.before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});
// Maakt de boodschappenlijst leeg, zodat een test met een schone lijst begint.
async function legeBoodschappenlijst(){for(const regel of await(await call('/api/shopping')).json())await call(`/api/shopping/${regel.id}`,'DELETE');}
// Vergelijkt de boodschappenlijst voor en na een actie.
function nieuweRegels(voor,na){const oud=new Set(voor.map(x=>x.id));const nieuw=na.filter(x=>!oud.has(x.id)).map(x=>x.name);const verschil=na.filter(x=>{const eerder=voor.find(v=>v.id===x.id);return eerder&&eerder.quantity!==x.quantity;}).map(x=>x.name);return [...new Set([...nieuw,...verschil])];}
const call=(url,method='GET',data)=>fetch(base+url,{method,headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
test('producten toevoegen, opraken en boodschappen herstellen',async()=>{let r=await call('/api/products','POST',{name:'Havermelk',barcode:'871234',quantity:2,unit:'pakken'});assert.equal(r.status,201);assert.equal((await call('/api/products')).status,200);const products=await(await call('/api/products')).json();assert.equal(products.length,1);r=await call(`/api/products/${products[0].id}`,'PATCH',{action:'consume'});assert.equal(r.status,200);let list=await(await call('/api/shopping')).json();assert.equal(list.length,1);assert.equal(list[0].name,'Havermelk');r=await call(`/api/products/${list[0].id}`,'PATCH',{action:'restore'});assert.equal(r.status,200);list=await(await call('/api/shopping')).json();assert.equal(list.length,0);assert.equal((await(await call('/api/products')).json()).length,1);});
test('ongeldig product wordt geweigerd',async()=>{const r=await call('/api/products','POST',{name:'',quantity:0});assert.equal(r.status,400);});
test('recepten toevoegen aan boodschappenlijst',async()=>{const recipes=await(await call('/api/recipes')).json();assert.ok(recipes.length>=4);const recipe=recipes.find(x=>x.id===1);assert.ok(recipe.ingredients.length>=3);const r=await call(`/api/shopping/recipes/${recipe.id}`,'POST');assert.equal(r.status,201);const result=await r.json();assert.equal(result.added,recipe.ingredients.length);const list=await(await call('/api/shopping')).json();for(const ingredient of recipe.ingredients)assert.ok(list.some(x=>x.name===ingredient.name));});
test('internationale recepten zijn per land geordend en compleet uitgewerkt',async()=>{const recipes=await(await call('/api/recipes')).json();const countries=new Set(recipes.map(r=>r.cuisine));assert.ok(recipes.length>=115,`expected at least 115 recipes, got ${recipes.length}`);assert.ok(countries.size>=55,`expected at least 55 countries, got ${countries.size}`);assert.equal(new Set(recipes.map(r=>r.name)).size,recipes.length);// De eigen recepten zijn volledig uitgewerkt; de geïmporteerde bronnen hebben hun
// eigen, lossere ondergrens (zie de brontest hieronder), dus die tellen hier niet mee.
for(const recipe of recipes.filter(r=>!r.source)){assert.ok(recipe.cuisine);assert.ok(recipe.description);assert.ok(recipe.ingredients.length>=3);assert.ok(recipe.ingredients.every(i=>i.name&&Number(i.quantity)>0&&i.unit));assert.ok(recipe.steps.length>=3);assert.ok(recipe.time===null||recipe.time>0);assert.ok(recipe.servings===null||recipe.servings>0);}const japan=await(await call('/api/recipes?country=Japan')).json();assert.ok(japan.length>=2);assert.ok(japan.every(r=>r.cuisine==='Japan'));assert.deepEqual(recipes.map(r=>r.cuisine),[...recipes.map(r=>r.cuisine)].sort((a,b)=>a.localeCompare(b,'nl')));});
test('meerdere benoemde diensten met 24-uurs tijden worden opgeslagen en opgehaald',async()=>{const date='2026-11-06';const shifts=[{name:'Ochtenddienst',startTime:'07:30',endTime:'15:45',notes:'Kassa',color:''},{name:'Avonddienst',startTime:'15:45',endTime:'23:00',notes:'Afsluiten',color:''}];let r=await call(`/api/planner/${date}`,'PUT',{recipeId:1,cuisine:'Italië',shifts});assert.equal(r.status,200);let plan=await r.json();assert.deepEqual(plan.shifts,shifts);const plans=await(await call('/api/planner?month=2026-11')).json();assert.deepEqual(plans.find(x=>x.plan_date===date).shifts,shifts);r=await call(`/api/planner/${date}`,'PUT',{recipeId:1,cuisine:'Italië',shifts:[]});assert.equal(r.status,200);plan=await r.json();assert.deepEqual(plan.shifts,[]);await call(`/api/planner/${date}`,'DELETE');});
test('dienstgegevens weigeren ongeldige 24-uurs tijd en lege naam',async()=>{for(const shifts of [[{name:'Nacht',startTime:'24:00',endTime:'06:00'}],[{name:'',startTime:'09:00',endTime:'17:00'}],[{name:'Dienst',startTime:'09:00',endTime:'17:00'},{name:'Te laat',startTime:'17:00',endTime:'25:30'}]]){const r=await call('/api/planner/2026-11-07','PUT',{shifts});assert.equal(r.status,400);}});
test('kalenderplan en werkrooster opslaan en ophalen',async()=>{let r=await call('/api/planner/2026-11-04','PUT',{recipeId:1,cuisine:'Italië',workStart:'08:30',workEnd:'17:00',workNotes:'kantoordienst'});assert.equal(r.status,200);let plans=await(await call('/api/planner?month=2026-11')).json();assert.equal(plans.length,1);assert.equal(plans[0].recipe_id,1);assert.equal(plans[0].cuisine,'Italië');assert.equal(plans[0].work_start,'08:30');r=await call('/api/planner/2026-11-04','DELETE');assert.equal(r.status,200);plans=await(await call('/api/planner?month=2026-11')).json();assert.equal(plans.length,0);});
test('opgeslagen diensten kunnen worden aangemaakt, opgehaald en verwijderd',async()=>{const payload={name:'Avonddienst',startTime:'16:00',endTime:'23:30',notes:'Afsluiten'};let r=await call('/api/shift-templates','POST',payload);assert.equal(r.status,201);const saved=await r.json();assert.equal(saved.name,payload.name);assert.equal(saved.startTime,payload.startTime);assert.ok(saved.id);const list=await(await call('/api/shift-templates')).json();assert.ok(list.some(x=>x.id===saved.id&&x.name==='Avonddienst'));r=await call(`/api/shift-templates/${saved.id}`,'DELETE');assert.equal(r.status,200);assert.equal((await(await call('/api/shift-templates')).json()).some(x=>x.id===saved.id),false);});
test('opgeslagen diensten weigeren een ongeldige naam of 24-uurs tijd',async()=>{for(const payload of [{name:'',startTime:'08:00',endTime:'16:00'},{name:'Nacht',startTime:'24:00',endTime:'06:00'},{name:'Nacht',startTime:'22:00',endTime:'25:00'}]){const r=await call('/api/shift-templates','POST',payload);assert.equal(r.status,400);}});
test('de inrichtingsscripts hebben een kloppende bestandslijst',()=>{const {execFileSync}=require('node:child_process');const map=path.join(__dirname,'..','deploy','proxmox');for(const naam of ['install.sh','provision-voorraadthuis.sh','create-voorraadthuis-lxc.sh','update-from-github.sh','fetch-discogs-catalog.sh']){const bestand=path.join(map,naam);execFileSync('bash',['-n',bestand],{stdio:'pipe'});const regels=fs.readFileSync(bestand,'utf8').split('\n');regels.forEach((regel,nummer)=>assert.equal((regel.match(/"/g)||[]).length%2,0,`${naam} regel ${nummer+1}: oneven aantal aanhalingstekens`));if(naam!=='fetch-discogs-catalog.sh')for(const stuk of ['wikibooks-cocktails-recipes.json','wikibooks-borrelhapjes-recipes.json'])assert.ok(regels.some(regel=>regel.includes(stuk)),`${naam} mist ${stuk}`);}});
test('elke bestandsnaam in de bijwerklijst bestaat echt en staat los',()=>{const bestand=path.join(__dirname,'..','deploy','proxmox','update-from-github.sh');const regels=fs.readFileSync(bestand,'utf8').split('\n');const regel=regels.find(r=>r.startsWith('FILES='));assert.ok(regel,'geen bestandslijst gevonden');const onderdelen=(regel.match(/"[^"]*"|\S+/g)||[]).map(stuk=>stuk.replace(/^"|"$/g,'').replace(/^FILES=\(/,'')).filter(stuk=>stuk!=='${ASSETS[@]}'&&stuk!==')'&&stuk!=='');for(const stuk of onderdelen){assert.ok(!stuk.includes(' '),`bestandsnaam met een spatie in de lijst: ${stuk}`);assert.ok(fs.existsSync(path.join(__dirname,'..',stuk)),`bestand in de lijst bestaat niet: ${stuk}`);}assert.ok(onderdelen.length>=27,`verwacht een lange bestandslijst, gevonden ${onderdelen.length}`);});
test('een verse installatie haalt alles op wat het inrichten nodig heeft',()=>{
  const map=path.join(__dirname,'..','deploy','proxmox');
  const provision=fs.readFileSync(path.join(map,'provision-voorraadthuis.sh'),'utf8');
  const install=fs.readFileSync(path.join(map,'install.sh'),'utf8');
  const update=fs.readFileSync(path.join(map,'update-from-github.sh'),'utf8');
  const nodig=new Set();
  for(const regel of provision.split('\n')){
    const m=regel.match(/^for f in (.*?); do pct push/);
    if(!m) continue;
    const sub=(regel.match(/\$APP_DIR\/([a-z-]+)\/\$f/)||[])[1];
    for(const naam of m[1].replace(/"/g,'').split(/\s+/)) if(naam) nodig.add(sub?`${sub}/${naam}`:naam);
  }
  for(const stuk of ['platen.js','public/platen.js','product-data/lp-barcodes.json','deploy/proxmox/fetch-discogs-catalog.sh']) nodig.add(stuk);
  assert.ok(nodig.size>=30,`verwacht een flinke lijst, gevonden ${nodig.size}`);
  for(const bestand of nodig){
    assert.ok(install.includes(`"${bestand}"`),`install.sh haalt ${bestand} niet op, terwijl het inrichten dat wel nodig heeft`);
    assert.ok(update.includes(bestand),`update-from-github.sh kent ${bestand} niet`);
  }
});
test('elke dienst kan een eigen kleur krijgen',async()=>{const date='2026-11-10';const shifts=[{name:'Ochtenddienst',startTime:'07:00',endTime:'12:00',notes:'',color:'groen'},{name:'Avonddienst',startTime:'17:30',endTime:'23:00',notes:'',color:'blauw'}];let r=await call(`/api/planner/${date}`,'PUT',{shifts});assert.equal(r.status,200);let plan=await r.json();assert.deepEqual(plan.shifts.map(s=>s.color),['groen','blauw']);const plans=await(await call('/api/planner?month=2026-11')).json();assert.deepEqual(plans.find(x=>x.plan_date===date).shifts.map(s=>s.color),['groen','blauw'],'de kleur hoort ook in de maandlijst mee te komen');r=await call(`/api/planner/${date}`,'PUT',{shifts:[{name:'Fout',startTime:'09:00',endTime:'17:00',color:'regenboog'}]});assert.equal(r.status,400,'een onbekende kleur hoort geweigerd te worden');});
test('een opgeslagen dienst houdt zijn kleur',async()=>{const r=await call('/api/shift-templates','POST',{name:'Nachtdienst',startTime:'23:00',endTime:'07:00',notes:'overdracht',color:'paars'});assert.equal(r.status,201);const sjabloon=await r.json();assert.equal(sjabloon.color,'paars');const lijst=await(await call('/api/shift-templates')).json();assert.equal(lijst.find(s=>s.id===sjabloon.id).color,'paars');const fout=await call('/api/shift-templates','POST',{name:'X',startTime:'09:00',endTime:'17:00',color:'neon'});assert.equal(fout.status,400);});
test('de kleurenkiezer staat in de pagina en de kleur in de agenda',async()=>{const pagina=await(await call('/')).text();for(const stuk of ['const KLEUREN=','data-kleur-rij','const eersteVrijeKleur=','kleurstip','Kleur van deze dienst'])assert.ok(pagina.includes(stuk),`de pagina hoort ${stuk} te bevatten`);});
test('tijden zonder dubbele punt worden goed gezet',async()=>{const date='2026-11-08';let r=await call(`/api/planner/${date}`,'PUT',{shifts:[{name:'Ochtend',startTime:'830',endTime:'1630',notes:''}]});assert.equal(r.status,200);let plan=await r.json();assert.equal(plan.shifts[0].startTime,'08:30');assert.equal(plan.shifts[0].endTime,'16:30');r=await call(`/api/planner/${date}`,'PUT',{shifts:[{name:'Kort',startTime:'8',endTime:'8:5',notes:''}]});assert.equal(r.status,200);plan=await r.json();assert.equal(plan.shifts[0].startTime,'08:00');assert.equal(plan.shifts[0].endTime,'08:05');r=await call(`/api/planner/${date}`,'PUT',{shifts:[{name:'Fout',startTime:'24:00',endTime:'06:00'}]});assert.equal(r.status,400,'24:00 hoort een fout te blijven');});
test('de werkagenda toont elke dienst van een dag en de tijden in de dagcel',async()=>{const date='2026-11-09';const shifts=[{name:'Ochtenddienst',startTime:'07:00',endTime:'12:00',notes:''},{name:'Avonddienst',startTime:'17:30',endTime:'23:00',notes:'sluit'},{name:'Nachtdienst',startTime:'23:30',endTime:'06:00',notes:''}];const r=await call(`/api/planner/${date}`,'PUT',{shifts});assert.equal(r.status,200);const plan=await r.json();assert.equal(plan.shifts.length,3);assert.deepEqual(plan.shifts.map(s=>s.startTime),['07:00','17:30','23:30']);const plans=await(await call('/api/planner?month=2026-11')).json();assert.equal(plans.find(x=>x.plan_date===date).shifts.length,3,'de maandlijst hoort alle diensten van een dag mee te sturen');const pagina=await(await call('/')).text();for(const stuk of ['id="workAgenda"','id="workAgendaTotaal"','function renderWorkAgenda','function shiftUren','tijdrest'])assert.ok(pagina.includes(stuk),`de pagina hoort ${stuk} te bevatten`);});
test('kalender weigert ongeldige datum en tijd',async()=>{let r=await call('/api/planner/2026-02-30','PUT',{});assert.equal(r.status,400);r=await call('/api/planner/2026-11-04','PUT',{workStart:'99:99',workEnd:'17:00'});assert.equal(r.status,400);});
test('receptenboek bevat 9807 unieke recepten met herleidbare licentiebronnen',async()=>{const recipes=await(await call('/api/recipes')).json();assert.equal(recipes.length,9807);assert.equal(new Set(recipes.map(r=>r.id)).size,9807);const normalize=require('../recipes-open').normalizedName;assert.equal(new Set(recipes.map(r=>normalize(r.name))).size,9807);const imported=recipes.filter(r=>r.source);assert.equal(imported.length,9692);const perBron={'UniTools World Recipes':500,'Wikibooks Cookbook':3393,'Wikibooks Kochbuch (Spaans)':664,'Wikibooks Kochbuch (Duits)':407,'Wikibooks Kookboek (Nederlands)':450,'Wikibooks Livre de cuisine (Frans)':986,'Wikibooks Libro di cucina (Italiaans)':583,'Wikibooks Llibre de cuina (Catalaans)':673,'Wikibooks Livro de receitas (Portugees)':237,'Wikibooks 料理本 (Japans)':276,'Wikibooks Książka kucharska (Pools)':863,'Wikibooks Kokboken (Zweeds)':313,'Wikibooks Kokebok (Noors)':79,'Wikibooks Keittokirja (Fins)':11,'Wikibooks Cocktails':201,'Wikibooks Borrelhapjes':56};for(const [naam,aantal] of Object.entries(perBron))assert.equal(imported.filter(r=>r.source.name===naam).length,aantal,naam);const minimumStappen={'UniTools World Recipes':3,'Wikibooks Cookbook':3,'Wikibooks Kochbuch (Spaans)':3,'Wikibooks Kochbuch (Duits)':2,'Wikibooks Kookboek (Nederlands)':2,'Wikibooks Livre de cuisine (Frans)':2,'Wikibooks Libro di cucina (Italiaans)':2,'Wikibooks Llibre de cuina (Catalaans)':2,'Wikibooks Livro de receitas (Portugees)':2,'Wikibooks 料理本 (Japans)':2,'Wikibooks Książka kucharska (Pools)':2,'Wikibooks Kokboken (Zweeds)':2,'Wikibooks Kokebok (Noors)':2,'Wikibooks Keittokirja (Fins)':2,'Wikibooks Cocktails':1,'Wikibooks Borrelhapjes':1};for(const r of imported){assert.equal(r.source.license,'CC BY-SA 4.0');assert.ok(r.source.url);assert.ok(r.source.licenseUrl);assert.equal(r.language,'nl');assert.ok(r.alNederlands?r.translatedFrom===undefined:['en','es','de','fr','it','ca','pt','ja','pl','sv','nb','fi','hu'].includes(r.translatedFrom),`onbekende brontaal ${r.translatedFrom}`);assert.ok(r.ingredients.length>=3);assert.ok(r.steps.length>=minimumStappen[r.source.name],`${r.name} heeft te weinig stappen`);assert.ok(r.ingredients.every(i=>i.name&&Number(i.quantity)>0&&i.unit));}assert.ok(new Set(recipes.map(r=>r.cuisine)).size>=100);const engels=imported.filter(r=>r.source.name==='Wikibooks Cookbook');assert.ok(engels.every(r=>r.source.url.startsWith('https://en.wikibooks.org/wiki/Cookbook:')));const spaans=imported.filter(r=>r.source.name==='Wikibooks Kochbuch (Spaans)');assert.ok(spaans.every(r=>r.source.url.startsWith('https://es.wikibooks.org/wiki/')));const duits=imported.filter(r=>r.source.name==='Wikibooks Kochbuch (Duits)');assert.ok(duits.every(r=>r.source.url.startsWith('https://de.wikibooks.org/wiki/Kochbuch')));});
test('receptkaarten kunnen recepten rechtstreeks in de kalender plannen',async()=>{const html=await(await call('/')).text();assert.match(html,/data-plan-recipe=/);assert.match(html,/id="openRecipesToPlan"/);assert.match(html,/id="recipePlanDialog"/);assert.match(html,/id="recipePlanForm"/);assert.match(html,/async function saveRecipePlanner\(/);});
test('het dagformulier toont en behoudt een gepland recept dat buiten de eerste selectie valt',async()=>{const html=await(await call('/')).text();assert.match(html,/\$\('#planRecipe'\)\.value='';if\(p\?\.recipe_id\)\{await zetPlanRecept\(p\.recipe_id\);\$\('#planRecipe'\)\.value=String\(p\.recipe_id\)\}/);assert.match(html,/state\.recipeDetails\.get\(Number\(p\?\.recipe_id\)\)/);});
test('het plandialoog toont de gekozen dag voluit in het Nederlands',async()=>{const html=await(await call('/')).text();assert.match(html,/id="recipePlanUitleg"/);assert.match(html,/async function updateRecipePlanUitleg\(/);});
test('receptenboek toont actuele totalen in de beschrijving',async()=>{const pagina=await(await call('/')).text();assert.match(pagina,/9\.807 recepten: 115 Nederlandse thuisvarianten, aangevuld met 9\.692 recepten uit zestien open bronnen/);assert.doesNotMatch(pagina,/9\.550|9\.435|veertien open bronnen/);});
test('ingrediënten uit beide gelicentieerde bronnen gaan op de boodschappenlijst',async()=>{const recipes=await(await call('/api/recipes')).json();for(const sourceName of ['UniTools World Recipes','Wikibooks Cookbook','Wikibooks Kochbuch (Spaans)','Wikibooks Kochbuch (Duits)','Wikibooks Kookboek (Nederlands)','Wikibooks Livre de cuisine (Frans)','Wikibooks Libro di cucina (Italiaans)','Wikibooks Llibre de cuina (Catalaans)','Wikibooks Livro de receitas (Portugees)','Wikibooks 料理本 (Japans)','Wikibooks Książka kucharska (Pools)','Wikibooks Kokboken (Zweeds)','Wikibooks Kokebok (Noors)','Wikibooks Keittokirja (Fins)','Wikibooks Cocktails','Wikibooks Borrelhapjes']){const recipe=recipes.find(r=>r.source?.name===sourceName);assert.ok(recipe);const response=await call(`/api/shopping/recipes/${recipe.id}`,'POST');assert.equal(response.status,201);assert.equal((await response.json()).added,recipe.ingredients.length);const shopping=await(await call('/api/shopping')).json();for(const ingredient of recipe.ingredients)assert.ok(shopping.some(item=>item.name.toLowerCase()===ingredient.name.toLowerCase()),`${sourceName}: missing ${ingredient.name}`);}});
test('open-receptimport vereist de bestaande recepten voor deduplicatie',()=>{const createOpenRecipes=require('../recipes-open');assert.throws(()=>createOpenRecipes(),{name:'TypeError',message:/existing curated recipe list is required/});});
test('Wikibooks-hoeveelheidsranges blijven exact in plaats van een midpoint',()=>{const createOpenRecipes=require('../recipes-open');const ingredient=createOpenRecipes.wikibooksIngredient('2–4 cups rice');assert.deepEqual(ingredient,{name:'2–4 cups rice',quantity:1,unit:'bronregel',display:'2–4 cups rice'});});
test('alle 9241 buitenlandse geïmporteerde recepten zijn naar het Nederlands vertaald',async()=>{const translations=require('../recipe-data/translations-nl.json');assert.equal(translations.count,9241);assert.equal(translations.translatedFrom,'en/es/de/fr/it/ca/pt/ja/pl/sv/nb/fi/hu');assert.equal(Object.keys(translations.items).length,9241);const recipes=await(await call('/api/recipes')).json();const imported=recipes.filter(r=>r.source).filter(r=>!r.alNederlands);assert.equal(imported.length,9241);for(const r of imported){const translation=translations.items[r.sourceKey];assert.ok(translation,`geen vertaling voor ${r.sourceKey}`);assert.equal(r.language,'nl');assert.ok(['en','es','de','fr','it','ca','pt','ja','pl','sv','nb','fi','hu'].includes(r.translatedFrom),`onbekende brontaal ${r.translatedFrom}`);assert.ok(r.name===translation.name||(r.sourceNameKept&&r.name.startsWith(r.sourceNameKept)),`${r.sourceKey}: weergavenaam ${r.name} hoort de vertaling ${translation.name} te zijn of op de bronnaam te lijken`);if(translation.description)assert.equal(r.description,translation.description);assert.deepEqual(r.steps,translation.steps);assert.equal(r.ingredients.length,translation.ingredients.length);r.ingredients.forEach((ingredient,index)=>{assert.equal(ingredient.name,translation.ingredients[index].name);assert.equal(ingredient.display??null,translation.ingredients[index].display??null);});}const dutch=recipes.filter(r=>r.source&&r.source.name==='Wikibooks Kookboek (Nederlands)');assert.equal(dutch.length,450);assert.ok(dutch.every(r=>r.language==='nl'&&r.translatedFrom===undefined),'het Nederlandse kookboek mag niet als vertaald gemarkeerd worden');assert.ok(dutch.every(r=>r.source.url.startsWith('https://nl.wikibooks.org/wiki/Kookboek/')));assert.ok(dutch.some(r=>r.name==='Ragoût'));const eigen=recipes.filter(r=>!r.source);assert.equal(eigen.length,115);assert.ok(eigen.every(r=>r.language===undefined),'eigen recepten horen niet als vertaald gemarkeerd te zijn');const pasta=recipes.find(r=>r.name==='Pasta pesto');assert.ok(pasta&&!pasta.source);const range=recipes.find(r=>r.ingredients.some(i=>i.unit==='bronregel'));assert.ok(range,'geen recept met een bronregel gevonden');const rangeIngredient=range.ingredients.find(i=>i.unit==='bronregel');assert.equal(rangeIngredient.quantity,1);assert.equal(rangeIngredient.name,rangeIngredient.display);assert.ok(recipes.flatMap(r=>r.ingredients).every(i=>i.name.length<=600),'een ingrediëntnaam is te lang voor de boodschappenlijst');const langste=recipes.flatMap(r=>r.ingredients).reduce((a,b)=>b.name.length>a.name.length?b:a);assert.ok(langste.name.length>400,`verwacht een bronregel langer dan 400 tekens, langste is ${langste.name.length}`);const toegevoegd=await call('/api/shopping','POST',{name:langste.name,quantity:1,unit:'stuks'});assert.equal(toegevoegd.status,201,'een lange bronregel moet op de boodschappenlijst passen');await call(`/api/shopping/${(await(await call('/api/shopping')).json()).find(x=>x.name===langste.name).id}`,'DELETE');});
test('de import stopt met onvolledige vertalingen',()=>{
  const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vertaal-'));const partial=path.join(dir,'partial.json');
  fs.writeFileSync(partial,JSON.stringify({translatedFrom:'en/es/de',count:0,items:{}}));
  const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const builtin=[...source.matchAll(/^\s*\{id:\d+,name:'([^']+)'/gm)].map(match=>match[1]);
  assert.equal(builtin.length,5,`ingebouwde recepten gevonden: ${builtin.length}`);
  const international=require('../recipes-international');
  const curated=[...builtin.map((name,index)=>({id:index+1,name,cuisine:'Nederland',description:'d',ingredients:[{name:'x',quantity:1,unit:'stuks'}],steps:['s']})),...international];
  const modulePath=require.resolve('../recipes-open');const before=process.env.TRANSLATIONS_FILE;
  process.env.TRANSLATIONS_FILE=partial;delete require.cache[modulePath];
  try{
    const partialModule=require('../recipes-open');
    assert.throws(()=>partialModule(curated),{message:/Ontbrekende Nederlandse vertaling voor 9241/});
  }finally{
    if(before===undefined)delete process.env.TRANSLATIONS_FILE;else process.env.TRANSLATIONS_FILE=before;
    delete require.cache[modulePath];require('../recipes-open');fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('een bereikhoeveelheid blijft herkenbaar als origineel in de boodschappenlijst',async()=>{const recipes=await(await call('/api/recipes')).json();const recipe=recipes.find(r=>r.source?.name==='Wikibooks Cookbook'&&r.ingredients.some(i=>i.unit==='bronregel'));assert.ok(recipe);const ingredient=recipe.ingredients.find(i=>i.unit==='bronregel');const response=await call(`/api/shopping/recipes/${recipe.id}`,'POST');assert.equal(response.status,201);const items=await(await call('/api/shopping')).json();const saved=items.find(i=>i.name===ingredient.name&&i.unit==='bronregel');assert.ok(saved);assert.equal(saved.quantity,1);assert.equal(saved.name,ingredient.display);});
test('app-bestanden voor de telefoon worden met het juiste type geserveerd',async()=>{for(const [url,type] of [['/favicon.svg','image/svg+xml'],['/icon-192.png','image/png'],['/apple-touch-icon.png','image/png'],['/manifest.webmanifest','application/manifest+json'],['/sw.js','text/javascript; charset=utf-8'],['/barcode-scan.js?v=1','text/javascript; charset=utf-8']]){const r=await call(url);assert.equal(r.status,200,url);assert.equal(r.headers.get('content-type'),type,url);assert.ok((await r.text()).length>0,url)}});
test('bestandspaden buiten de public-map worden geweigerd',async()=>{for(const url of ['/../server.js','/..%2fserver.js','/%2e%2e/package.json','/public/../server.js','/index.html.bak']){const r=await call(url);assert.notEqual(r.status,200,url)}});
test('een verzoek met een dubbele schuine streep laat de app niet omvallen',async()=>{const http=require('node:http');const antwoord=await new Promise((klaar, mis)=>{const r=http.request({host:'127.0.0.1',port:server.address().port,path:'//',method:'GET'},res=>{res.resume();res.on('end',()=>klaar(res.statusCode))});r.on('error',mis);r.end()});assert.equal(antwoord,200);const nog=await call('/healthz');assert.equal(nog.status,200,'de app moet na dit verzoek gewoon doorwerken');});
test('de app serveert zelf de gezondheidscontrole op /healthz (geen nginx meer)',async()=>{const r=await call('/healthz');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'text/plain; charset=utf-8');assert.equal(r.headers.get('x-voorraadthuis'),'app','de kop waaraan de scripts zien dat de app zelf antwoordt ontbreekt');assert.equal((await r.text()).trim(),'ok');});
test('de app serveert de pagina zelf, zonder tussenlaag',async()=>{const html=await(await call('/')).text();assert.ok(html.includes('VoorraadThuis'));assert.ok(html.includes('Receptenboek'));});
test('het webapp-manifest maakt installatie op de telefoon mogelijk',async()=>{const manifest=await(await call('/manifest.webmanifest')).json();assert.equal(manifest.lang,'nl');assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.equal(manifest.theme_color,'#173c32');assert.ok(manifest.icons.some(i=>i.sizes==='192x192'));assert.ok(manifest.icons.some(i=>i.sizes==='512x512'));assert.ok(manifest.icons.some(i=>i.purpose==='maskable'))});
test('de pagina is ingericht voor mobiel gebruik',async()=>{const html=await(await call('/')).text();assert.match(html,/name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/);assert.match(html,/rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);assert.match(html,/@media\(max-width:760px\)/);assert.match(html,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(html,/<button data-page="profielen">Profielen<\/button>/);
assert.match(html,/id="smsRecipient"/);assert.match(html,/font-size:16px/);assert.match(html,/env\(safe-area-inset-bottom\)/);assert.match(html,/recipeLimit:24/);assert.match(html,/recipeMore/);assert.match(html,/serviceWorker/)});
test('de platenbundel en offline-cache krijgen een nieuwe versie bij updates',async()=>{const html=await(await call('/')).text();assert.match(html,/platen\.js\?v=5/,'een nieuwe URL voorkomt dat de oude platen.js uit de cache komt');const worker=await(await call('/sw.js')).text();assert.match(worker,/voorraadthuis-v14/,'de activatie moet de oude PWA-cache opruimen');assert.match(worker,/\/barcode-scan\.js/,'offline app moet scanner-helper in de shell-cache opnemen');});

test('de kledingkast-tab hoort bij dezelfde app',async()=>{const html=await(await call('/')).text();assert.match(html,/<button data-page="kast">Kleding<\/button>/);assert.match(html,/<section class="view" id="page-kast" hidden>/);});
test('de garderobe-config biedt categorieën aan met AI uit',async()=>{const r=await call('/api/kast/config');assert.equal(r.status,200);const config=await r.json();assert.ok(config.categories.includes('schoenen'));assert.equal(config.ai.enabled,false);});
test('de JavaScript in de pagina is syntactisch correct',async()=>{const html=await(await call('/')).text();
  // Elk blok met eigen JavaScript wordt apart gecontroleerd; scripts met een src horen
  // als bestand in public/ te staan (en dus ook in de bestandslijst van de deploy).
  const blokken=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  assert.ok(blokken.length>=1,'de pagina hoort eigen JavaScript te bevatten');
  const vm=require('node:vm');
  blokken.forEach((code,i)=>{assert.doesNotThrow(()=>new vm.Script(code,{filename:`public/index.html#${i}`}))});
  for(const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)){const bestand=m[1].split('?')[0];assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname,'..','public',bestand)),`${bestand} hoort in public/ te staan`)};
});
test('profielen met telefoonnummer worden via de API beheerd',async()=>{
  let r=await call('/api/profielen','POST',{name:'Tom Werdens',phone:'06 12345678',role:'boodschappen',email:'tom@voorbeeld.nl',smsRecipient:true});
  assert.equal(r.status,201);
  const tom=await r.json();
  assert.equal(tom.phone,'+31612345678');
  assert.equal(tom.phonePretty,'+31 6 1234 5678');
  assert.equal(tom.smsRecipient,true);
  r=await call('/api/profielen','POST',{name:'Sanne',phone:'+31 6 87654321'});
  assert.equal(r.status,201);
  const sanne=await r.json();
  assert.equal(sanne.smsRecipient,false);
  const lijst=await(await call('/api/profielen')).json();
  assert.equal(lijst.length,2);
  assert.equal(lijst[0].id,tom.id,'de standaardontvanger staat bovenaan');
  r=await call(`/api/profielen/${sanne.id}`,'PATCH',{name:'Sanne Werdens',phone:'0687654321',smsRecipient:true});
  assert.equal(r.status,200);
  assert.equal((await r.json()).smsRecipient,true);
  const na=await(await call('/api/profielen')).json();
  assert.equal(na.find(p=>p.id===tom.id).smsRecipient,false,'er is maar één standaardontvanger');
  for(const payload of [{name:''},{name:'Kees',phone:'abc'},{name:'Kees',email:'geen-mail'},{name:'Kees',smsRecipient:true}])assert.equal((await call('/api/profielen','POST',payload)).status,400,JSON.stringify(payload));
  assert.equal((await call('/api/profielen/9999','PATCH',{name:'Niemand'})).status,404);
  assert.equal((await call('/api/profielen/9999','DELETE')).status,404);
});

test('het sms-kanaal bewaart inloggegevens zonder ze terug te geven',async()=>{
  let r=await call('/api/instellingen/sms');
  assert.equal(r.status,200);
  const begin=await r.json();
  assert.equal(begin.provider,'link');
  assert.deepEqual(begin.providers.map(p=>p.id),['link','webhook','cheapconnect','twilio']);
  r=await call('/api/instellingen/sms','PUT',{provider:'rooksignalen'});
  assert.equal(r.status,400);
  r=await call('/api/instellingen/sms','PUT',{provider:'twilio',twilioSid:'AC1234567890abcd',twilioToken:'geheim-token-1234',twilioFrom:'06 12345678',sender:'Boodschappen'});
  assert.equal(r.status,200);
  const bewaard=await r.json();
  assert.equal(bewaard.provider,'twilio');
  assert.equal(bewaard.twilioTokenSet,true);
  assert.equal(JSON.stringify(bewaard).includes('geheim-token-1234'),false,'het token mag nooit in het antwoord staan');
  r=await call('/api/instellingen/sms','PUT',{provider:'webhook',webhookUrl:'https://voorbeeld.nl/sms',clear:['sms.twilioToken']});
  assert.equal(r.status,200);
  const gewist=await r.json();
  assert.equal(gewist.twilioTokenSet,false);
  assert.equal(gewist.webhookUrl,'https://voorbeeld.nl/sms');
  assert.equal((await call('/api/instellingen/sms','PUT',{provider:'webhook',webhookUrl:'niet-een-url'})).status,400);
  // CheapConnect: sleutel bewaren, nooit teruggeven, en pas compleet met een afzender.
  r=await call('/api/instellingen/sms','PUT',{provider:'cheapconnect',cheapconnectKey:'cc-sleutel-1234',from:'06 12345678'});
  assert.equal(r.status,200);
  const cc=await r.json();
  assert.equal(cc.provider,'cheapconnect');
  assert.equal(cc.cheapconnectKeySet,true);
  assert.equal(cc.cheapconnectKeyMask,'[REDACTED]');
  assert.equal(cc.canSend,true,'met sleutel en afzender kan de app zelf versturen');
  assert.equal(JSON.stringify(cc).includes('cc-sleutel-1234'),false,'de API-sleutel mag nooit in het antwoord staan');
  const ccLeeg=await(await call('/api/instellingen/sms','PUT',{provider:'cheapconnect',clear:['sms.cheapconnectKey']})).json();
  assert.equal(ccLeeg.cheapconnectKeySet,false);
  assert.equal(ccLeeg.canSend,false);
  assert.match(ccLeeg.providerHint,/API-sleutel/);
  assert.equal((await call('/api/instellingen/sms','PUT',{provider:'cheapconnect',from:'Boodschappenlijst van Tom'})).status,400);
  await call('/api/instellingen/sms','PUT',{provider:'link',from:'',clear:['sms.cheapconnectKey']});
});

test('de sms-knop verstuurt de lijst naar het nummer van het profiel',async()=>{
  const profielen=await(await call('/api/profielen')).json();
  const tom=profielen.find(p=>p.name==='Tom Werdens');
  assert.ok(tom);
  await call('/api/products','POST',{name:'Melk',quantity:2,unit:'pakken'});
  const producten=await(await call('/api/products')).json();
  const melkProduct=producten.find(product=>product.name==='Melk');
  assert.ok(melkProduct,'het product Melk staat in de voorraad');
  await call(`/api/products/${melkProduct.id}`,'PATCH',{action:'consume'});
  const lijst=await(await call('/api/shopping')).json();
  const melk=lijst.find(item=>item.name==='Melk');
  assert.ok(melk,'het opgeraakte product staat op de lijst');
  await call('/api/instellingen/sms','PUT',{provider:'link'});
  let r=await call('/api/sms/boodschappen','POST',{profileId:tom.id});
  assert.equal(r.status,200);
  const uitkomst=await r.json();
  assert.equal(uitkomst.sent,false);
  assert.equal(uitkomst.to,'+31612345678','de lijst gaat naar het nummer van het profiel');
  assert.match(uitkomst.link,/^sms:\+31612345678\?&body=/);
  assert.match(uitkomst.body,/Melk \(2 pakken\)/);
  assert.equal(decodeURIComponent(uitkomst.link.split('body=')[1]),uitkomst.body);
  r=await call('/api/sms/boodschappen','POST',{});
  assert.equal(r.status,400,'zonder ontvanger geen bericht');
  r=await call('/api/sms/boodschappen','POST',{to:'onzin'});
  assert.equal(r.status,400);
  r=await call('/api/sms/proef','POST',{profileId:tom.id});
  assert.equal(r.status,200);
  assert.equal((await r.json()).proef,true);
  const logboek=await(await call('/api/sms/log')).json();
  assert.ok(logboek.length>=2);
  assert.equal(logboek[0].recipient,'+31612345678');
  assert.equal(logboek[0].status,'koppeling');
  await call(`/api/shopping/${melk.id}`,'DELETE');
  for(const profiel of await(await call('/api/profielen')).json())await call(`/api/profielen/${profiel.id}`,'DELETE');
  assert.equal((await(await call('/api/profielen')).json()).length,0);
});

test('de garderobe begint met één kast die je kunt uitbreiden',async()=>{const kasten=await(await call('/api/kast/wardrobes')).json();assert.equal(kasten.length,1);assert.equal(kasten[0].name,'Thuis');assert.equal(kasten[0].items,0);const config=await(await call('/api/kast/config')).json();assert.ok(Array.isArray(config.wardrobes)&&config.wardrobes.length===1,'de config hoort de kasten mee te sturen');});
test('kledingstukken horen bij een kast en je kunt er kasten bij maken',async()=>{let r=await call('/api/kast/wardrobes','POST',{name:'Mama'});assert.equal(r.status,201);const mama=await r.json();assert.equal(mama.name,'Mama');r=await call('/api/kast/items','POST',{name:'Trui van mama',category:'trui',wardrobeId:mama.id});assert.equal(r.status,201);const trui=await r.json();assert.equal(trui.wardrobeId,mama.id);assert.equal(trui.wardrobeName,'Mama');const thuis=await call('/api/kast/items','POST',{name:'Eigen overhemd',category:'bovenkleding'});assert.equal((await thuis.json()).wardrobeName,'Thuis','zonder kast hoort een kledingstuk in de eerste kast te komen');const alleenMama=await(await call(`/api/kast/items?wardrobe=${mama.id}`)).json();assert.deepEqual(alleenMama.map(i=>i.name),['Trui van mama']);const alleenThuis=await(await call('/api/kast/items?wardrobe=1')).json();assert.deepEqual(alleenThuis.map(i=>i.name),['Eigen overhemd']);const alles=await(await call('/api/kast/items?wardrobe=alle')).json();assert.equal(alles.length,2);const kasten=await(await call('/api/kast/wardrobes')).json();assert.deepEqual(kasten.map(k=>[k.name,k.items]),[['Thuis',1],['Mama',1]]);for(const id of alleenMama.concat(alleenThuis))await call(`/api/kast/items/${id.id}`,'DELETE');await call(`/api/kast/wardrobes/${mama.id}`,'DELETE');});
test('een kast kan een andere naam krijgen en dubbele namen worden geweigerd',async()=>{const nieuw=await(await call('/api/kast/wardrobes','POST',{name:'Papa'})).json();let r=await call(`/api/kast/wardrobes/${nieuw.id}`,'PATCH',{name:'Papa thuis'});assert.equal(r.status,200);assert.equal((await r.json()).name,'Papa thuis');r=await call('/api/kast/wardrobes','POST',{name:'Papa THUIS'});assert.equal(r.status,400,'een naam die alleen in hoofdletters verschilt hoort geweigerd te worden');r=await call(`/api/kast/wardrobes/${nieuw.id}`,'PATCH',{name:'Thuis'});assert.equal(r.status,400);assert.equal((await call(`/api/kast/wardrobes/${nieuw.id}`,'DELETE')).status,200);});
test('een kast met kleding erin wordt alleen verwijderd als je de stuks verplaatst',async()=>{const mama=await(await call('/api/kast/wardrobes','POST',{name:'Mama 2'})).json();const item=await(await call('/api/kast/items','POST',{name:'Jas van mama',category:'jas',wardrobeId:mama.id})).json();let r=await call(`/api/kast/wardrobes/${mama.id}`,'DELETE');assert.equal(r.status,409);const fout=await r.json();assert.match(fout.error,/Verplaats/);const laatste=await(await call('/api/kast/wardrobes')).json();assert.equal(laatste.length,2,'de kast mag nog niet weg zijn');const thuis=laatste.find(k=>k.name==='Thuis');r=await call(`/api/kast/wardrobes/${mama.id}?moveTo=${thuis.id}`,'DELETE');assert.equal(r.status,200);assert.equal((await r.json()).movedTo,thuis.id);const verplaatst=await(await call(`/api/kast/items/${item.id}`)).json();assert.equal(verplaatst.wardrobeName,'Thuis');assert.equal((await(await call('/api/kast/wardrobes')).json()).length,1);const enige=await(await call('/api/kast/wardrobes')).json();assert.equal((await call(`/api/kast/wardrobes/${enige[0].id}`,'DELETE')).status,400,'de laatste kast mag niet weg');await call(`/api/kast/items/${item.id}`,'DELETE');});
test('een onbekende kast wordt geweigerd',async()=>{for(const [url,method,data] of [['/api/kast/items','POST',{name:'Test',category:'trui',wardrobeId:999}],['/api/kast/items?wardrobe=999','GET',null],['/api/kast/wardrobes/999','PATCH',{name:'X'}],['/api/kast/wardrobes/999','DELETE',null]]){const r=await call(url,method,data||undefined);assert.ok([400,404].includes(r.status),`${method} ${url} gaf ${r.status}`)}});

test('de compacte receptenlijst stuurt alleen wat de lijst nodig heeft',async()=>{const r=await call('/api/recipes?compact=1&aantal=5');assert.equal(r.status,200);const d=await r.json();assert.equal(d.totaal,9807);assert.equal(d.items.length,5);const eerste=d.items[0];assert.deepEqual(Object.keys(eerste).sort(),['cuisine','description','dieet','eigen','foto','id','name','servings','sourceLicense','sourceLicenseUrl','sourceName','sourceUrl','time','translatedFrom','voedingswaarde'].sort());assert.equal(eerste.ingredients,undefined,'de compacte lijst hoort geen ingrediënten mee te sturen');assert.ok(eerste.sourceName,'de bron hoort er wel bij te staan');const alles=await(await call('/api/recipes')).json();assert.equal(alles.length,9807,'zonder compact=1 blijft de volledige lijst bestaan');assert.ok(alles[0].ingredients.length>0);});
test('de compacte lijst laat bladeren en zoeken aan de server',async()=>{const een=await(await call('/api/recipes?compact=1&aantal=10&vanaf=0')).json();const twee=await(await call('/api/recipes?compact=1&aantal=10&vanaf=10')).json();assert.equal(een.items.length,10);assert.equal(twee.items.length,10);assert.equal(new Set([...een.items,...twee.items].map(r=>r.id)).size,20,'pagina\'s mogen niet overlappen');const zoek=await(await call('/api/recipes?compact=1&q=pesto')).json();assert.ok(zoek.totaal>0&&zoek.totaal<100,`pesto hoort een kleine selectie te geven, kreeg ${zoek.totaal}`);assert.ok(zoek.items.some(r=>r.name.toLowerCase().includes('pesto')));const land=await(await call('/api/recipes?compact=1&land=Itali%C3%AB&aantal=200')).json();assert.equal(land.totaal,land.items.length);assert.ok(land.items.every(r=>r.cuisine==='Italië'));});
test('de landenlijst met aantallen en een los recept komen er apart uit',async()=>{const landen=await(await call('/api/recipes/landen')).json();assert.ok(landen.length>=100);assert.equal(landen.reduce((som,l)=>som+l.aantal,0),9807);assert.deepEqual([...landen].sort((a,b)=>a.cuisine.localeCompare(b.cuisine,'nl')),landen);const it=landen.find(l=>l.cuisine==='Italië');assert.ok(it.aantal>0);const recept=await(await call(`/api/recipes/${(await(await call('/api/recipes?compact=1&aantal=1')).json()).items[0].id}`)).json();assert.ok(recept.ingredients.length>0&&recept.steps.length>0);assert.equal((await call('/api/recipes/999999')).status,404);});
test('grote antwoorden gaan gecomprimeerd over de lijn',async()=>{const geperst=await fetch(base+'/api/recipes',{headers:{'accept-encoding':'gzip'}});assert.equal(geperst.headers.get('content-encoding'),'gzip');const body=await geperst.text();assert.ok(body.length>1000000,'het antwoord hoort nog steeds de hele lijst te zijn');const ruw=await fetch(base+'/api/recipes',{headers:{'accept-encoding':'identity'}});assert.equal(ruw.headers.get('content-encoding'),null,'wie geen compressie wil krijgt het antwoord onverpakt');assert.equal((await ruw.text()).length,body.length);const klein=await fetch(base+'/api/recipes?compact=1&aantal=3',{headers:{'accept-encoding':'identity'}});assert.equal(klein.headers.get('content-encoding'),null,'kleine antwoorden hoeven niet geperst te worden');});

test('de pagina heeft geen dubbele id-s en de platenfilters staan erin',()=>{
  const pagina=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  const ids=(pagina.match(/\sid="([^"]+)"/g)||[]).map(s=>s.replace(/\sid="/,'').replace(/"$/,''));
  const dubbel=ids.filter((id,i)=>ids.indexOf(id)!==i);
  assert.deepEqual([...new Set(dubbel)],[],`dubbele id-s in de pagina: ${[...new Set(dubbel)].join(', ')}`);
  for(const id of ['plaatGenre','plaatArtiestFilter','plaatDecennium','plaatVan','plaatTot','plaatWisFilters','plaatFilterStand','plaatZoekVak']) assert.ok(ids.includes(id),`#${id} ontbreekt in de pagina`);
  const script=fs.readFileSync(path.join(__dirname,'..','public','platen.js'),'utf8');
  for(const id of ['plaatGenre','plaatArtiestFilter','plaatDecennium','plaatVan','plaatTot','plaatWisFilters']) assert.ok(script.includes(`#${id}`),`de filters verwijzen niet naar #${id}`);
  assert.ok(script.includes('#plaatZoekVak'),'het zoekresultaatvak heet plaatZoekVak');
});

test('het bijwerkscript zet elk bestand dat het inrichten plaatst ook echt in de container',()=>{
  // Deze test bestaat omdat platen.js wel werd opgehaald maar nooit in de container
  // gezet: de nieuwe server.js zocht './platen', de dienst viel om en de bijwerking
  // rolde terug. Zo'n bestand hoort hier op te vallen en niet in de container.
  const map=path.join(__dirname,'..','deploy','proxmox');
  const lees=(n)=>fs.readFileSync(path.join(map,n),'utf8');
  const groepen=(tekst)=>{
    const uit={};
    for(const regel of tekst.split('\n')){
      const m=regel.match(/for f in (.*?); do pct push/);
      if(!m) continue;
      const sub=(regel.match(/\$(?:APP_DIR|TMP)\/([a-z-]+)\/\$f/)||[])[1]||'';
      const namen=m[1].replace(/\$\{ASSETS\[@\]\}/g,'').replace(/"/g,'').split(/\s+/).filter(Boolean);
      uit[sub]=new Set([...(uit[sub]||[]),...namen]);
    }
    return uit;
  };
  const provision=groepen(lees('provision-voorraadthuis.sh'));
  const update=groepen(lees('update-from-github.sh'));
  const assets=(lees('update-from-github.sh').match(/^ASSETS=\((.*?)\)$/m)||['',''])[1].replace(/"/g,'').split(/\s+/).filter(Boolean);
  assert.ok(Object.keys(provision).length>=3,`verwacht meerdere push-lussen, gevonden ${Object.keys(provision).length}`);
  const gezet=[];
  for(const [sub,namen] of Object.entries(provision)){
    for(const naam of namen){
      gezet.push(naam);
      const doel=(update[sub]&&update[sub].has(naam))||assets.includes(naam);
      assert.ok(doel,`het bijwerkscript zet ${sub?sub+'/':''}${naam} niet in de container, terwijl het inrichten dat wel doet`);
    }
  }
  assert.ok(gezet.includes('platen.js'),'de platenmodule hoort in de lijst te staan');
  assert.ok(gezet.includes('public/platen.js'),'en de platenpagina ook');
});

test('de locatie van een plaat is helemaal vrij: geen standaardplekken in de pagina',()=>{
  const script=fs.readFileSync(path.join(__dirname,'..','public','platen.js'),'utf8');
  const pagina=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  for(const naam of ['Woonkamer','Zolder','Mama']){
    assert.ok(!script.includes(`'${naam}'`)&&!script.includes(`"${naam}"`),`de platenpagina noemt ${naam} als standaardplek`);
  }
  const datalist=(pagina.match(/<datalist id="plaatLocaties">([\s\S]*?)<\/datalist>/)||['',''])[1];
  assert.equal(datalist.trim(),'','de keuzelijst met plekken hoort leeg te beginnen; de plekken komen uit je eigen verzameling');
  const veld=(pagina.match(/<input id="plaatLocatie"[^>]*>/)||[''])[0];
  assert.ok(veld.includes('list="plaatLocaties"'),'het veld stelt je eigen plekken voor');
  assert.ok(!/value="[^"]+"/.test(veld),'het veld begint leeg');
});


test('de kookpot laat zien wat je met je voorraad kunt maken',async()=>{
  for(const product of [{name:'Pasta',quantity:500,unit:'gram'},{name:'Cherrytomaten',quantity:250,unit:'gram'},{name:'Groene pesto',quantity:1,unit:'potje'},{name:'Parmezaanse kaas',quantity:100,unit:'gram'}]){
    assert.equal((await call('/api/products','POST',product)).status,201);
  }
  const begin=Date.now();
  const antwoord=await(await call('/api/kookpot?max=2')).json();
  assert.ok(Date.now()-begin<15000,'de kookpot hoort ook met bijna tienduizend recepten snel te antwoorden');
  const pasta=antwoord.items.find(r=>r.id===1);
  assert.ok(pasta,'Pasta pesto hoort erbij te staan nu alles in huis is');
  assert.deepEqual(pasta.ontbreekt,[]);
  assert.equal(pasta.klaar,true);
  assert.equal(pasta.aanwezig,4);
  assert.ok(antwoord.items.every(r=>r.ontbreekt.length<=2),'recepten met meer ontbrekende ingrediënten horen er niet in te staan');
  assert.ok(antwoord.items[0].ontbreekt.length<=antwoord.items[antwoord.items.length-1].ontbreekt.length,'wie het minst mist staat bovenaan');
  assert.ok(antwoord.samenvatting.klaar>=1,'minstens één recept is nu te maken');
  assert.ok(antwoord.samenvatting.bijna>=0);
  assert.equal(antwoord.max,2);
  const streng=await(await call('/api/kookpot?max=0')).json();
  assert.ok(streng.items.every(r=>r.ontbreekt.length===0),'met marge 0 blijven alleen recepten over die je nu kunt maken');
  const gezocht=await(await call('/api/kookpot?max=3&q=lasagne&aantal=5')).json();
  assert.ok(gezocht.items.length<=5);
  assert.ok(gezocht.totaal>=1&&gezocht.totaal<antwoord.totaal,'de zoekterm hoort de kookpot te verkleinen');
  assert.ok(gezocht.items.some(r=>r.name.toLowerCase().includes('lasagne')),'lasagne hoort erbij te zitten');
});

test('de kookpot weigert een marge die niet bestaat',async()=>{
  for(const marge of ['99','-1','twee'])assert.equal((await call(`/api/kookpot?max=${marge}`)).status,400);
});

test('ingrediënten van een recept gaan met het gekozen aantal porties op de lijst',async()=>{
  await legeBoodschappenlijst();
  const voor=await(await call('/api/shopping')).json();
  let r=await call('/api/shopping/recipes/2','POST',{porties:2});
  assert.equal(r.status,201);
  const uitkomst=await r.json();
  assert.equal(uitkomst.added,5);
  assert.equal(uitkomst.porties,2);
  const na=await(await call('/api/shopping')).json();
  const ei=na.find(x=>x.name.toLowerCase()==='eieren');
  assert.ok(ei,'de eieren van de shakshuka horen op de lijst te staan');
  assert.equal(ei.quantity,3,'vier eieren voor drie personen wordt er voor twee personen drie, geen 2,7');
  assert.deepEqual(nieuweRegels(voor,na).sort(),['Eieren','Pitabrood','Rode paprika','Tomatenblokjes','Ui']);
});

test('met alleenOntbrekend komt er niets op de lijst dat al in huis is',async()=>{
  const voor=await(await call('/api/shopping')).json();
  const r=await call('/api/shopping/recipes/1','POST',{alleenOntbrekend:true});
  assert.equal(r.status,201);
  const uitkomst=await r.json();
  assert.equal(uitkomst.added,0,'alles van dit recept staat al in de voorraad');
  assert.equal(uitkomst.alleenOntbrekend,true);
  const na=await(await call('/api/shopping')).json();
  assert.equal(na.length,voor.length);
  const ontbrekend=await call('/api/shopping/recipes/2','POST',{alleenOntbrekend:true});
  assert.equal((await ontbrekend.json()).added,5,'van de shakshuka staat niets in huis');
});

test('de boodschappen van een hele week komen samengevoegd op één lijst',async()=>{
  await legeBoodschappenlijst();
  assert.equal((await call('/api/planner/2027-03-01','PUT',{recipeId:1,cuisine:'Italië',porties:2,shifts:[]})).status,200);
  assert.equal((await call('/api/planner/2027-03-02','PUT',{recipeId:1,cuisine:'Italië',porties:4,shifts:[]})).status,200);
  assert.equal((await call('/api/planner/2027-03-03','PUT',{recipeId:2,cuisine:'Tunesië',porties:3,shifts:[]})).status,200);
  const r=await call('/api/shopping/week','POST',{van:'2027-03-01',tot:'2027-03-07'});
  assert.equal(r.status,200);
  const uitkomst=await r.json();
  assert.equal(uitkomst.aantalDagen,3);
  assert.equal(uitkomst.aantalRecepten,2);
  const pasta=uitkomst.regels.find(x=>x.name.toLowerCase()==='pasta');
  assert.ok(pasta,'pasta van twee dagen hoort samengevoegd te zijn');
  assert.equal(pasta.quantity,525,'175 gram voor twee personen plus 350 gram voor vier personen');
  assert.equal(pasta.unit,'gram');
  assert.equal(pasta.uit.length,2,'de app hoort te kunnen vertellen uit welke dagen een regel komt');
  assert.deepEqual(uitkomst.dagen.map(d=>d.datum),['2027-03-01','2027-03-02','2027-03-03']);
  const list2=await(await call('/api/shopping')).json();
  assert.equal(list2.filter(x=>x.name.toLowerCase()==='pasta').length,1,'een samengevoegde regel komt één keer op de lijst');
  assert.equal(list2.find(x=>x.name.toLowerCase()==='pasta').quantity,525);
  assert.ok(list2.some(x=>x.name==='Eieren'),'de shakshuka doet ook mee');
  const leeg=await(await call('/api/shopping/week','POST',{van:'2030-01-01',tot:'2030-01-07'})).json();
  assert.equal(leeg.aantalRecepten,0);
  assert.deepEqual(leeg.regels,[]);
});

test('het samenvoegen van een week weigert onbruikbare periodes',async()=>{
  for(const periode of [{van:'2027-03-07',tot:'2027-03-01'},{van:'2027-13-01',tot:'2027-13-07'},{van:'2027-01-01',tot:'2027-03-01'},{}]){
    assert.equal((await call('/api/shopping/week','POST',periode)).status,400,JSON.stringify(periode));
  }
});

test('afvinken in de winkel zet het product in je voorraad',async()=>{
  assert.equal((await call('/api/products','POST',{name:'Havermout',quantity:500,unit:'gram'})).status,201);
  const producten=await(await call('/api/products')).json();
  const havermout=producten.find(p=>p.name==='Havermout');
  assert.equal((await call(`/api/products/${havermout.id}`,'PATCH',{action:'consume'})).status,200);
  let list=await(await call('/api/shopping')).json();
  const regel=list.find(x=>x.name==='Havermout');
  assert.ok(regel);
  let r=await call(`/api/shopping/${regel.id}/afvinken`,'POST');
  assert.equal(r.status,200);
  const afgevinkt=await r.json();
  assert.equal(afgevinkt.naam,'Havermout');
  assert.equal(afgevinkt.aantal,1);
  list=await(await call('/api/shopping')).json();
  assert.equal(list.some(x=>x.id===regel.id),false,'een afgevinkt product hoort van de lijst te gaan');
  const terug=(await(await call('/api/products')).json()).find(p=>p.name==='Havermout');
  assert.ok(terug,'het product hoort weer in de voorraad te staan');
  assert.equal(terug.aantal,1);
  assert.equal(terug.quantity,500);
  assert.equal(terug.unit,'gram');
  assert.equal((await call('/api/shopping/9999/afvinken','POST')).status,404);
});

test('afvinken telt de stuks die je koopt bij de voorraad op',async()=>{
  const list=await(await call('/api/shopping')).json();
  const regel=list.find(x=>x.name.toLowerCase()==='eieren');
  assert.ok(regel,'de eieren van de shakshuka staan op de lijst');
  const gevraagd=Math.max(1,Math.round(regel.quantity));
  assert.equal((await call(`/api/shopping/${regel.id}/afvinken`,'POST')).status,200);
  const ei=(await(await call('/api/products')).json()).find(p=>p.name==='Eieren');
  assert.equal(ei.aantal,gevraagd,'zoveel eieren als je koopt komen er in de voorraad bij');
});

test('een dagplanning onthoudt het aantal porties van die dag',async()=>{
  let r=await call('/api/planner/2027-04-06','PUT',{recipeId:3,cuisine:'India',porties:6,shifts:[]});
  assert.equal(r.status,200);
  assert.equal((await r.json()).porties,6);
  const plans=await(await call('/api/planner?month=2027-04')).json();
  assert.equal(plans.find(p=>p.plan_date==='2027-04-06').porties,6);
  r=await call('/api/planner/2027-04-06','PUT',{recipeId:3,cuisine:'India',porties:0});
  assert.equal(r.status,400,'nul porties kan niet');
  r=await call('/api/planner/2027-04-06','PUT',{recipeId:3,cuisine:'India',porties:99});
  assert.equal(r.status,400);
  r=await call('/api/planner/2027-04-07','PUT',{recipeId:3,cuisine:'India'});
  assert.equal(r.status,200);
  assert.equal((await r.json()).porties,null,'zonder keuze blijft het aantal porties leeg');
});

test('de bereiding krijgt per stap de tijden mee voor de kookmodus',async()=>{
  const recept=await(await call('/api/recipes/2')).json();
  assert.equal(recept.stapTimers.length,recept.steps.length);
  assert.deepEqual(recept.stapTimers[0],[]);
  assert.deepEqual(recept.stapTimers[1],[720],'laat 12 minuten pruttelen');
  assert.deepEqual(recept.stapTimers[2],[]);
  assert.ok(recept.steps.some(s=>typeof s==='string'));
});

test('de weerinstellingen worden bewaard en teruggegeven',async()=>{
  let antwoord=await(await call('/api/weer')).json();
  assert.equal(antwoord.instellingen.plaats,'');
  assert.equal(antwoord.instellingen.aan,true);
  assert.equal(antwoord.vandaag,null);
  assert.equal(antwoord.bron.naam,'Open-Meteo','de app hoort te vertellen waar het weer vandaan komt');
  assert.equal((await call('/api/weer/instellingen','PUT',{plaats:'Delft',lat:52,lon:4.35,land:'Nederland'})).status,200);
  antwoord=await(await call('/api/weer')).json();
  assert.equal(antwoord.instellingen.plaats,'Delft');
  assert.equal(antwoord.instellingen.lat,52);
  assert.equal(antwoord.instellingen.lon,4.35);
  const uit=await(await call('/api/weer/instellingen','PUT',{aan:false})).json();
  assert.equal(uit.instellingen.aan,false);
  assert.equal(uit.instellingen.plaats,'Delft','het uitzetten van het weer laat de plaats staan');
  const leeg=await(await call('/api/weer/instellingen','PUT',{plaats:''})).json();
  assert.equal(leeg.instellingen.plaats,'','een lege plaats haalt de verwachting weg');
  assert.equal((await call('/api/weer/instellingen','PUT',{plaats:'x'.repeat(80)})).status,400);
  const config=await(await call('/api/kast/config')).json();
  assert.ok(config.weer,'de garderobe-instellingen vertellen ook waar het weer vandaan komt');
  assert.equal(config.weer.plaats,'');
});

test('de kookpot staat in het receptenboek met marge en uitleg',async()=>{
  const pagina=await(await call('/')).text();
  for(const stuk of ['id="receptModus"','data-modus="kookpot"','id="kookpotMarge"','id="kookpotUitleg"','id="kookpotMargeLabel"','function laadKookpot','function kookpotBadge','function zetReceptModus','data-ontbrekende'])assert.ok(pagina.includes(stuk),`de pagina hoort ${stuk} te bevatten`);
  assert.match(pagina,/\/api\/kookpot\?/,'de pagina hoort de kookpot van de server te halen');
});

test('de boodschappenlijst kan een hele week samenvoegen',async()=>{
  const pagina=await(await call('/')).text();
  for(const stuk of ['id="weekBoodschappen"','id="weekDialog"','id="weekForm"','id="weekVan"','id="weekTot"','id="weekUitleg"','function openWeekBoodschappen','function updateWeekUitleg','function zetWeekOpLijst'])assert.ok(pagina.includes(stuk),`de pagina hoort ${stuk} te bevatten`);
  assert.match(pagina,/\/api\/shopping\/week/);
});

test('porties zijn om te rekenen in het recept en in de dagplanning',async()=>{
  const pagina=await(await call('/')).text();
  for(const stuk of ['data-porties-plus','data-porties-min','data-porties-waarde','id="planPorties"','id="recipePlanPorties"','function vulReceptDetail'])assert.ok(pagina.includes(stuk),`de pagina hoort ${stuk} te bevatten`);
  assert.match(pagina,/\/api\/recipes\/\$\{id\}\$\{porties/,'het receptdetail hoort de gekozen porties aan de server te vragen');
});

test('de kookmodus staat in de pagina met stappen, timer en scherm-aan',async()=>{
  const pagina=await(await call('/')).text();
  for(const stuk of ['id="kookmodus"','id="kookmodusStappen"','id="kookmodusVorige"','id="kookmodusVolgende"','id="kookmodusTimer"','id="planKookmodus"','function openKookmodus','function startKookTimer','function renderKookmodus','data-timer','navigator.wakeLock','new Notification('])assert.ok(pagina.includes(stuk),`de pagina hoort ${stuk} te bevatten`);
});

test('de boodschappenlijst kan worden afgevinkt naar de voorraad',async()=>{
  const pagina=await(await call('/')).text();
  for(const stuk of ['data-afvinken','function afvinken','/api/shopping/${id}/afvinken','staat nu'])assert.ok(pagina.includes(stuk),`de pagina hoort ${stuk} te bevatten`);
});

test('het weer is in te stellen bij het kledingadvies',async()=>{
  const pagina=await(await call('/')).text();
  for(const stuk of ['id="weerPlaats"','id="weerZoek"','id="weerAan"','id="weerRegel"','function loadWeer','function bewaarWeerPlaats','/api/weer/instellingen','Open-Meteo'])assert.ok(pagina.includes(stuk),`de pagina hoort ${stuk} te bevatten`);
});

test('het receptdetail rekent de hoeveelheden om naar het gekozen aantal porties',async()=>{
  const heel=await(await call('/api/recipes/2')).json();
  assert.equal(heel.servings,3);
  assert.equal(heel.porties,null);
  const voor2=await(await call('/api/recipes/2?porties=2')).json();
  assert.equal(voor2.porties,2);
  assert.equal(voor2.ingredients.find(i=>i.name==='Eieren').quantity,3,'vier eieren voor drie personen wordt er voor twee personen drie');
  assert.equal(voor2.ingredients.find(i=>i.name==='Eieren').unit,'stuks');
  assert.equal(voor2.steps.length,heel.steps.length);
  assert.deepEqual(voor2.stapTimers,heel.stapTimers);
  assert.equal((await call('/api/recipes/2?porties=0')).status,400);
  assert.equal((await call('/api/recipes/2?porties=30')).status,400);
  assert.equal((await call('/api/recipes/2?porties=abc')).status,400);
});

test('elk bestand dat de server nodig heeft komt mee met installeren en bijwerken',()=>{
  // Zo voorkom je dat een nieuwe module wel in git staat maar nooit in de
  // container belandt: dan start de app na een update niet meer.
  const bron=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const modules=[...bron.matchAll(/require\('\.\/([a-z0-9-]+)'\)/g)].map(m=>`${m[1]}.js`);
  assert.ok(modules.length>=5,`verwacht meerdere eigen modules, gevonden ${modules.length}`);
  for(const bestand of modules){
    assert.ok(fs.existsSync(path.join(__dirname,'..',bestand)),`${bestand} bestaat niet`);
    for(const script of ['install.sh','provision-voorraadthuis.sh','update-from-github.sh']){
      const inhoud=fs.readFileSync(path.join(__dirname,'..','deploy','proxmox',script),'utf8');
      assert.ok(inhoud.includes(bestand),`${script} kent ${bestand} niet, terwijl de server het nodig heeft`);
    }
  }
});
