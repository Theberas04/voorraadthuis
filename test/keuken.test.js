const {test}=require('node:test');
const assert=require('node:assert/strict');
const k=require('../keuken');

test('productnamen en ingrediënten worden tot vergelijkbare woorden teruggebracht',()=>{
  assert.equal(k.normaliseer('Rode  Paprika’s!'),'rode paprikas');
  assert.equal(k.normaliseer('Crème fraîche'),'creme fraiche');
  assert.deepEqual([...k.woorden('Halfvolle melk')],['halfvolle','melk']);
});

test('een ingrediënt is in huis als het woord in de voorraad voorkomt',()=>{
  const index=k.bouwVoorraadIndex([{name:'Melk',unit:'pakken'},{name:'Tomaten',unit:'stuks'},{name:'Eieren',unit:'stuks'},{name:'Ui',unit:'stuks'}]);
  assert.ok(k.ingredientInHuis('melk',index));
  assert.ok(k.ingredientInHuis('Halfvolle melk',index),'een langere naam hoort te matchen op het woord');
  assert.ok(k.ingredientInHuis('Cherrytomaten',index),'samengestelde namen matchen op het deel');
  assert.ok(k.ingredientInHuis('tomatenblokjes',index));
  assert.ok(k.ingredientInHuis('eieren',index));
  assert.ok(k.ingredientInHuis('ei',index),'enkelvoud en meervoud horen bij elkaar');
  assert.ok(k.ingredientInHuis('uien',index));
  assert.equal(k.ingredientInHuis('kokosmelk',index),false,'melk is geen kokosmelk');
  assert.equal(k.ingredientInHuis('fruit',index),false,'korte woorden mogen niet middenin een ander woord passen');
  assert.equal(k.ingredientInHuis('bloemkool',index),false);
});

test('basisingrediënten zoals zout en water tellen niet als ontbrekend',()=>{
  assert.ok(k.isBasisIngrediënt('zout'));
  assert.ok(k.isBasisIngrediënt('versgemalen zwarte peper'));
  assert.ok(k.isBasisIngrediënt('olijfolie'));
  assert.equal(k.isBasisIngrediënt('zoutvlees'),false,'een woord dat met zout begint is niet automatisch basis');
  const index=k.bouwVoorraadIndex([{name:'Pasta'}]);
  const uitkomst=k.ontbrekendVoorRecept({ingredients:[{name:'Pasta',quantity:350,unit:'gram'},{name:'Zout',quantity:1,unit:'snufje'},{name:'Basilicum',quantity:1,unit:'bosje'}]},index);
  assert.deepEqual(uitkomst.ontbreekt,['Basilicum']);
  assert.deepEqual(uitkomst.basis,['Zout']);
  assert.equal(uitkomst.aanwezig,1);
  assert.equal(uitkomst.klaar,false);
  assert.equal(k.ontbrekendVoorRecept({ingredients:[{name:'Pasta',quantity:1,unit:'pak'},{name:'Zout',quantity:1,unit:'snufje'}]},index).klaar,true);
});

test('eenheden worden in één vaste vorm gezet, met de omrekenfactor erbij',()=>{
  assert.deepEqual(k.normaliseerEenheid('g'),{eenheid:'gram',factor:1});
  assert.deepEqual(k.normaliseerEenheid('grammen'),{eenheid:'gram',factor:1});
  assert.deepEqual(k.normaliseerEenheid('kg'),{eenheid:'gram',factor:1000});
  assert.deepEqual(k.normaliseerEenheid('kilogram'),{eenheid:'gram',factor:1000});
  assert.deepEqual(k.normaliseerEenheid('ml'),{eenheid:'milliliter',factor:1});
  assert.deepEqual(k.normaliseerEenheid('liter'),{eenheid:'milliliter',factor:1000});
  assert.deepEqual(k.normaliseerEenheid('stuks'),{eenheid:'stuks',factor:1});
  assert.deepEqual(k.normaliseerEenheid('stuk'),{eenheid:'stuks',factor:1});
  assert.deepEqual(k.normaliseerEenheid('eetlepels'),{eenheid:'eetlepel',factor:1});
  assert.deepEqual(k.normaliseerEenheid('blikken'),{eenheid:'blik',factor:1});
  assert.deepEqual(k.normaliseerEenheid('pakken'),{eenheid:'pak',factor:1});
  assert.deepEqual(k.normaliseerEenheid('bosjes'),{eenheid:'bos',factor:1});
  assert.deepEqual(k.normaliseerEenheid('bronregel'),{eenheid:'bronregel',factor:1});
  assert.deepEqual(k.normaliseerEenheid(''),{eenheid:'stuks',factor:1});
});

