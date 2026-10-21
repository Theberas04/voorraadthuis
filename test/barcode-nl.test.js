// Tests voor Nederlandse producten bij de barcodeherkenning: meerdere databanken,
// opnieuw proberen bij drukte, de Nederlandse naam eerst en een taalhint als de
// databank alleen een buitenlandse naam heeft.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voorraadthuis-barcode-nl-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.MEDIA_DIR=path.join(dir,'fotos');
process.env.BARCODE_OFFLINE='';

const maakEan=(twaalf)=>{let som=0;for(let i=twaalf.length-1,gewicht=3;i>=0;i-=1,gewicht=gewicht===3?1:3)som+=Number(twaalf[i])*gewicht;return twaalf+String((10-(som%10))%10)};
const VOEDING=maakEan('871234500001');
const SCHOONMAAK=maakEan('871234500002');
const ENGELS=maakEan('871234500003');
const ZONDER_NAAM=maakEan('871234500004');
const DRUK=maakEan('871234500005');

let eerste, tweede, server, db, base;
const gevraagd=[]; // elke opzoeking die bij een stub binnenkomt
let drukteTeller=0;

const stub=(naam, antwoord)=>(req,res)=>{
  gevraagd.push({naam,url:req.url});
  const code=(req.url.match(/product\/(\d+)/)||[])[1]||'';
  const uit=antwoord(code,req);
  if(uit&&uit.__status){res.writeHead(uit.__status,{'content-type':'application/json'});return res.end('{}')}
  if(uit===null){res.writeHead(404,{'content-type':'application/json'});return res.end('{"status":0}')}
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify(uit));
};

test.before(async()=>{
  // Eerste databank (voeding): kent alleen het voedselproduct.
  eerste=http.createServer(stub('voeding',(code)=>{
    if(code===VOEDING)return{status:1,product:{code,lang:'nl',product_name:'Halfvolle melk',product_name_nl:'Halfvolle melk',product_name_en:'Semi-skimmed milk',brands:'Campina',quantity:'1 l',categories_tags:['en:dairies']}};
    if(code===ENGELS)return{status:1,product:{code,lang:'en',product_name:'Semi-skimmed milk',product_name_nl:'',brands:'Campina',quantity:'1 l',categories_tags:['en:dairies']}};
    if(code===ZONDER_NAAM)return{status:1,product:{code,lang:'nl',product_name:'',product_name_nl:'',brands:'Calvé',quantity:'350 g',categories_tags:['en:plant-based-foods','en:peanut-butters']}};
    if(code===DRUK){
      drukteTeller+=1;
      if(drukteTeller===1)return{__status:429};
      return{status:1,product:{code,lang:'nl',product_name:'Vaatwastabletten',product_name_nl:'Vaatwastabletten',brands:'Sun',quantity:'40 stuks',categories_tags:['en:dishwasher-products']}};
    }
    return null;
  }));
  await new Promise(r=>eerste.listen(0,'127.0.0.1',r));
  // Tweede databank (huishouden): kent het schoonmaakproduct.
  tweede=http.createServer(stub('huishouden',(code)=>code===SCHOONMAAK?{status:1,product:{code,lang:'nl',product_name:'',product_name_nl:'Sun All-in-one citroen vaatwastabletten',brands:'Sun',quantity:'40 stuks',categories_tags:['en:dishwasher-products']}}:null));
  await new Promise(r=>tweede.listen(0,'127.0.0.1',r));
  process.env.BARCODE_DATABANKEN=`Open Food Facts=http://127.0.0.1:${eerste.address().port},Open Products Facts=http://127.0.0.1:${tweede.address().port}`;
  ({server,db}=require('../server'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
  await new Promise(r=>server.close(r));
  await new Promise(r=>eerste.close(r));
  await new Promise(r=>tweede.close(r));
  db.close();
  fs.rmSync(dir,{recursive:true,force:true});
});
const zoek=(code,extra='')=>fetch(`${base}/api/barcode/${code}${extra}`).then(r=>r.json());

test('de Nederlandse velden en de Nederlandse taal worden opgevraagd',async()=>{
  gevraagd.length=0;
  const uitkomst=await zoek(VOEDING);
  assert.equal(uitkomst.found,true);
  assert.equal(uitkomst.name,'Halfvolle melk','de Nederlandse naam hoort voor te gaan');
  assert.equal(uitkomst.nameLanguage,'nl');
  assert.equal(uitkomst.source,'Open Food Facts');
  const adres=gevraagd[0].url;
  assert.match(adres,/product_name_nl/,'de Nederlandse naamvelden horen opgevraagd te worden');
  assert.match(adres,/lc=nl/,'de databank hoort om Nederlandse gegevens gevraagd te worden');
  assert.match(adres,/fields=/);
});

test('een Nederlands huishoudproduct komt uit de tweede databank',async()=>{
  gevraagd.length=0;
  const uitkomst=await zoek(SCHOONMAAK);
  assert.equal(uitkomst.found,true);
  assert.equal(uitkomst.name,'Sun All-in-one citroen vaatwastabletten');
  assert.equal(uitkomst.quantity,40);
  assert.equal(uitkomst.unit,'stuks');
  assert.equal(uitkomst.source,'Open Products Facts');
  assert.deepEqual(gevraagd.map(g=>g.naam),['voeding','huishouden'],'eerst voeding, dan huishouden');
});

test('een buitenlandse naam krijgt de taal erbij te zien',async()=>{
  const uitkomst=await zoek(ENGELS);
  assert.equal(uitkomst.found,true);
  assert.equal(uitkomst.name,'Semi-skimmed milk');
  assert.equal(uitkomst.nameLanguage,'en');
  assert.equal(uitkomst.nameLanguageName,'Engels');
});

test('zonder naam in de databank maakt de app een Nederlandse aanduiding',async()=>{
  const uitkomst=await zoek(ZONDER_NAAM);
  assert.equal(uitkomst.found,true);
  assert.equal(uitkomst.name,'Calvé pindakaas');
  assert.equal(uitkomst.nameLanguage,'nl');
});

test('bij drukte probeert de app het opnieuw',async()=>{
  drukteTeller=0;
  const uitkomst=await zoek(DRUK,'?force=1');
  assert.equal(uitkomst.found,true);
  assert.equal(drukteTeller,2,'de tweede poging hoort te slagen');
});
