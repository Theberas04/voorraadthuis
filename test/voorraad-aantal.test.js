const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voorraadthuis-aantal-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.BARCODE_OFFLINE='';
process.env.HUISMERK_BESTAND=path.join(dir,'geen-huismerken.json');
process.env.WINKELPREFIX_BESTAND=path.join(dir,'geen-prefixen.json');
const {server,db}=require('../server');
let base;
test.before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(dir,{recursive:true,force:true});});
const call=(url,method='GET',data)=>fetch(base+url,{method,headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
const producten=async()=>await(await call('/api/products')).json();
const boodschappen=async()=>await(await call('/api/shopping')).json();

test('aantal stuks invullen en daarna bijstellen met plus en min',async()=>{
  const r=await call('/api/products','POST',{name:'Halfvolle melk',barcode:'8710400058519',quantity:1500,unit:'ml',aantal:3});
  assert.equal(r.status,201);
  const gemaakt=await r.json();
  assert.equal(gemaakt.aantal,3);
  assert.equal((await producten())[0].aantal,3);
  let bij=await call(`/api/products/${gemaakt.id}`,'PATCH',{aantal:7});
  assert.equal(bij.status,200);
  assert.equal((await bij.json()).aantal,7);
  assert.equal((await producten())[0].aantal,7);
  bij=await call(`/api/products/${gemaakt.id}`,'PATCH',{action:'plus'});
  assert.equal((await bij.json()).aantal,8);
  bij=await call(`/api/products/${gemaakt.id}`,'PATCH',{action:'min'});
  assert.equal((await bij.json()).aantal,7);
  assert.equal((await producten())[0].aantal,7);
});

test('hetzelfde product nog eens scannen telt het aantal op',async()=>{
  const eerste=await(await call('/api/products','POST',{name:'Bruine bonen',barcode:'8712345000099',quantity:400,unit:'gram',aantal:2})).json();
  await call('/api/products','POST',{name:'Bruine bonen',barcode:'8712345000099',quantity:400,unit:'gram',aantal:3});
  const alles=(await producten()).filter(x=>x.name==='Bruine bonen');
  assert.equal(alles.length,1);
  assert.equal(alles[0].id,eerste.id);
  assert.equal(alles[0].aantal,5);
  assert.equal(alles[0].quantity,800);
});

test('zonder aantal in huis staat er één stuk',async()=>{
  const p=await(await call('/api/products','POST',{name:'Rijst',quantity:1,unit:'kilogram'})).json();
  assert.equal(p.aantal,1);
  await call(`/api/products/${p.id}`,'DELETE').catch(()=>{});
});

test('het laatste stuk eraf zet het product op de boodschappenlijst',async()=>{
  const p=await(await call('/api/products','POST',{name:'Kwark',quantity:500,unit:'gram',aantal:1})).json();
  const min=await call(`/api/products/${p.id}`,'PATCH',{action:'min'});
  assert.equal(min.status,200);
  assert.equal((await min.json()).op,true);
  assert.equal((await producten()).some(x=>x.id===p.id),false);
  const lijst=await boodschappen();
  assert.ok(lijst.some(x=>x.name==='Kwark'&&x.quantity===500&&x.unit==='gram'));
  await call(`/api/shopping/${lijst.find(x=>x.name==='Kwark').id}`,'DELETE');
});

test('een onmogelijk aantal wordt geweigerd',async()=>{
  for(const aantal of [0,-1,10000,1.5e9,'abc']){
    const r=await call('/api/products','POST',{name:'Onmogelijk',quantity:1,unit:'stuks',aantal});
    assert.equal(r.status,400,`aantal ${aantal} hoort geweigerd te worden`);
  }
  const p=await(await call('/api/products','POST',{name:'Yoghurt',quantity:1,unit:'liter',aantal:2})).json();
  for(const body of [{aantal:0},{aantal:10000},{aantal:'veel'}]){
    const r=await call(`/api/products/${p.id}`,'PATCH',body);
    assert.equal(r.status,400,`bijstellen met ${JSON.stringify(body)} hoort geweigerd te worden`);
  }
  assert.equal((await producten()).find(x=>x.id===p.id).aantal,2);
});

test('de pagina heeft een invulveld voor het aantal en een bediening per product',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  assert.match(html,/id="aantal"/);
  assert.match(html,/Aantal in huis/);
  assert.match(html,/data-aantal=/);
  assert.match(html,/data-plus=/);
  assert.match(html,/data-min=/);
  assert.match(html,/id="countStuks"/);
  assert.match(html,/aantal:\$\('#aantal'\)\.value/);
});
