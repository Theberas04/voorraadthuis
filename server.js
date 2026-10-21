const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const sqlite3 = require('node:sqlite');
const internationalRecipes = require('./recipes-international');
const createOpenRecipes = require('./recipes-open');
const { createWardrobe } = require('./wardrobe');
const { createBarcodes } = require('./barcodes');
const { createProfiles } = require('./profiles');
const { URL } = require('node:url');

const TLS_CERT = () => process.env.TLS_CERT || '/etc/voorraadthuis/tls/cert.pem';
const TLS_KEY = () => process.env.TLS_KEY || '/etc/voorraadthuis/tls/key.pem';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'voorraad.db');
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(path.dirname(DB_PATH), 'fotos');
fs.mkdirSync(path.dirname(DB_PATH), {recursive:true});
const db = new sqlite3.DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, barcode TEXT UNIQUE, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT 'stuks', aantal INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS shopping(id INTEGER PRIMARY KEY, product_id INTEGER UNIQUE, name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT 'stuks'); CREATE TABLE IF NOT EXISTS planner(plan_date TEXT PRIMARY KEY, recipe_id INTEGER, cuisine TEXT NOT NULL DEFAULT '', work_start TEXT NOT NULL DEFAULT '', work_end TEXT NOT NULL DEFAULT '', work_notes TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS work_shifts(id INTEGER PRIMARY KEY, plan_date TEXT NOT NULL, name TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, notes TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS shift_templates(id INTEGER PRIMARY KEY, name TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
// Voorraad die al in de database staat krijgt één stuk; daarna kan de gebruiker het aantal zelf bijstellen.
try{db.exec('ALTER TABLE products ADD COLUMN aantal INTEGER NOT NULL DEFAULT 1')}catch(e){}
// Migrate saved legacy single-shift plans once; subsequent saves replace both forms.
db.exec(`INSERT INTO work_shifts(plan_date,name,start_time,end_time,notes) SELECT plan_date,CASE WHEN trim(work_notes)='' THEN 'Dienst' ELSE trim(work_notes) END,work_start,work_end,'' FROM planner WHERE work_start<>'' AND work_end<>'' AND NOT EXISTS(SELECT 1 FROM work_shifts WHERE work_shifts.plan_date=planner.plan_date)`);

const BUILTIN_RECIPES = [
  {id:1,name:'Pasta pesto',cuisine:'Italië',time:25,servings:4,description:'Een snelle pasta met basilicumpesto, tomaat en Parmezaan.',ingredients:[{name:'Pasta',quantity:350,unit:'gram'},{name:'Groene pesto',quantity:1,unit:'potje'},{name:'Cherrytomaten',quantity:250,unit:'gram'},{name:'Parmezaanse kaas',quantity:60,unit:'gram'}],steps:['Kook de pasta beetgaar en bewaar een kopje kookwater.','Halveer de tomaten en meng met pesto en een scheut kookwater.','Schep door de pasta en rasp Parmezaan erover.']},
  {id:2,name:'Shakshuka',cuisine:'Tunesië',time:30,servings:3,description:'Eieren in kruidige tomatensaus, met warm brood.',ingredients:[{name:'Eieren',quantity:4,unit:'stuks'},{name:'Tomatenblokjes',quantity:400,unit:'gram'},{name:'Rode paprika',quantity:1,unit:'stuk'},{name:'Ui',quantity:1,unit:'stuk'},{name:'Pitabrood',quantity:3,unit:'stuks'}],steps:['Snipper ui en paprika en bak ze zacht.','Voeg tomaten en specerijen toe en laat 12 minuten pruttelen.','Maak kuiltjes, breek de eieren erin en laat met deksel garen.']},
  {id:3,name:'Kikkererwtencurry',cuisine:'India',time:35,servings:4,description:'Milde curry met kokosmelk, spinazie en rijst.',ingredients:[{name:'Kikkererwten',quantity:2,unit:'blikken'},{name:'Kokosmelk',quantity:1,unit:'blik'},{name:'Spinazie',quantity:200,unit:'gram'},{name:'Currypasta',quantity:2,unit:'eetlepels'},{name:'Basmatirijst',quantity:300,unit:'gram'}],steps:['Kook de rijst volgens de verpakking.','Bak de currypasta kort en roer de kokosmelk en kikkererwten erdoor.','Laat 15 minuten sudderen, roer de spinazie erdoor en serveer met rijst.']},
  {id:4,name:'Taco’s met zwarte bonen',cuisine:'Mexico',time:25,servings:4,description:'Krokante taco’s met bonen, mais en frisse limoen.',ingredients:[{name:'Tacoschelpen',quantity:8,unit:'stuks'},{name:'Zwarte bonen',quantity:1,unit:'blik'},{name:'Mais',quantity:1,unit:'blik'},{name:'Avocado',quantity:2,unit:'stuks'},{name:'Limoen',quantity:1,unit:'stuk'}],steps:['Verwarm de tacoschelpen.','Spoel bonen en mais af en verwarm ze met paprikapoeder.','Vul de schelpen en serveer met avocado en limoen.']},
  {id:5,name:'Boerenkoolstamppot',cuisine:'Nederland',time:40,servings:4,description:'Hollandse stamppot met rookworst en mosterd.',ingredients:[{name:'Boerenkool',quantity:500,unit:'gram'},{name:'Kruimige aardappelen',quantity:1,unit:'kilogram'},{name:'Rookworst',quantity:1,unit:'stuk'},{name:'Melk',quantity:100,unit:'ml'},{name:'Mosterd',quantity:1,unit:'potje'}],steps:['Schil de aardappelen en kook met de boerenkool in 25 minuten gaar.','Verwarm de rookworst volgens de verpakking.','Stamp met melk, breng op smaak en serveer met mosterd.']}
];
const CURATED_RECIPES = [...BUILTIN_RECIPES, ...internationalRecipes];
const openRecipes = createOpenRecipes(CURATED_RECIPES);
const RECIPES = [...CURATED_RECIPES, ...openRecipes].sort((a,b)=>a.cuisine.localeCompare(b.cuisine,'nl')||a.name.localeCompare(b.name,'nl'));
const recipeById = id => RECIPES.find(r=>r.id===Number(id));
// Zoeken gebeurt op naam, land, omschrijving en ingrediëntnamen. De zoektekst wordt
// pas gemaakt als er echt gezocht wordt en daarna onthouden, zodat het opstarten en
// het gewone bladeren niets extra kosten.
const zoekTekstCache = new Map();
function zoekTekst(recept){
  let tekst = zoekTekstCache.get(recept.id);
  if(!tekst){
    tekst = [recept.name, recept.cuisine, recept.description||'', ...recept.ingredients.map(i=>i.name)].join(' ').toLowerCase();
    zoekTekstCache.set(recept.id, tekst);
  }
  return tekst;
}
const compactRecept = r => ({id:r.id,name:r.name,cuisine:r.cuisine,description:r.description||'',time:r.time??null,servings:r.servings??null,translatedFrom:r.translatedFrom||null,sourceName:r.source?r.source.name:null,sourceUrl:r.source?r.source.url:null,sourceLicense:r.source?r.source.license:null,sourceLicenseUrl:r.source?r.source.licenseUrl:null});
// Antwoorden worden gecomprimeerd zodra de browser dat aankan: de receptenlijst is
// groot en zonder compressie gaat er tien keer zoveel over de lijn.
function json(res,status,data){
  const tekst=JSON.stringify(data);
  const koppen={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
  const accepteert=res.req&&/\bgzip\b/.test(String(res.req.headers['accept-encoding']||''));
  if(accepteert&&tekst.length>1024){koppen['content-encoding']='gzip';koppen['vary']='accept-encoding';res.writeHead(status,koppen);return res.end(zlib.gzipSync(tekst));}
  res.writeHead(status,koppen);res.end(tekst);
}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>100000)reject(Error('payload too large'));});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch{reject(Error('invalid JSON'));}});});}
function products(){return db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all();}
function shopping(){return db.prepare('SELECT * FROM shopping ORDER BY name COLLATE NOCASE').all();}
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(`${s}T00:00:00.000Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
function validTime(s){return typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);}
// '830' en '8' zijn voor een gebruiker gewone invoer; maak er 08:30 en 08:00 van.
function normaliseerTijd(waarde){const tekst=String(waarde??'').trim();if(!tekst)return '';if(tekst.includes(':')){const [uur,minuten='']=tekst.split(':');if(!/^\d{1,2}$/.test(uur.trim())||!(minuten.trim()===''||/^\d{1,2}$/.test(minuten.trim())))return '';const tijd=`${uur.trim().padStart(2,'0')}:${(minuten.trim()||'0').padStart(2,'0')}`;return validTime(tijd)?tijd:'';}const digits=[...tekst].filter(c=>c>='0'&&c<='9').join('').slice(0,4);if(!digits)return '';if(digits.length<=2)return validTime(`${digits.padStart(2,'0')}:00`)?`${digits.padStart(2,'0')}:00`:`0${digits[0]}:0${digits[1]}`;const tijd=(digits.length===3||Number(digits.slice(0,2))>23)?`0${digits[0]}:${digits.slice(1,3)}`:`${digits.slice(0,2)}:${digits.slice(2)}`;return validTime(tijd)?tijd:'';}
function shiftsForDate(date){return db.prepare('SELECT name,start_time AS startTime,end_time AS endTime,notes FROM work_shifts WHERE plan_date=? ORDER BY id').all(date);}
// Kledingkast hoort bij dezelfde app: de garderoberoutes staan onder /api/kast/ en de
// foto's onder /media/. De module krijgt de bestaande database en fotomap mee.
const wardrobe = createWardrobe({ db, mediaDir: MEDIA_DIR });
// Barcodeherkenning: gescande codes worden opgezocht en lokaal bewaard.
const barcodes = createBarcodes({ db });
// Profielen en sms: huisgenoten met telefoonnummer plus het sms-kanaal waarmee
// de boodschappenlijst verstuurd wordt.
const profiles = createProfiles({ db });
function wardrobePath(url) {
  if (url.pathname.startsWith('/api/kast/')) return new URL(`/api/${url.pathname.slice('/api/kast/'.length)}${url.search}`, 'http://localhost');
  return url;
}
function planWithShifts(plan){return plan?{...plan,shifts:shiftsForDate(plan.plan_date)}:null;}
function plansForMonth(month){return db.prepare('SELECT * FROM planner WHERE plan_date LIKE ? ORDER BY plan_date').all(`${month}-%`).map(planWithShifts);}
function shiftTemplates(){return db.prepare('SELECT id,name,start_time AS startTime,end_time AS endTime,notes FROM shift_templates ORDER BY name COLLATE NOCASE,id').all();}
// Ingrediëntregels uit de open bronnen kunnen lange beschrijvingen bevatten (de langste is
// ruim 300 tekens); daarom is de naamlimiet hier ruimer dan bij zelf ingevoerde producten.
const MAX_SHOPPING_NAME=600; // geïmporteerde bronregels uit het Wikibooks-kookboek lopen op tot 504 tekens; 400 weigerde die regels
function addShoppingItem(item){const name=String(item.name||'').trim(),unit=String(item.unit||'stuks').trim(),quantity=Number(item.quantity??1);if(!name||name.length>MAX_SHOPPING_NAME||!Number.isFinite(quantity)||quantity<=0||quantity>100000||unit.length>24)throw Error('Ongeldig boodschappenproduct.');const old=db.prepare('SELECT id FROM shopping WHERE lower(name)=lower(?) AND lower(unit)=lower(?) ORDER BY id LIMIT 1').get(name,unit);if(old)db.prepare('UPDATE shopping SET quantity=quantity+? WHERE id=?').run(quantity,old.id);else db.prepare('INSERT INTO shopping(name,quantity,unit) VALUES(?,?,?)').run(name,quantity,unit);}

const server=http.createServer(async(req,res)=>{let url;try{url=new URL((req.url||'/').replace(/^\/{2,}/,'/'),'http://localhost');}catch{res.writeHead(400,{'content-type':'text/plain; charset=utf-8'});return res.end('Ongeldig verzoek\n');}try{
 if(url.pathname.startsWith('/api/kast/')||url.pathname.startsWith('/media/'))return wardrobe.handle(req,res,wardrobePath(url));
 if(url.pathname==='/api/products'&&req.method==='GET')return json(res,200,products());
 // Barcode opzoeken: /api/barcode/<code> (optioneel ?force=1 voor een nieuwe opzoeking).
 const barcodeMatch=url.pathname.match(/^\/api\/barcode\/([0-9A-Za-z]{4,20})$/);if(barcodeMatch&&req.method==='GET'){const uitkomst=await barcodes.lookup(barcodeMatch[1],{force:url.searchParams.get('force')==='1'});return json(res,200,uitkomst);}
 if(url.pathname==='/api/barcode'&&req.method==='GET'){const code=url.searchParams.get('code')||'';return json(res,200,await barcodes.lookup(code,{force:url.searchParams.get('force')==='1'}));}
 if(url.pathname==='/api/shopping'&&req.method==='GET')return json(res,200,shopping());
 if(url.pathname==='/api/recipes/landen'&&req.method==='GET'){const telling=new Map();for(const r of RECIPES)telling.set(r.cuisine,(telling.get(r.cuisine)||0)+1);return json(res,200,[...telling].map(([cuisine,aantal])=>({cuisine,aantal})).sort((a,b)=>a.cuisine.localeCompare(b.cuisine,'nl')));}
 if(url.pathname==='/api/recipes'&&req.method==='GET'){
  const country=(url.searchParams.get('country')||url.searchParams.get('land')||'').trim();
  // compact=1 geeft alleen wat de lijst nodig heeft (naam, land, tijd, porties, bron);
  // de ingrediënten en bereiding komen per recept apart opgehaald.
  if(url.searchParams.get('compact')!=='1')return json(res,200,country?RECIPES.filter(r=>r.cuisine===country):RECIPES);
  const q=(url.searchParams.get('q')||'').trim().toLowerCase();
  const vanaf=Math.max(0,Math.trunc(Number(url.searchParams.get('vanaf')||0))||0);
  const aantal=Math.min(200,Math.max(1,Math.trunc(Number(url.searchParams.get('aantal')||48))||48));
  let lijst=country?RECIPES.filter(r=>r.cuisine===country):RECIPES;
  if(q)lijst=lijst.filter(r=>zoekTekst(r).includes(q));
  return json(res,200,{totaal:lijst.length,vanaf,aantal,items:lijst.slice(vanaf,vanaf+aantal).map(compactRecept)});
 }
 const receptMatch=url.pathname.match(/^\/api\/recipes\/(\d+)$/);if(receptMatch&&req.method==='GET'){const recept=recipeById(receptMatch[1]);if(!recept)return json(res,404,{error:'Recept niet gevonden.'});return json(res,200,recept);}
 if(url.pathname==='/api/shift-templates'&&req.method==='GET')return json(res,200,shiftTemplates());
 if(url.pathname==='/api/shift-templates'&&req.method==='POST'){const x=await body(req),name=String(x.name||'').trim(),startTime=String(x.startTime||''),endTime=String(x.endTime||''),notes=String(x.notes||'').trim();if(!name||name.length>80||!validTime(startTime)||!validTime(endTime)||notes.length>200)return json(res,400,{error:'Vul een naam en geldige tijden in 24-uursnotatie (00:00–23:59) in.'});const result=db.prepare('INSERT INTO shift_templates(name,start_time,end_time,notes) VALUES(?,?,?,?)').run(name,startTime,endTime,notes);return json(res,201,db.prepare('SELECT id,name,start_time AS startTime,end_time AS endTime,notes FROM shift_templates WHERE id=?').get(Number(result.lastInsertRowid)));}
 const templateMatch=url.pathname.match(/^\/api\/shift-templates\/(\d+)$/);if(templateMatch&&req.method==='DELETE'){const result=db.prepare('DELETE FROM shift_templates WHERE id=?').run(Number(templateMatch[1]));if(!result.changes)return json(res,404,{error:'Opgeslagen dienst niet gevonden.'});return json(res,200,{ok:true});}
 if(url.pathname==='/api/planner'&&req.method==='GET'){const month=url.searchParams.get('month')||'';if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return json(res,400,{error:'Geef een geldige maand op (YYYY-MM).'});return json(res,200,plansForMonth(month));}
 if(url.pathname==='/api/products'&&req.method==='POST'){const x=await body(req);const name=String(x.name||'').trim();const barcode=String(x.barcode||'').trim()||null;const quantity=Number(x.quantity??1);const unit=String(x.unit||'stuks').trim();const aantal=x.aantal===''||x.aantal==null?1:Math.round(Number(x.aantal));if(!name||name.length>120||!Number.isFinite(quantity)||quantity<=0||quantity>100000||unit.length>24||!Number.isFinite(aantal)||aantal<1||aantal>9999)return json(res,400,{error:'Controleer naam, hoeveelheid, eenheid en het aantal stuks (1–9999).'});try{const result=db.prepare('INSERT INTO products(name,barcode,quantity,unit,aantal) VALUES(?,?,?,?,?) ON CONFLICT(barcode) DO UPDATE SET name=excluded.name, quantity=products.quantity+excluded.quantity, aantal=products.aantal+excluded.aantal, updated_at=CURRENT_TIMESTAMP').run(name,barcode,quantity,unit,aantal);
 // Wat de gebruiker zelf invult onthoudt de app bij die barcode, zodat een volgende scan meteen goed gaat.
 if(barcode)barcodes.onthoud(barcode,{name,quantity:Number.isFinite(quantity)?quantity:null,unit});
 return json(res,201,db.prepare('SELECT * FROM products WHERE id=? OR barcode=?').get(Number(result.lastInsertRowid),barcode));}catch(e){return json(res,409,{error:'Barcode is al gekoppeld aan een ander product.'});}}
 let m=url.pathname.match(/^\/api\/products\/(\d+)$/);if(m&&req.method==='PATCH'){const id=Number(m[1]),x=await body(req);if(x.action==='consume'){const p=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!p)return json(res,404,{error:'Product niet gevonden.'});db.prepare('DELETE FROM products WHERE id=?').run(id);addShoppingItem(p);return json(res,200,{ok:true});}if(x.action==='restore'){const p=db.prepare('SELECT * FROM shopping WHERE id=?').get(id);if(!p)return json(res,404,{error:'Product niet gevonden.'});db.prepare('INSERT INTO products(name,quantity,unit) VALUES(?,?,?)').run(p.name,p.quantity,p.unit);db.prepare('DELETE FROM shopping WHERE id=?').run(id);return json(res,200,{ok:true});}
// Hoeveel stuks je van een product in huis hebt.
if(x.aantal!=null||x.action==='min'||x.action==='plus'){const p=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!p)return json(res,404,{error:'Product niet gevonden.'});const expliciet=x.aantal!=null;const gevraagd=expliciet?Math.round(Number(x.aantal)):p.aantal+(x.action==='plus'?1:-1);if(!Number.isFinite(gevraagd)||gevraagd>9999||(expliciet?gevraagd<1:gevraagd<0))return json(res,400,{error:'Geef een aantal tussen 1 en 9999 op.'});if(gevraagd===0){db.prepare('DELETE FROM products WHERE id=?').run(id);addShoppingItem(p);return json(res,200,{ok:true,op:true,aantal:0});}db.prepare('UPDATE products SET aantal=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(gevraagd,id);return json(res,200,{ok:true,aantal:gevraagd});}}
 m=url.pathname.match(/^\/api\/shopping\/recipes\/(\d+)$/);if(m&&req.method==='POST'){const recipe=recipeById(m[1]);if(!recipe)return json(res,404,{error:'Recept niet gevonden.'});for(const ingredient of recipe.ingredients)addShoppingItem(ingredient);return json(res,201,{ok:true,added:recipe.ingredients.length});}
 m=url.pathname.match(/^\/api\/shopping\/(\d+)$/);if(m&&req.method==='DELETE'){db.prepare('DELETE FROM shopping WHERE id=?').run(Number(m[1]));return json(res,200,{ok:true});}
 if(url.pathname==='/api/shopping'&&req.method==='POST'){const x=await body(req);try{addShoppingItem(x);return json(res,201,{ok:true});}catch(e){return json(res,400,{error:e.message});}}
 m=url.pathname.match(/^\/api\/planner\/(\d{4}-\d{2}-\d{2})$/);if(m&&req.method==='PUT'){const date=m[1],x=await body(req);if(!validDate(date))return json(res,400,{error:'Ongeldige datum.'});const recipeId=x.recipeId===''||x.recipeId==null?null:Number(x.recipeId);if(recipeId!==null&&!recipeById(recipeId))return json(res,400,{error:'Kies een bestaand recept.'});const cuisine=String(x.cuisine||'').trim(),hasShifts=Object.hasOwn(x,'shifts');let shifts;if(hasShifts){if(!Array.isArray(x.shifts)||x.shifts.length>8)return json(res,400,{error:'Voeg maximaal 8 diensten per dag toe.'});shifts=x.shifts.map(s=>({name:String(s?.name||'').trim(),startTime:normaliseerTijd(s?.startTime),endTime:normaliseerTijd(s?.endTime),notes:String(s?.notes||'').trim()}));}else{const startTime=normaliseerTijd(x.workStart),endTime=normaliseerTijd(x.workEnd),workNotes=String(x.workNotes||'').trim();shifts=startTime||endTime||workNotes?[{name:workNotes||'Dienst',startTime,endTime,notes:''}]:[];}if(cuisine.length>80||shifts.some(s=>!s.name||s.name.length>80||!s.startTime||!s.endTime||!validTime(s.startTime)||!validTime(s.endTime)||s.notes.length>200))return json(res,400,{error:'Controleer de dienstnaam, notitie en 24-uurs tijden (00:00–23:59).'});const first=shifts[0]||{startTime:'',endTime:'',notes:'',name:''};try{db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO planner(plan_date,recipe_id,cuisine,work_start,work_end,work_notes) VALUES(?,?,?,?,?,?) ON CONFLICT(plan_date) DO UPDATE SET recipe_id=excluded.recipe_id,cuisine=excluded.cuisine,work_start=excluded.work_start,work_end=excluded.work_end,work_notes=excluded.work_notes').run(date,recipeId,cuisine,first.startTime,first.endTime,hasShifts?first.notes:(String(x.workNotes||'').trim()));db.prepare('DELETE FROM work_shifts WHERE plan_date=?').run(date);const insertShift=db.prepare('INSERT INTO work_shifts(plan_date,name,start_time,end_time,notes) VALUES(?,?,?,?,?)');for(const s of shifts)insertShift.run(date,s.name,s.startTime,s.endTime,s.notes);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return json(res,200,planWithShifts(db.prepare('SELECT * FROM planner WHERE plan_date=?').get(date)));}
 if(m&&req.method==='DELETE'){db.prepare('DELETE FROM work_shifts WHERE plan_date=?').run(m[1]);db.prepare('DELETE FROM planner WHERE plan_date=?').run(m[1]);return json(res,200,{ok:true});}
 // Profielen: huisgenoten met contactgegevens. Het telefoonnummer wordt in
 // internationale notatie opgeslagen (06 12345678 wordt +31612345678).
 if(url.pathname==='/api/profielen'&&req.method==='GET')return json(res,200,profiles.listProfiles());
 if(url.pathname==='/api/profielen'&&req.method==='POST'){try{return json(res,201,profiles.createProfile(await body(req)));}catch(e){return json(res,400,{error:e.message});}}
 m=url.pathname.match(/^\/api\/profielen\/(\d+)$/);
 if(m&&req.method==='PATCH'){try{const profiel=profiles.updateProfile(m[1],await body(req));if(!profiel)return json(res,404,{error:'Profiel niet gevonden.'});return json(res,200,profiel);}catch(e){return json(res,400,{error:e.message});}}
 if(m&&req.method==='DELETE'){return profiles.deleteProfile(m[1])?json(res,200,{ok:true}):json(res,404,{error:'Profiel niet gevonden.'});}
 // Sms-kanaal: instellingen lezen en bewaren. Geheimen komen nooit terug in het
 // antwoord, alleen of ze gevuld zijn.
 if(url.pathname==='/api/instellingen/sms'&&req.method==='GET')return json(res,200,profiles.getSmsSettings());
 if(url.pathname==='/api/instellingen/sms'&&req.method==='PUT'){try{return json(res,200,profiles.saveSmsSettings(await body(req)));}catch(e){return json(res,400,{error:e.message});}}
 if(url.pathname==='/api/sms/log'&&req.method==='GET')return json(res,200,profiles.smsHistory(url.searchParams.get('limit')));
 if(url.pathname==='/api/sms/boodschappen'&&req.method==='POST'){const x=await body(req);try{return json(res,200,await profiles.sendShoppingList({profileId:x.profileId,to:x.to,items:shopping(),notes:x.notes,sender:x.sender}));}catch(e){return json(res,400,{error:e.message});}}
 if(url.pathname==='/api/sms/proef'&&req.method==='POST'){const x=await body(req);try{const uitkomst=await profiles.sendShoppingList({profileId:x.profileId,to:x.to,items:shopping(),notes:'Proefbericht vanuit VoorraadThuis.',sender:'Proefbericht VoorraadThuis'});return json(res,200,{...uitkomst,proef:true});}catch(e){return json(res,400,{error:e.message});}}
 if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{status:'ok'});
 // Eenvoudige tekstcontrole voor de installatie- en updatescripts (de app luistert
 // zelf op poort 80; er zit geen nginx meer voor).
 if(req.method==='GET'&&(url.pathname==='/healthz'||url.pathname==='/healthz/')){res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-cache','x-voorraadthuis':'app'});return res.end('ok\n');}
 if(req.method==='GET'){const rel=url.pathname.slice(1);if(rel&&rel!=='index.html'&&!rel.includes('..')&&/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(rel)){const file=path.join(__dirname,'public',rel),publicDir=path.join(__dirname,'public');if(path.dirname(file).startsWith(publicDir)&&fs.existsSync(file)&&fs.statSync(file).isFile()){const types={'.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};const type=types[path.extname(file)];if(type){res.writeHead(200,{'content-type':type,'cache-control':rel==='sw.js'?'no-cache':'public, max-age=3600'});return fs.createReadStream(file).pipe(res);}}}}
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});return fs.createReadStream(path.join(__dirname,'public','index.html')).pipe(res);}
// Het certificaat van de app zelf, zodat je het op je telefoon kunt installeren en de
// camera (die een beveiligde verbinding eist) zonder waarschuwing werkt.
if(req.method==='GET'&&(url.pathname==='/certificaat.crt'||url.pathname==='/certificaat.pem')){const pad=TLS_CERT();if(!fs.existsSync(pad))return json(res,404,{error:'Er is nog geen certificaat gemaakt.'});res.writeHead(200,{'content-type':'application/x-x509-ca-cert','content-disposition':'attachment; filename="voorraadthuis.crt"','cache-control':'no-cache'});return fs.createReadStream(pad).pipe(res);}
 res.writeHead(404);res.end('Not found');
 }catch(e){json(res,400,{error:e.message||'Fout'});}});
if(require.main===module){
  const host=process.env.HOST||'0.0.0.0',poort=Number(process.env.PORT||3000);
  server.listen(poort,host,()=>console.log(`VoorraadThuis luistert op ${host}:${poort}`));
  // Staat er een certificaat, dan luistert de app ook op https. Dat is nodig voor de
  // camera op een telefoon: browsers geven camera, microfoon en de service worker
  // alleen vrij op een beveiligde verbinding (https of localhost).
  if(fs.existsSync(TLS_CERT())&&fs.existsSync(TLS_KEY())){
    const tlsPoort=Number(process.env.TLS_PORT||443);
    try{
      https.createServer({key:fs.readFileSync(TLS_KEY()),cert:fs.readFileSync(TLS_CERT())},server.listeners('request')[0])
        .listen(tlsPoort,host,()=>console.log(`VoorraadThuis luistert ook op https://${host}:${tlsPoort}`));
    }catch(e){console.error('https kon niet starten:',e.message);}
  }
}
module.exports={server,db,RECIPES};
