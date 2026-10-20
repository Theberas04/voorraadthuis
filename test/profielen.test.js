const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const sqlite3=require('node:sqlite');

const {createProfiles,normalizePhone,prettyPhone,buildShoppingMessage}=require('../profiles');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'profielen-'));
const db=new sqlite3.DatabaseSync(path.join(dir,'profielen.db'));
const profiles=createProfiles({db});
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});

const boodschappen=[{name:'Melk',quantity:2,unit:'pakken'},{name:'Brood',quantity:1,unit:'stuks'},{name:'Zout',quantity:1,unit:'niet vermeld'},{name:'2–4 cups rice',quantity:1,unit:'bronregel'}];

test('telefoonnummers worden naar internationale notatie gebracht',()=>{
  assert.equal(normalizePhone('06 12345678'),'+31612345678');
  assert.equal(normalizePhone('0612345678'),'+31612345678');
  assert.equal(normalizePhone('+31 6 12345678'),'+31612345678');
  assert.equal(normalizePhone('0031612345678'),'+31612345678');
  assert.equal(normalizePhone('020 1234567'),'+31201234567');
  assert.equal(normalizePhone(''),'');
  for(const ongeldig of ['123','06-abc','+31 6 12','00000000000000000000'])assert.throws(()=>normalizePhone(ongeldig),/geldig telefoonnummer|te lang/);
  assert.equal(prettyPhone('+31612345678'),'+31 6 1234 5678');
  assert.equal(prettyPhone('+31201234567'),'+31 20 123 4567');
});

test('profielen worden aangemaakt, gewijzigd en verwijderd',()=>{
  const tom=profiles.createProfile({name:'  Tom  ',phone:'06 12345678',role:'boodschappen',email:'tom@voorbeeld.nl',notes:'Houdt van pasta',smsRecipient:true});
  assert.equal(tom.name,'Tom');
  assert.equal(tom.phone,'+31612345678');
  assert.equal(tom.smsRecipient,true);
  const partner=profiles.createProfile({name:'Sanne',phone:'+31 6 87654321'});
  assert.equal(partner.smsRecipient,false);
  const lijst=profiles.listProfiles();
  assert.equal(lijst.length,2);
  assert.equal(lijst[0].name,'Tom','de standaardontvanger staat bovenaan');
  const gewijzigd=profiles.updateProfile(partner.id,{name:'Sanne',phone:'0612345678',role:'koken',smsRecipient:true});
  assert.equal(gewijzigd.phone,'+31612345678');
  assert.equal(profiles.getProfile(tom.id).smsRecipient,false,'er is maar één standaardontvanger');
  assert.equal(profiles.deleteProfile(partner.id),true);
  assert.equal(profiles.deleteProfile(partner.id),false);
  assert.equal(profiles.listProfiles().length,1);
});

test('profielen weigeren onvolledige of ongeldige gegevens',()=>{
  assert.throws(()=>profiles.createProfile({name:''}),/Vul een naam in/);
  assert.throws(()=>profiles.createProfile({name:'Kees',phone:'abc'}),/geldig telefoonnummer/);
  assert.throws(()=>profiles.createProfile({name:'Kees',email:'geen-mail'}),/e-mailadres/);
  assert.throws(()=>profiles.createProfile({name:'Kees',smsRecipient:true}),/telefoonnummer/);
  assert.equal(profiles.getProfile(999),undefined);
  assert.equal(profiles.updateProfile(999,{name:'Niemand'}),null);
});

test('het bericht bevat de hele boodschappenlijst',()=>{
  const tekst=buildShoppingMessage(boodschappen,{sender:'Boodschappenlijst',profileName:'Tom',notes:'Morgen voor 18:00'});
  assert.match(tekst,/^Boodschappenlijst voor Tom:/);
  assert.match(tekst,/- Melk \(2 pakken\)/);
  assert.match(tekst,/- Brood \(1 stuks\)/);
  assert.match(tekst,/- Zout$/m,'een onbekende hoeveelheid laat geen lege haakjes achter');
  assert.match(tekst,/- 2–4 cups rice$/m,'een bronregel gaat letterlijk mee');
  assert.match(tekst,/Morgen voor 18:00$/);
  const leeg=buildShoppingMessage([],{sender:'Lijst'});
  assert.equal(leeg,'Lijst:');
});

