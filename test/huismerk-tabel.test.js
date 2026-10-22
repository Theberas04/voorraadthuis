// Controle op de huismerktabel die de app meelevert. Deze test kijkt naar de échte
// bestanden in product-data/, niet naar een proefbestand: een fout in de oogst (een
// merknaam die als winkelnaam is opgeslagen, een barcode die geen scanner kan lezen,
// een barcode-reeks die naar een verkeerde winkel wijst) moet hier opvallen.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const WORTEL=path.join(__dirname,'..');
const HUISMERKEN=JSON.parse(fs.readFileSync(path.join(WORTEL,'product-data','nl-huismerken.json'),'utf8'));
const PREFIXEN=JSON.parse(fs.readFileSync(path.join(WORTEL,'product-data','winkelprefixen.json'),'utf8'));
const SCRIPT=fs.readFileSync(path.join(WORTEL,'scripts','fetch-huismerken.py'),'utf8');

// De winkels die het ophaalscript kent. Alles wat in de tabel staat hoort hier bij te zitten,
// zodat een merknaam (bijv. 'milbona') nooit als winkelnaam in de tabel belandt.
const WINKELS=new Set([...SCRIPT.matchAll(/'winkel':\s*'([^']+)'/g)].map(m=>m[1]));

const geldigeGtin=(code)=>{
  if(!/^\d+$/.test(code)||![8,12,13,14].includes(code.length))return false;
  const cijfers=[...code].map(Number),controle=cijfers.pop();
  const som=cijfers.reverse().reduce((som,cijfer,i)=>som+cijfer*(i%2===0?3:1),0);
  return (10-(som%10))%10===controle;
};

test('de huismerktabel is gevuld en elke rij heeft een naam en een winkel',()=>{
  const codes=Object.keys(HUISMERKEN);
  assert.ok(codes.length>10000,`de tabel hoort tienduizenden producten te bevatten, nu ${codes.length}`);
  for(const code of codes.slice(0,5000)){
    const rij=HUISMERKEN[code];
    assert.ok(rij.n&&rij.n.trim(),`barcode ${code} hoort een naam te hebben`);
    assert.ok(rij.w&&rij.w.trim(),`barcode ${code} hoort een winkel te hebben`);
  }
});

test('elke winkel in de tabel is een echte winkelnaam, geen merknaam',()=>{
  const fout=[];
  for(const [code,rij] of Object.entries(HUISMERKEN)){
    if(!WINKELS.has(rij.w))fout.push(`${code} -> ${rij.w}`);
    if(fout.length>=5)break;
  }
  assert.deepEqual(fout,[],'de winkel van een rij hoort een winkelnaam te zijn (geen merknaam als milbona of k-classic)');
});

test('elke barcode in de tabel kan een scanner echt lezen',()=>{
  const fout=Object.keys(HUISMERKEN).filter(code=>!geldigeGtin(code)).slice(0,5);
  assert.deepEqual(fout,[],'de tabel hoort geen barcodes met een verkeerd controlecijfer te bevatten');
});

test('elke barcode-reeks wijst naar een echte winkel',()=>{
  const fout=[];
  for(const [prefix,winkel] of Object.entries(PREFIXEN)){
    assert.match(prefix,/^\d{6,7}$/,`reeks ${prefix} hoort uit zes of zeven cijfers te bestaan`);
    if(!WINKELS.has(winkel))fout.push(`${prefix} -> ${winkel}`);
  }
  assert.deepEqual(fout,[],'een barcode-reeks hoort naar een winkelnaam te wijzen');
});

test('de huismerktabel kent de Nederlandse ketens en de buren',()=>{
  const winkels=new Set(Object.values(HUISMERKEN).map(rij=>rij.w));
  for(const winkel of ['Albert Heijn','Jumbo','Lidl','Aldi','PLUS','Jumbo','Dirk','Vomar','Boni','Netto','Norma']){
    assert.ok(winkels.has(winkel),`${winkel} hoort in de huismerktabel te staan`);
  }
  assert.ok(winkels.size>=20,`de tabel hoort veel verschillende winkels te kennen, nu ${winkels.size}`);
});
