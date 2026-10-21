// Tests voor huismerken: de lokale huismerktabel (uit Open Food Facts) herkent
// Nederlandse huismerkproducten meteen, en aan de barcode is te zien bij welke
// winkel een nog onbekend huismerk hoort.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voorraadthuis-huismerk-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.MEDIA_DIR=path.join(dir,'fotos');
process.env.BARCODE_OFFLINE='';

const maakEan=(twaalf)=>{let som=0;for(let i=twaalf.length-1,gewicht=3;i>=0;i-=1,gewicht=gewicht===3?1:3)som+=Number(twaalf[i])*gewicht;return twaalf+String((10-(som%10))%10)};
const HUISMERK=maakEan('871040000123');   // staat in de lokale tabel
const ONBEKEND_HUISMERK=maakEan('871040000456'); // niet in de tabel, wel AH-reeks
const VREEMD=maakEan('999999000111');     // geen huismerk
const NETWERK=maakEan('544900000099');    // niet lokaal, wel online
const HUISMERK2=maakEan('871234500999');  // wel in de tabel, maar nog niet in de eigen opslag
const DUBBEL=maakEan('871234500777');    // in de tabel én online te vinden

// Lokale tabellen zoals de app ze meelevert.
fs.writeFileSync(path.join(dir,'nl-huismerken.json'),JSON.stringify({
  [HUISMERK]:{n:'AH Halfvolle melk',m:'AH',h:'1,5 l',t:'nl',k:'en:dairies',w:'albert-heijn'},
  [HUISMERK2]:{n:'Jumbo Griekse yoghurt',m:'Jumbo',h:'500 g',t:'nl',k:'en:yogurts',w:'jumbo'},
  [DUBBEL]:{n:'Jumbo Halfvolle melk',m:'Jumbo',h:'1 l',t:'nl',k:'en:dairies',w:'jumbo'},
}));
fs.writeFileSync(path.join(dir,'winkelprefixen.json'),JSON.stringify({'8710400':'Albert Heijn','8712345':'Jumbo'}));
process.env.HUISMERK_BESTAND=path.join(dir,'nl-huismerken.json');
process.env.WINKELPREFIX_BESTAND=path.join(dir,'winkelprefixen.json');

let stub,server,db,base,opzoekingen=0;
test.before(async()=>{
  stub=http.createServer((req,res)=>{
    opzoekingen+=1;
    const code=(req.url.match(/product\/(\d+)/)||[])[1]||'';
    res.writeHead(200,{'content-type':'application/json'});
    if(code===DUBBEL)return res.end(JSON.stringify({status:1,product:{code,lang:'nl',product_name:'Jumbo Halfvolle melk uit de databank',brands:'Jumbo',quantity:'1 l'}}));
    if(code!==NETWERK)return res.end(JSON.stringify({status:1}));
    res.end(JSON.stringify({status:1,product:{code,lang:'nl',product_name:'Coca-Cola Original',brands:'Coca-Cola',quantity:'330 ml'}}));
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
const zoek=(code,extra='')=>fetch(`${base}/api/barcode/${code}${extra}`).then(r=>r.json());

test('een huismerk uit de lokale tabel wordt meteen herkend, zonder opzoeking',async()=>{
  const voor=opzoekingen;
  const uitkomst=await zoek(HUISMERK);
  assert.equal(uitkomst.found,true);
  assert.equal(uitkomst.name,'AH Halfvolle melk');
  assert.equal(uitkomst.brand,'AH');
  assert.equal(uitkomst.quantity,1.5);
  assert.equal(uitkomst.unit,'liter');
  assert.equal(uitkomst.quantityText,'1,5 l');
  assert.equal(uitkomst.huismerk,true);
  assert.equal(uitkomst.winkel,'albert-heijn');
  assert.equal(opzoekingen,voor,'de lokale tabel hoort geen internetopzoeking te doen');
});

test('de huismerktabel blijft ook werken als de databank onbereikbaar is',async()=>{
  process.env.BARCODE_OFFLINE='1';
  try{
    const uitkomst=await zoek(HUISMERK);
    assert.equal(uitkomst.found,true);
    assert.equal(uitkomst.name,'AH Halfvolle melk');
  }finally{process.env.BARCODE_OFFLINE=''}
});

test('een onbekend huismerk verwijst naar de winkel en stelt het merk voor',async()=>{
  const uitkomst=await zoek(ONBEKEND_HUISMERK);
  assert.equal(uitkomst.found,false);
  assert.equal(uitkomst.reason,'onbekend');
  assert.equal(uitkomst.suggestedBrand,'Albert Heijn');
  assert.match(uitkomst.message,/Albert Heijn/);
  assert.match(uitkomst.message,/huismerk/i);
});

test('een barcode zonder huismerkprefix krijgt geen winkelsuggestie',async()=>{
  const uitkomst=await zoek(VREEMD);
  assert.equal(uitkomst.found,false);
  assert.equal(uitkomst.suggestedBrand,'');
  assert.doesNotMatch(uitkomst.message,/Albert Heijn/);
  assert.doesNotMatch(uitkomst.message,/huismerk van/);
});

test('producten die niet in de tabel staan worden gewoon online opgezocht',async()=>{
  const voor=opzoekingen;
  const uitkomst=await zoek(NETWERK);
  assert.equal(uitkomst.found,true);
  assert.equal(uitkomst.name,'Coca-Cola Original');
  assert.equal(opzoekingen,voor+1);
  const tweede=await zoek(NETWERK);
  assert.equal(tweede.cached,true);
  assert.equal(opzoekingen,voor+1,'de tweede keer komt uit de eigen opslag');
});

test('de huismerktabel gaat boven een eerder bewaarde opzoeking',async()=>{
  // Zonder tabel wordt dit product online opgezocht en bewaard.
  process.env.HUISMERK_TABEL='0';
  let uitkomst;
  try{
    uitkomst=await zoek(DUBBEL,'?force=1');
    assert.equal(uitkomst.name,'Jumbo Halfvolle melk uit de databank');
  }finally{process.env.HUISMERK_TABEL=''}
  // Met tabel hoort het product uit de tabel te komen, mét huismerk en winkel.
  uitkomst=await zoek(DUBBEL);
  assert.equal(uitkomst.name,'Jumbo Halfvolle melk');
  assert.equal(uitkomst.huismerk,true);
  assert.equal(uitkomst.winkel,'jumbo');
  assert.equal(uitkomst.cached,false);
});

test('de huismerktabel kan worden uitgezet',async()=>{
  process.env.HUISMERK_TABEL='0';
  try{
    const uitkomst=await zoek(HUISMERK2,'?force=1');
    assert.equal(uitkomst.found,false,'zonder tabel is dit huismerk online onbekend');
    assert.equal(uitkomst.reason,'onbekend');
    assert.equal(uitkomst.suggestedBrand,'Jumbo','het barcodepatroon blijft wel naar de winkel wijzen');
  }finally{process.env.HUISMERK_TABEL=''}
});