test('het sms-kanaal wordt bewaard zonder geheimen terug te geven',()=>{
  const begin=profiles.getSmsSettings();
  assert.equal(begin.provider,'link');
  assert.deepEqual(begin.providers.map(p=>p.id),['link','webhook','twilio']);
  assert.throws(()=>profiles.saveSmsSettings({provider:'rooksignalen'}),/geldig sms-kanaal/);
  // Een kanaal kiezen mag ook als het nog niet is ingevuld; de app meldt dan wat er mist.
  const onvolledig=profiles.saveSmsSettings({provider:'webhook'});
  assert.equal(onvolledig.provider,'webhook');
  assert.equal(onvolledig.canSend,false);
  assert.equal(onvolledig.providerHint,'Vul eerst de webhook-URL in.');
  const bewaard=profiles.saveSmsSettings({provider:'twilio',twilioSid:'AC1234567890abcd',twilioToken:'geheim-token-1234',twilioFrom:'06 12345678',sender:'Boodschappen'});
  assert.equal(bewaard.provider,'twilio');
  assert.equal(bewaard.twilioSidSet,true);
  assert.equal(bewaard.twilioTokenSet,true);
  assert.equal(bewaard.twilioSidMask,'••••abcd');
  assert.equal(Object.hasOwn(bewaard,'twilioToken'),false,'het token mag niet in het antwoord staan');
  assert.equal(JSON.stringify(bewaard).includes('geheim-token-1234'),false);
  assert.equal(bewaard.canSend,true);
  assert.equal(bewaard.providerHint,'');
  // Een leeg veld laat de bewaarde waarde staan; wissen gaat met clear.
  const nogSteeds=profiles.saveSmsSettings({provider:'twilio',twilioToken:''});
  assert.equal(nogSteeds.twilioTokenSet,true);
  const gewist=profiles.saveSmsSettings({provider:'webhook',webhookUrl:'https://voorbeeld.nl/sms',clear:['sms.twilioToken']});
  assert.equal(gewist.twilioTokenSet,false);
  assert.equal(gewist.webhookUrl,'https://voorbeeld.nl/sms');
  assert.equal(gewist.canSend,true);
  assert.throws(()=>profiles.saveSmsSettings({provider:'webhook',webhookUrl:'niet-een-url'}),/http/);
});

test('zonder eigen kanaal levert de knop een sms-koppeling met het profielnummer',async()=>{
  profiles.saveSmsSettings({provider:'link',clear:['sms.webhookUrl','sms.twilioSid','sms.twilioToken']});
  const tom=profiles.listProfiles()[0];
  const uitkomst=await profiles.sendShoppingList({profileId:tom.id,items:boodschappen});
  assert.equal(uitkomst.sent,false);
  assert.equal(uitkomst.provider,'link');
  assert.equal(uitkomst.to,'+31612345678');
  assert.match(uitkomst.link,/^sms:\+31612345678\?&body=/);
  assert.equal(decodeURIComponent(uitkomst.link.split('body=')[1]),uitkomst.body);
  assert.match(uitkomst.body,/- Melk \(2 pakken\)/);
  const logboek=profiles.smsHistory(5);
  assert.equal(logboek[0].recipient,'+31612345678');
  assert.equal(logboek[0].status,'koppeling');
});

test('een eigen gateway ontvangt het bericht echt',async()=>{
  const ontvangen=[];
  const gateway=http.createServer((req,res)=>{let data='';req.on('data',c=>data+=c);req.on('end',()=>{ontvangen.push({auth:req.headers.authorization,body:JSON.parse(data||'{}')});res.writeHead(202,{'content-type':'application/json'});res.end('{}');});});
  await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${gateway.address().port}/sms`;
  const tom=profiles.listProfiles()[0];
  try{
    profiles.saveSmsSettings({provider:'webhook',webhookUrl:url,webhookToken:'gateway-token',from:'VoorraadThuis'});
    const uitkomst=await profiles.sendShoppingList({profileId:tom.id,items:boodschappen});
    assert.equal(uitkomst.sent,true);
    assert.equal(uitkomst.provider,'webhook');
    assert.equal(ontvangen.length,1);
    assert.equal(ontvangen[0].auth,'Bearer gateway-token');
    assert.equal(ontvangen[0].body.to,'+31612345678');
    assert.equal(ontvangen[0].body.from,'VoorraadThuis');
    assert.match(ontvangen[0].body.body,/- Brood \(1 stuks\)/);
    assert.equal(profiles.smsHistory(1)[0].status,'verzonden');
  }finally{
    await new Promise(r=>gateway.close(r));
  }
});

test('een weigerende gateway en een ontbrekend nummer geven een nette foutmelding',async()=>{
  const kapot=http.createServer((req,res)=>{res.writeHead(500);res.end('nee');});
  await new Promise(r=>kapot.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${kapot.address().port}/sms`;
  try{
    profiles.saveSmsSettings({provider:'webhook',webhookUrl:url});
    await assert.rejects(()=>profiles.sendShoppingList({profileId:profiles.listProfiles()[0].id,items:boodschappen}),/status 500/);
    assert.equal(profiles.smsHistory(1)[0].status,'mislukt');
    profiles.saveSmsSettings({provider:'link',clear:['sms.webhookUrl']});
    await assert.rejects(()=>profiles.sendShoppingList({items:boodschappen}),/Kies een profiel met telefoonnummer/);
    await assert.rejects(()=>profiles.sendShoppingList({to:'onzin',items:boodschappen}),/geldig telefoonnummer/);
    const twilioZonderInlog=profiles.saveSmsSettings({provider:'twilio'});
    assert.equal(twilioZonderInlog.canSend,false);
    assert.equal(twilioZonderInlog.providerHint,'Vul eerst je Twilio Account SID en Auth Token in.');
    await assert.rejects(()=>profiles.sendShoppingList({to:'0612345678',items:boodschappen}),/Twilio Account SID/);
  }finally{
    await new Promise(r=>kapot.close(r));
  }
});

test('een los nummer mag ook, zonder profiel',async()=>{
  profiles.saveSmsSettings({provider:'link'});
  const uitkomst=await profiles.sendShoppingList({to:'+31 6 12345678',items:boodschappen,sender:'Lijst'});
  assert.equal(uitkomst.to,'+31612345678');
  assert.match(uitkomst.link,/^sms:\+31612345678/);
  assert.equal(uitkomst.body.startsWith('Lijst:'),true);
});