test('hoeveelheden worden leesbaar afgerond bij het omrekenen van porties',()=>{
  assert.equal(k.schaalHoeveelheid(350,0.5),175);
  assert.equal(k.schaalHoeveelheid(1,1.5),1.5);
  assert.equal(k.schaalHoeveelheid(0.5,3),1.5);
  assert.equal(k.schaalHoeveelheid(3,1/3),1);
  assert.equal(k.schaalHoeveelheid(1,1/3),0.3);
});

test('ingrediënten rekenen mee naar het aantal porties dat je kiest',()=>{
  const ingredients=[{name:'Pasta',quantity:350,unit:'gram'},{name:'Pesto',quantity:1,unit:'potje'},{name:'Parmezaan',quantity:60,unit:'gram'}];
  const voor2=k.schaalIngredienten(ingredients,2,4);
  assert.deepEqual(voor2.map(i=>i.quantity),[175,0.5,30]);
  assert.deepEqual(voor2.map(i=>i.unit),['gram','potje','gram']);
  const voor6=k.schaalIngredienten(ingredients,6,4);
  assert.deepEqual(voor6.map(i=>i.quantity),[525,1.5,90]);
  assert.deepEqual(k.schaalIngredienten(ingredients,4,4).map(i=>i.quantity),[350,1,60],'zonder wijziging blijft alles staan');
  assert.deepEqual(k.schaalIngredienten(ingredients,null,null).map(i=>i.quantity),[350,1,60],'zonder porties blijven de bronhoeveelheden staan');
});

test('de boodschappen van een week worden samengevoegd tot één regel per product',()=>{
  const samen=k.voegBoodschappenSamen([
    {name:'Tomaten',quantity:400,unit:'gram'},{name:'tomaten',quantity:250,unit:'g'},
    {name:'Melk',quantity:1,unit:'liter'},{name:'Melk',quantity:500,unit:'ml'},
    {name:'Ui',quantity:2,unit:'stuks'},{name:'Kokosmelk',quantity:1,unit:'blik'}
  ]);
  assert.deepEqual(samen.map(r=>[r.name,r.quantity,r.unit]),[
    ['Tomaten',650,'gram'],
    ['Melk',1.5,'liter'],
    ['Ui',2,'stuks'],
    ['Kokosmelk',1,'blik']
  ]);
  assert.equal(k.voegBoodschappenSamen([]).length,0);
});

test('eenheden met een andere grootte blijven gescheiden in de lijst',()=>{
  const samen=k.voegBoodschappenSamen([{name:'Kwark',quantity:500,unit:'gram'},{name:'Kwark',quantity:2,unit:'stuks'}]);
  assert.equal(samen.length,2);
});

test('de stappen noemen hun eigen tijden, zodat de kookmodus een timer kan zetten',()=>{
  assert.deepEqual(k.parseStapTimers('Laat 12 minuten pruttelen.'),[720]);
  assert.deepEqual(k.parseStapTimers('Bak 3-4 minuten tot ze bruin zijn.'),[180,240]);
  assert.deepEqual(k.parseStapTimers('Zet het 1 uur in de oven.'),[3600]);
  assert.deepEqual(k.parseStapTimers('Kook de pasta 8 tot 10 min beetgaar.'),[480,600]);
  assert.deepEqual(k.parseStapTimers('Roer alles door elkaar.'),[]);
  assert.deepEqual(k.parseStapTimers('Laat 30 seconden staan.'),[30]);
  assert.deepEqual(k.parseStapTimers('Laat een nacht rusten.'),[]);
});

test('producten die je per stuk koopt blijven hele aantallen',()=>{
  const uit=k.schaalIngredienten([{name:'Eieren',quantity:4,unit:'stuks'},{name:'Pesto',quantity:1,unit:'potje'},{name:'Olijfolie',quantity:1,unit:'eetlepel'}],2,3);
  assert.equal(uit[0].quantity,3,'vier eieren voor drie personen wordt voor twee personen drie eieren, geen 2,7');
  assert.equal(uit[1].quantity,0.7,'een half potje mag wel een deel zijn');
  assert.equal(uit[2].quantity,0.7);
});

test('een samengevoegde regel onthoudt waar hij vandaan komt',()=>{
  const samen=k.voegBoodschappenSamen([
    {name:'Pasta',quantity:175,unit:'gram',uit:{datum:'2027-03-01',name:'Pasta pesto'}},
    {name:'Pasta',quantity:350,unit:'gram',uit:{datum:'2027-03-02',name:'Pasta pesto'}}
  ]);
  assert.equal(samen.length,1);
  assert.equal(samen[0].quantity,525);
  assert.equal(samen[0].uit.length,2);
  assert.deepEqual(samen[0].uit.map(u=>u.datum),['2027-03-01','2027-03-02']);
});
