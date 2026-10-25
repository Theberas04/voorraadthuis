const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createWeer}=require('../weer');

const ZOEK={results:[{name:'Delft',latitude:52.0,longitude:4.35,country:'Nederland',admin1:'Zuid-Holland'}]};
const VERWACHTING={daily:{time:['2027-01-15'],temperature_2m_max:[4.2],temperature_2m_min:[-1.4],precipitation_probability_max:[80],windspeed_10m_max:[45],weathercode:[61]}};

function omgeving({zoek=ZOEK,verwachting=VERWACHTING,nu,faal=false}={}){
  const db=new DatabaseSync(':memory:');
  const adressen=[];
  const fetchImpl=async(url)=>{
    adressen.push(String(url));
    if(faal)throw Error('geen internet');
    const antwoord=typeof verwachting==='function'?verwachting():verwachting;
    return {ok:true,status:200,json:async()=>(String(url).includes('geocoding')?zoek:antwoord)};
  };
  const weer=createWeer({db,fetchImpl,nu:nu||(()=>new Date('2027-01-15T07:00:00Z'))});
  return {weer,db,adressen,verzoeken:()=>adressen.filter(u=>u.includes('forecast')).length};
}

test('een plaats wordt opgezocht en onthouden',async()=>{
  const {weer,adressen}=omgeving();
  const plaats=await weer.bewaar({plaats:'Delft'});
  assert.equal(plaats.plaats,'Delft');
  assert.equal(plaats.land,'Nederland');
  assert.equal(plaats.lat,52.0);
  assert.equal(plaats.lon,4.35);
  assert.equal(plaats.aan,true);
  assert.ok(adressen[0].startsWith('https://geocoding-api.open-meteo.com/'),'het opzoeken hoort bij de gratis openbare plaatsendienst te gebeuren');
  assert.ok(adressen[0].includes('name=Delft'));
  assert.deepEqual(weer.instellingen(),plaats,'de plaats hoort bewaard te blijven');
  assert.equal(weer.instellingen().aan,true);
});

test('een plaats die niet bestaat wordt met een Nederlandse uitleg geweigerd',async()=>{
  const {weer}=omgeving({zoek:{results:[]}});
  await assert.rejects(()=>weer.bewaar({plaats:'Nergensdorp'}),/kon ik niet vinden/);
  await assert.rejects(()=>weer.bewaar({plaats:''}),/Vul een plaats/);
  assert.equal(weer.instellingen().plaats,'','een mislukte opzoeking laat de oude plaats staan');
});

test('de verwachting van een dag wordt één keer opgehaald en daarna uit de eigen database gehaald',async()=>{
  const {weer,verzoeken,adressen}=omgeving();
  await weer.bewaar({plaats:'Delft'});
  const eerste=await weer.voorDatum('2027-01-15');
  assert.deepEqual(eerste,{datum:'2027-01-15',tempMax:4.2,tempMin:-1.4,regenkans:80,wind:45,code:61,omschrijving:'regen',plaats:'Delft'});
  const tweede=await weer.voorDatum('2027-01-15');
  assert.deepEqual(tweede,eerste);
  assert.equal(verzoeken(),1,'de tweede keer hoort uit de bewaarde verwachting te komen');
  const adres=adressen.find(u=>u.includes('forecast'));
  assert.ok(adres.includes('latitude=52'),'de breedtegraad hoort mee te gaan');
  assert.ok(adres.includes('longitude=4.35'));
  assert.ok(adres.includes('timezone=Europe%2FAmsterdam')||adres.includes('timezone=Europe/Amsterdam'),'de tijdzone hoort mee te gaan, anders valt de dag op de verkeerde datum');
});

