// Tests voor barcodeherkenning. De productendatabank wordt nagebootst met een lokale stub,
// zodat er geen internet nodig is en we precies kunnen tellen hoe vaak er opgezocht wordt.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voorraadthuis-barcode-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.MEDIA_DIR=path.join(dir,'fotos');
process.env.BARCODE_OFFLINE='';

let stub,server,db,base,opzoekingen=0,storing=false;
// Geldige EAN-13 maken: twaalf cijfers plus het juiste controlecijfer.
const maakEan=(twaalf)=>{let som=0;for(let i=twaalf.length-1,gewicht=3;i>=0;i-=1,gewicht=gewicht===3?1:3)som+=Number(twaalf[i])*gewicht;return twaalf+String((10-(som%10))%10)};
const MELK=maakEan('871234567890');
const ONBEKEND=maakEan('871234567899');
const EIGEN=maakEan('871234567888');

test.before(async()=>{
  stub=http.createServer((req,res)=>{
    opzoekingen+=1;
    if(storing){res.writeHead(503,{'content-type':'application/json'});return res.end('{}')}
    const code=(req.url.match(/product\/(\d+)/)||[])[1]||'';
    res.writeHead(200,{'content-type':'application/json'});
    if(code===ONBEKEND)return res.end(JSON.stringify({status:1}));
    res.end(JSON.stringify({status:1,product:{code,product_name_en:'Semi-skimmed milk',product_name_nl:'Halfvolle melk',brands:'Campina, FrieslandCampina',quantity:'1 l',categories_tags:['en:dairies'],image_front_small_url:'https://example.org/melk.jpg'}}));
  });
  await new Promise(r=>stub.listen(0,'127.0.0.1',r));
  process.env.BARCODE_API=`http://127.0.0.1:${stub.address().port}/api/v2/product/{code}.json`;
  ({server,db}=require('../server'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
  await new Promise(r=>server.close(r));
  await new Promise(r=>stub.close(r));
  db.close();
  fs.rmSync(dir,{recursive:true,force:true});
});
const call=(url,method='GET',data)=>fetch(base+url,{method,headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
const zoekBarcode=(code,extra='')=>call(`/api/barcode/${code}${extra}`).then(r=>r.json());

test('een gescande barcode wordt herkend en daarna uit de eigen opslag gelezen',async()=>{
  const eerste=await zoekBarcode(MELK);
  assert.equal(eerste.found,true);
  assert.equal(eerste.name,'Halfvolle melk');
  assert.equal(eerste.brand,'Campina');
  assert.equal(eerste.quantity,1);
  assert.equal(eerste.unit,'liter');
  assert.equal(eerste.quantityText,'1 l');
  assert.equal(eerste.source,'Open Food Facts');
  assert.equal(eerste.license,'ODbL 1.0');
  assert.equal(eerste.cached,false);
  assert.equal(opzoekingen,1);
  const tweede=await zoekBarcode(MELK);
  assert.equal(tweede.found,true);
  assert.equal(tweede.cached,true);
  assert.equal(opzoekingen,1,'de tweede keer hoort uit de lokale opslag te komen');
  assert.equal(fs.existsSync(path.join(dir,'test.db')),true);
});

test('opnieuw zoeken kan met force',async()=>{
  const voor=opzoekingen;
  const opnieuw=await zoekBarcode(MELK,'?force=1');
  assert.equal(opnieuw.found,true);
  assert.equal(opzoekingen,voor+1);
});

test('een onbekende barcode vraagt om de naam zelf in te vullen',async()=>{
  const uitkomst=await zoekBarcode(ONBEKEND);
  assert.equal(uitkomst.found,false);
  assert.equal(uitkomst.reason,'onbekend');
  assert.match(uitkomst.message,/zelf in/);
});

test('een verkeerd controlecijfer en een te korte code worden geweigerd',async()=>{
  const fout=await zoekBarcode('8712345678901');
  assert.equal(fout.found,false);
  assert.equal(fout.reason,'controlecijfer');
  const kort=await zoekBarcode('871234');
  assert.equal(kort.found,false);
  assert.equal(kort.reason,'ongeldig');
});

test('met force wordt een code met een fout controlecijfer alsnog opgezocht',async()=>{
  const zonder=await zoekBarcode('8712345678900');
  assert.equal(zonder.found,false);
  assert.equal(zonder.reason,'controlecijfer');
  assert.match(zonder.message,/Zoek toch/);
  const met=await zoekBarcode('8712345678900','?force=1');
  assert.equal(met.found,true);
  assert.equal(met.name,'Halfvolle melk');
});

test('een storing bij de databank valt terug op wat al bekend is',async()=>{
  storing=true;
  const bekend=await zoekBarcode(MELK,'?force=1');
  assert.equal(bekend.found,true);
  assert.ok(bekend.warning,'een mislukte opzoeking hoort een waarschuwing mee te geven');
  const onbekend=await zoekBarcode(maakEan('871234567777'));
  assert.equal(onbekend.found,false);
  assert.equal(onbekend.reason,'storing');
  storing=false;
});

test('zonder internet blijft een bekende barcode werken',async()=>{
  const voor=opzoekingen;
  process.env.BARCODE_OFFLINE='1';
  try{
    const bekend=await zoekBarcode(MELK);
    assert.equal(bekend.found,true);
    assert.equal(bekend.name,'Halfvolle melk');
    const onbekend=await zoekBarcode(maakEan('871234567666'));
    assert.equal(onbekend.found,false);
    assert.equal(onbekend.reason,'offline');
    assert.equal(opzoekingen,voor,'offline hoort niets op te zoeken');
  }finally{process.env.BARCODE_OFFLINE=''}
});

test('een zelf ingevoerd product wordt bij die barcode onthouden',async()=>{
  const voor=opzoekingen;
  const response=await call('/api/products','POST',{name:'Huismerk muesli',barcode:EIGEN,quantity:2,unit:'pakken'});
  assert.equal(response.status,201);
  const uitkomst=await zoekBarcode(EIGEN);
  assert.equal(uitkomst.found,true);
  assert.equal(uitkomst.name,'Huismerk muesli');
  assert.equal(uitkomst.quantity,2);
  assert.equal(uitkomst.unit,'pakken');
  assert.equal(uitkomst.source,'eigen invoer');
  assert.equal(opzoekingen,voor,'eigen invoer hoeft niet opgezocht te worden');
});

test('hoeveelheden uit de databank worden naar Nederlandse eenheden omgezet',()=>{
  const {hoeveelheidEnEenheid}=require('../barcodes');
  assert.deepEqual(hoeveelheidEnEenheid('500 g'),{quantity:500,unit:'gram'});
  assert.deepEqual(hoeveelheidEnEenheid('1,5 kg'),{quantity:1.5,unit:'kilogram'});
  assert.deepEqual(hoeveelheidEnEenheid('6 x 33 cl'),{quantity:198,unit:'cl'});
  assert.deepEqual(hoeveelheidEnEenheid('2 stuks'),{quantity:2,unit:'stuks'});
  assert.deepEqual(hoeveelheidEnEenheid('750 ml'),{quantity:750,unit:'ml'});
  assert.deepEqual(hoeveelheidEnEenheid(''),{quantity:null,unit:''});
});

test('de pagina kan scannen en het product meteen herkennen',async()=>{
  const html=await(await call('/')).text();
  assert.match(html,/\/api\/barcode\//);
  assert.match(html,/id="barcodeResult"/);
  assert.match(html,/BarcodeDetector/);
  assert.match(html,/Open Food Facts/);
  assert.match(html,/barcodeAgain/);
  assert.match(html,/scanresult/);
});