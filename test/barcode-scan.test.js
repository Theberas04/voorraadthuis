const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normaliseer,volgendeLezing}=require('../public/barcode-scan');

test('de scanner accepteert alleen retail-GTINs met een kloppend controlecijfer',()=>{
  assert.equal(normaliseer('4006381333931','ean_13'),'4006381333931');
  assert.equal(normaliseer('96385074','ean_8'),'96385074');
  assert.equal(normaliseer('036000291452','upc_a'),'036000291452');
  assert.equal(normaliseer('4006381333932','ean_13'),null,'fout gelezen controlecijfer geweigerd');
  assert.equal(normaliseer('4006381333931','code_128'),null,'niet-retailformaat geweigerd');
  assert.equal(normaliseer('4006381333931','ean_8'),null,'formaat en codelengte moeten overeenkomen');
});

test('UPC-E wordt naar de canonieke UPC-A-barcode uitgebreid',()=>{
  assert.equal(normaliseer('04252614','upc_e'),'042100005264');
  for(const [upce,upca] of [['01234505','012000003455'],['01234514','012100003454'],['01234523','012200003453'],['01234531','012300000451'],['01234543','012340000053'],['01234558','012345000058'],['01234565','012345000065'],['01234572','012345000072'],['01234589','012345000089'],['01234596','012345000096']])assert.equal(normaliseer(upce,'upc_e'),upca,`UPC-E ${upce}`);
  assert.equal(normaliseer('04252615','upc_e'),null,'UPC-E met een verkeerd controlecijfer wordt geweigerd');
  assert.equal(normaliseer('10012345000017','itf'),'10012345000017','ITF-14 wordt alleen als geldige GTIN-14 geaccepteerd');
});

test('de scanner accepteert pas na drie gelijke, geldige lezingen',()=>{
  let state=volgendeLezing('',0,[{rawValue:'4006381333931',format:'ean_13'}]);
  assert.deepEqual(state,{code:'4006381333931',count:1,accepted:false});
  state=volgendeLezing(state.code,state.count,[{rawValue:'4006381333931',format:'ean_13'}]);
  assert.deepEqual(state,{code:'4006381333931',count:2,accepted:false});
  state=volgendeLezing(state.code,state.count,[{rawValue:'4006381333931',format:'ean_13'}]);
  assert.deepEqual(state,{code:'4006381333931',count:3,accepted:true});
});

test('een afwijkende of ambigue lezing begint opnieuw in plaats van een verkeerde barcode te kiezen',()=>{
  const first=volgendeLezing('',0,[{rawValue:'4006381333931',format:'ean_13'}]);
  assert.deepEqual(volgendeLezing(first.code,first.count,[{rawValue:'036000291452',format:'upc_a'}]),{code:'036000291452',count:1,accepted:false});
  assert.deepEqual(volgendeLezing(first.code,first.count,[
    {rawValue:'4006381333931',format:'ean_13'},
    {rawValue:'036000291452',format:'upc_a'},
  ]),{code:'',count:0,accepted:false});
  assert.deepEqual(volgendeLezing(first.code,first.count,[]),{code:'',count:0,accepted:false});
});