test('een verwachting die te oud is wordt opnieuw opgehaald',async()=>{
  let klok=new Date('2027-01-15T06:00:00Z');
  const {weer,verzoeken}=omgeving({nu:()=>klok});
  await weer.bewaar({plaats:'Delft'});
  await weer.voorDatum('2027-01-15');
  assert.equal(verzoeken(),1);
  klok=new Date('2027-01-15T07:00:00Z');
  await weer.voorDatum('2027-01-15');
  assert.equal(verzoeken(),1,'binnen drie uur hoeft het niet opnieuw');
  klok=new Date('2027-01-15T11:00:00Z');
  await weer.voorDatum('2027-01-15');
  assert.equal(verzoeken(),2,'na drie uur haalt de app het weer opnieuw op');
});

test('zonder internet blijft het kledingadvies werken',async()=>{
  const {weer}=omgeving({faal:true});
  await assert.rejects(()=>weer.bewaar({plaats:'Delft'}),/kon ik niet vinden|internet/);
  await weer.bewaar({plaats:'Delft',lat:52,lon:4.35,land:'Nederland'});
  assert.equal(await weer.voorDatum('2027-01-15'),null,'zonder verwachting gaat de app verder zonder weer');
  assert.equal(weer.instellingen().plaats,'Delft');
  assert.deepEqual(weer.advies(null).redenen,[]);
});

test('zonder plaats of met het weer uit wordt er niets opgehaald',async()=>{
  const {weer,verzoeken}=omgeving();
  assert.equal(await weer.voorDatum('2027-01-15'),null);
  await weer.bewaar({plaats:'Delft',lat:52,lon:4.35});
  assert.equal(weer.zetAan(false),false);
  assert.equal(await weer.voorDatum('2027-01-15'),null);
  assert.equal(verzoeken(),0,'met het weer uit hoort er niets opgehaald te worden');
  assert.equal(weer.zetAan(true),true);
  assert.ok(await weer.voorDatum('2027-01-15'));
});

test('weercodes worden in het Nederlands uitgelegd',()=>{
  const {weer}=omgeving();
  assert.equal(weer.omschrijving(0),'onbewolkt');
  assert.equal(weer.omschrijving(3),'bewolkt');
  assert.equal(weer.omschrijving(45),'mist');
  assert.equal(weer.omschrijving(61),'regen');
  assert.equal(weer.omschrijving(71),'sneeuw');
  assert.equal(weer.omschrijving(95),'onweer');
  assert.equal(weer.omschrijving(999),'wisselvallig');
});

test('het weer levert adviesregels op voor kou, regen, wind en warmte',()=>{
  const {weer}=omgeving();
  const koud=weer.advies({tempMax:3,tempMin:-1,regenkans:80,wind:45,omschrijving:'regen'});
  assert.ok(koud.redenen[0].includes('3'),'het advies begint met de temperatuur');
  assert.ok(koud.redenen.some(r=>/regen/i.test(r)),'bij 80% kans op regen hoort er een regenadvies te staan');
  assert.ok(koud.redenen.some(r=>/warme jas/i.test(r)));
  assert.ok(koud.redenen.some(r=>/waait hard/i.test(r)));
  assert.equal(koud.regen,true);
  assert.equal(koud.warm,false);
  const warm=weer.advies({tempMax:26,tempMin:16,regenkans:10,wind:8,omschrijving:'onbewolkt'});
  assert.ok(warm.redenen.some(r=>/licht/i.test(r)));
  assert.ok(warm.redenen.every(r=>!/warme jas/i.test(r)));
  assert.equal(warm.warm,true);
  assert.equal(warm.jasNodig,false);
  const fris=weer.advies({tempMax:11,tempMin:6,regenkans:20,wind:12,omschrijving:'bewolkt'});
  assert.ok(fris.redenen.some(r=>/fris|jas of dikke trui/i.test(r)));
  assert.equal(fris.jasNodig,true);
});

test('de plaats kan ook weer gewist worden',async()=>{
  const {weer}=omgeving();
  await weer.bewaar({plaats:'Delft'});
  assert.equal(weer.instellingen().plaats,'Delft');
  const leeg=weer.wissen();
  assert.equal(leeg.plaats,'');
  assert.equal(leeg.lat,null);
  assert.equal(leeg.aan,true,'het weer uitzetten is iets anders dan de plaats wissen');
  assert.equal(await weer.voorDatum('2027-01-15'),null);
});

