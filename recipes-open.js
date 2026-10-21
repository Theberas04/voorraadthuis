const unitoolsData = require('./recipe-data/unitools-recipes.json');
const wikibooksEnData = require('./recipe-data/wikibooks-en-recipes.json');
const wikibooksEsData = require('./recipe-data/wikibooks-es-recipes.json');
const wikibooksDeData = require('./recipe-data/wikibooks-de-recipes.json');
const wikibooksNlData = require('./recipe-data/wikibooks-nl-recipes.json');
const wikibooksFrData = require('./recipe-data/wikibooks-fr-recipes.json');
const wikibooksItData = require('./recipe-data/wikibooks-it-recipes.json');
const wikibooksCaData = require('./recipe-data/wikibooks-ca-recipes.json');
const wikibooksPtData = require('./recipe-data/wikibooks-pt-recipes.json');
const wikibooksJaData = require('./recipe-data/wikibooks-ja-recipes.json');
const wikibooksPlData = require('./recipe-data/wikibooks-pl-recipes.json');
const wikibooksSvData = require('./recipe-data/wikibooks-sv-recipes.json');
const wikibooksNbData = require('./recipe-data/wikibooks-nb-recipes.json');
const wikibooksFiData = require('./recipe-data/wikibooks-fi-recipes.json');
const wikibooksCocktailsData = require('./recipe-data/wikibooks-cocktails-recipes.json');
const wikibooksBorrelhapjesData = require('./recipe-data/wikibooks-borrelhapjes-recipes.json');
const translationsData = require(process.env.TRANSLATIONS_FILE||'./recipe-data/translations-nl.json');
// Vertalingen staan op een vaste bronsleutel (bron + titel), niet op het volgnummer:
// daardoor kan de selectie groeien zonder dat bestaande vertalingen losraken.
const dutchTranslations = new Map(Object.entries(translationsData.items||{}));

function normalizedName(value) {
  const key=String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  return key||String(value??'').trim().toLowerCase();
}

const BRONTAAL_KORT={en:'Engels',es:'Spaans',de:'Duits',fr:'Frans',it:'Italiaans',ca:'Catalaans',pt:'Portugees',ja:'Japans',pl:'Pools',sv:'Zweeds',nb:'Noors',fi:'Fins',hu:'Hongaars'};

function dutchRecipe(recipe) {
  const translation = dutchTranslations.get(recipe.sourceKey)||dutchTranslations.get(String(recipe.id));
  if(!translation)return recipe;
  const ingredients = recipe.ingredients.map((ingredient,index)=>{
    const translated = (translation.ingredients||[])[index];
    if(!translated||!translated.name)return ingredient;
    return {
      ...ingredient,
      name:translated.name,
      ...(ingredient.display!=null&&translated.display?{display:translated.display}:{}),
    };
  });
  return {
    ...recipe,
    name:translation.name||recipe.name,
    cuisine:translation.cuisine||recipe.cuisine,
    description:translation.description||recipe.description,
    ingredients,
    steps:Array.isArray(translation.steps)&&translation.steps.length===recipe.steps.length?translation.steps:recipe.steps,
    // De brontekst blijft bewaard, zodat een latere importronde weer op dezelfde
    // tekst kan ontdubbelen; alleen de weergave is Nederlands.
    sourceText:recipe.name,
    language:'nl',
    translatedFrom:recipe.language,
  };
}

const regionNames = new Intl.DisplayNames(['nl'], {type:'region'});
const countryNames = new Map(unitoolsData.countries.map(country => [country.code, regionNames.of(country.code)]));
const countryCuisines = new Map(unitoolsData.countries.map(country => [country.cuisine.en.replace(/ cuisine$/i, '').toLocaleLowerCase('en'), countryNames.get(country.code)]));
const licentieUrl = 'https://creativecommons.org/licenses/by-sa/4.0/';
const unitLabels = {g:'gram',kg:'kg',ml:'ml',l:'liter',piece:'stuks',tbsp:'eetlepels',tsp:'theelepels',toTaste:'naar smaak',clove:'tenen',pinch:'snufje',sprig:'takjes',slice:'plakken'};

function unitoolsRecipe(recipe, index) {
  const cookMinutes = recipe.cookMinutes;
  return {
    sourceKey:`unitools:${normalizedName(recipe.name.en)}`,
    id:1000+index,
    name:recipe.name.en,
    cuisine:countryNames.get(recipe.country) || recipe.country,
    time:Number.isFinite(recipe.prepMinutes)&&Number.isFinite(cookMinutes)?recipe.prepMinutes+cookMinutes:null,
    servings:recipe.baseServings,
    description:recipe.summary.en,
    language:'en',
    ingredients:recipe.ingredients.map(ingredient=>({
      name:ingredient.name.en,
      quantity:ingredient.quantity??1,
      unit:ingredient.quantity==null?'naar smaak':(unitLabels[ingredient.unit]||ingredient.unit),
      ...(ingredient.note?.en?{note:ingredient.note.en}:{}),
    })),
    steps:recipe.steps.map(step=>step.text.en),
    source:{name:'UniTools World Recipes',url:unitoolsData.landingPage,license:unitoolsData.license,licenseUrl:unitoolsData.licenseUrl||licentieUrl},
  };
}

const fractionValues = {'¼':0.25,'½':0.5,'¾':0.75,'⅓':1/3,'⅔':2/3,'⅛':0.125,'⅜':0.375,'⅝':0.625,'⅞':0.875};
function numericAmount(value) {
  const text=value.trim();
  if (fractionValues[text]!=null)return fractionValues[text];
  const mixed=text.match(/^(\d+)\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  if(mixed)return Number(mixed[1])+fractionValues[mixed[2]];
  const mixedSlash=text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if(mixedSlash)return Number(mixedSlash[1])+Number(mixedSlash[2])/Number(mixedSlash[3]);
  const fraction=text.match(/^(\d+)\/(\d+)$/);
  if(fraction)return Number(fraction[1])/Number(fraction[2]);
  const number=Number(text);
  return Number.isFinite(number)?number:1;
}

const amountToken='(?:\\d+(?:\\.\\d+)?(?:\\s+\\d+\\/\\d+|\\s*[¼½¾⅓⅔⅛⅜⅝⅞])?|\\d+\\/\\d+|[¼½¾⅓⅔⅛⅜⅝⅞])';
const amountPattern=new RegExp(`^(${amountToken})(?:\\s*[-–]\\s*(${amountToken}))?\\s*(.*)$`,'i');
const unitPattern=/^(cups?|c|tablespoons?|tbsp\.?|teaspoons?|tsp\.?|ounces?|oz\.?|pounds?|lbs?\.?|grams?|g|kilograms?|kg|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|cloves?|pinches?|dashes?|sticks?|slices?|cans?|packages?|packets?|bunch(?:es)?|sprigs?|pieces?|heads?|large|medium|small|litros?|tazas?|cucharadas?|cucharaditas?|pizcas?|dientes?|vasos?|docenas?|sobres?|latas?|ramitas?|lonchas?|unidades?|trozos?|manojos?|cc|cl|dl|el|tl|essl(?:oe|ö)ffel|teel(?:oe|ö)ffel|prisen?|zehen?|bunde?|dosen?|packungen?|p(?:ae|ä)ckchen|becher|scheiben?|st(?:ue|ü)cke?|tassen?|pfund|messerspitze|handvoll|zweige?|dutzend|ly(?:ż|z)ka|ly(?:ż|z)ki|ly(?:ż|z)ek|ly(?:ż|z)eczka|ly(?:ż|z)eczki|ly(?:ż|z)eczek|szklanka|szklanki|szklanek|szczypta|szczypty|gar(?:ś|s)(?:ć|c)i?|sztuka|sztuki|szt|puszka|puszki|opakowanie|p(?:ę|e)czek|plaster|plastry|kromka|kostka|z(?:ą|a)b(?:ek|ki|k(?:ó|o)w)|msk|tsk|krm|nypor|nypa|knippe|skiva|skivor|burk|burkar|p(?:å|a)se|klyfta|klyftor|paket|nypa|ss|ts|stk|stykk|neve|bunt|boks|pose|fedd|glass|kopp|krydderm(?:å|a)l|rkl|tl|kpl|nippu|purkki|pussi|viipale|ripaus|kourallinen|t(?:ö|o)lkki|paketti|x(?:í|i)cara|x(?:í|i)caras|colher|colheres|unidade|unidades|dente|dentes|pitada|pitadas|fatia|fatias|ramo|ramos|lata|latas|pacote|pacotes|garrafa|garrafas|ma(?:ç|c)o|ma(?:ç|c)os|kg|g|mg|dl|cl)\b\.?\s*(.*)$/i;
const unitAliases={cups:'cup',c:'cup',tablespoon:'eetlepel',tablespoons:'eetlepels',tbsp:'eetlepel',teaspoon:'theelepel',teaspoons:'theelepels',tsp:'theelepel',ounce:'ounce',ounces:'ounces',oz:'ounce',pound:'pond',pounds:'pond',lb:'pond',lbs:'pond',gram:'gram',grams:'gram',g:'gram',kilogram:'kg',kilograms:'kg',kg:'kg',milliliter:'ml',milliliters:'ml',millilitre:'ml',millilitres:'ml',ml:'ml',liter:'liter',liters:'liter',litre:'liter',litres:'liter',l:'liter',clove:'teen',cloves:'tenen',pinch:'snufje',pinches:'snufjes',dash:'scheutje',dashes:'scheutjes',stick:'stuk',sticks:'stukken',slice:'plak',slices:'plakken',can:'blik',cans:'blikken',package:'pakje',packages:'pakjes',packet:'pakje',packets:'pakjes',bunch:'bos',bunches:'bossen',sprig:'takje',sprigs:'takjes',piece:'stuk',pieces:'stuks',head:'stuk',heads:'stuks',large:'large',medium:'medium',small:'small',litro:'liter',litros:'liter',taza:'kopje',tazas:'kopjes',cucharada:'eetlepel',cucharadas:'eetlepels',cucharadita:'theelepel',cucharaditas:'theelepels',pizca:'snufje',pizcas:'snufjes',diente:'teen',dientes:'tenen',vaso:'glas',vasos:'glazen',docena:'dozijn',docenas:'dozijn',sobre:'zakje',sobres:'zakjes',lata:'blik',latas:'blikken',ramita:'takje',ramitas:'takjes',loncha:'plak',lonchas:'plakken',unidad:'stuks',unidades:'stuks',trozo:'stuk',trozos:'stukken',manojo:'bos',manojos:'bossen',cc:'ml',cl:'cl',dl:'dl',el:'eetlepel',tl:'theelepel',esslöffel:'eetlepel',essloeffel:'eetlepel',teelöffel:'theelepel',teeloeffel:'theelepel',prise:'snufje',prisen:'snufjes',zehe:'teen',zehen:'tenen',bund:'bos',bunde:'bossen',dose:'blik',dosen:'blikken',packung:'pakje',packungen:'pakjes',päckchen:'pakje',paeckchen:'pakje',becher:'beker',scheibe:'plak',scheiben:'plakken',stück:'stuk',stücke:'stukken',stueck:'stuk',stuecke:'stukken',tasse:'kopje',tassen:'kopjes',pfund:'pond',messerspitze:'snufje',handvoll:'handvol',zweig:'takje',zweige:'takjes',dutzend:'dozijn',łyżka:'eetlepel',łyżki:'eetlepels',łyżek:'eetlepels',lyzka:'eetlepel',lyzki:'eetlepels',lyzek:'eetlepels',łyżeczka:'theelepel',łyżeczki:'theelepels',łyżeczek:'theelepels',lyzeczka:'theelepel',lyzeczki:'theelepels',szklanka:'kopje',szklanki:'kopjes',szklanek:'kopjes',szczypta:'snufje',szczypty:'snufjes',garść:'handvol',garści:'handvol',sztuka:'stuk',sztuki:'stuks',szt:'stuks',puszka:'blik',puszki:'blikken',opakowanie:'pakje',pęczek:'bos',peczek:'bos',plaster:'plak',plastry:'plakken',kromka:'sneetje',kostka:'blokje',ząbek:'teen',ząbki:'tenen',ząbków:'tenen',zabek:'teen',msk:'eetlepel',tsk:'theelepel',krm:'snufje',nypor:'snufjes',nypa:'snufje',knippe:'bos',skiva:'plak',skivor:'plakken',burk:'blik',burkar:'blikken',påse:'zakje',pase:'zakje',klyfta:'partje',klyftor:'partjes',paket:'pakje',ss:'eetlepel',ts:'theelepel',stk:'stuks',stykk:'stuks',neve:'handvol',bunt:'bos',boks:'blik',pose:'zakje',fedd:'teen',glass:'glas',kopp:'kopje',kryddermål:'snufje',kryddermal:'snufje',rkl:'eetlepel',tl:'theelepel',kpl:'stuks',nippu:'bos',purkki:'potje',pussi:'zakje',viipale:'plak',ripaus:'snufje',kourallinen:'handvol',tölkki:'blik',tolkki:'blik',paketti:'pakje',xícara:'kopje',xícaras:'kopjes',xicara:'kopje',xicaras:'kopjes',colher:'lepel',colheres:'lepels',unidade:'stuks',unidades:'stuks',dente:'teen',dentes:'tenen',pitada:'snufje',pitadas:'snufjes',fatia:'plak',fatias:'plakken',ramo:'takje',ramos:'takjes',lata:'blik',latas:'blikken',pacote:'pakje',pacotes:'pakjes',garrafa:'fles',garrafas:'flessen',maço:'bos',maços:'bossen',maco:'bos',macos:'bossen',soeplepel:'eetlepel',soeplepels:'eetlepels',eetlepel:'eetlepel',eetlepels:'eetlepels',theelepel:'theelepel',theelepels:'theelepels',kopje:'kopje',kopjes:'kopjes',snufje:'snufje',snufjes:'snufjes',teentje:'teen',teentjes:'tenen',teen:'teen',blikje:'blik',blikjes:'blikken',zakje:'zakje',zakjes:'zakjes',bosje:'bos',bosjes:'bossen',plak:'plak',plakken:'plakken',plakje:'plakje',sneetje:'sneetje',sneetjes:'sneetjes',portie:'portie',porties:'porties',takje:'takje',takjes:'takjes',blaadje:'blaadje',blaadjes:'blaadjes',klont:'klont',klontje:'klontje',scheutje:'scheutje',scheutjes:'scheutjes',handvol:'handvol',bol:'bol',bollen:'bollen',stengel:'stengel',stengels:'stengels',krop:'krop',kroppen:'kroppen',pakje:'pakje',pakjes:'pakjes',potje:'potje',potjes:'potjes',ons:'ons',kilo:'kg',kilogram:'kg',liter:'liter',dl:'dl',cl:'cl',ml:'ml',cuillere:'eetlepel',cuilleres:'eetlepels',cuillereasoupe:'eetlepel',cuilleresasoupe:'eetlepels',c:'eetlepel',gousse:'teen',gousses:'tenen',pincee:'snufje',pincees:'snufjes',tranche:'plak',tranches:'plakken',tasse:'kopje',tasses:'kopjes',verre:'glas',verres:'glazen',sachet:'zakje',sachets:'zakjes',boite:'blik',boites:'blikken',bouquet:'bos',bouquets:'bossen',brin:'takje',brins:'takjes',cucchiaio:'eetlepel',cucchiai:'eetlepels',cucchiaino:'theelepel',cucchiaini:'theelepels',spicchio:'teen',spicchi:'tenen',fetta:'plak',fette:'plakken',pizzico:'snufje',pizzichi:'snufjes',scatola:'blik',scatole:'blikken',bustina:'zakje',bustine:'zakjes',mazzo:'bos',mazzi:'bossen',tazza:'kopje',tazze:'kopjes',bicchiere:'glas',bicchieri:'glazen',cullerada:'eetlepel',cullerades:'eetlepels',culleradeta:'theelepel',culleradetes:'theelepels',pessic:'snufje',pessics:'snufjes',llesca:'plak',llesques:'plakken',grapat:'handvol',grapats:'handvol',tassa:'kopje',tasses2:'kopjes',got:'glas',gots:'glazen',bossa:'zakje',bosses:'zakjes',unitat:'stuks',unitats:'stuks',rajoli:'scheutje',rajolí:'scheutje',gota:'druppel',gotes:'druppels',fulla:'blad',fulles:'bladeren'};
function stripWikitext(value) {
  return String(value??'')
    .replace(/\[\[(?:Bestand|Afbeelding|File|Image):[^\]]*\]\]/gi,' ')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g,'$1')
    .replace(/\[\[([^\]]+)\]\]/g,'$1')
    .replace(/\{\{[^{}]*\}\}/g,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/'''|''/g,'')
    .replace(/\s+/g,' ')
    .trim();
}
const ES_ARTIKELS=/^(?:de\s+la\s+|del\s+|de\s+|el\s+|la\s+|los\s+|las\s+)/i;
const FR_ARTIKELS=/^(?:de\s+la\s+|de\s+l'|du\s+|des\s+|d'|de\s+|le\s+|la\s+|les\s+|l')/i;
const IT_ARTIKELS=/^(?:della\s+|dello\s+|dei\s+|degli\s+|delle\s+|del\s+|di\s+|d')/i;
const CA_ARTIKELS=/^(?:de\s+la\s+|de\s+l'|del\s+|dels\s+|de\s+|d')/i;
const ARTIKELS={es:ES_ARTIKELS,fr:FR_ARTIKELS,it:IT_ARTIKELS,ca:CA_ARTIKELS};

// Japanse kookboekpagina's zetten de naam vóór de dubbele punt en de hoeveelheid
// erachter, en de lepelmaten vóór het getal ("酢: 大さじ4"). Daarom een eigen regel.
const JA_UNITS={大さじ:'eetlepel',小さじ:'theelepel',カップ:'kopje',グラム:'gram',ミリリットル:'ml',cc:'ml',ml:'ml',g:'gram',kg:'kg',
  個:'stuk',枚:'plak',本:'stengel',玉:'stuk',片:'stuk',切れ:'stuk',束:'bos',袋:'zakje',缶:'blik',丁:'stuk',匹:'stuk',斤:'stuk',合:'kopje',人分:'portie'};
const JA_UNIT_WOORDEN='大さじ|小さじ|カップ|グラム|ミリリットル|cc|ml|g|kg|個|枚|本|玉|片|切れ|束|袋|缶|丁|匹|斤|合|人分';
// 'pół ogórka' betekent een halve komkommer; de Poolse keuken schrijft dat met een woord.
const HALF_WOORDEN={pl:'pół',fi:'puoli',sv:'halv',nb:'halv',da:'halv',de:'halbe?'};

function wikibooksIngredient(line, language) {
  const original=String(line||'').trim();
  if(language==='ja'){
    const splits=original.match(/^([^:：]{1,60})[:：]\s*(.+)$/);
    if(splits){
      const naam=splits[1].trim(), staart=splits[2].trim();
      const voor=staart.match(new RegExp(`^(${JA_UNIT_WOORDEN})\\s*(${amountToken})$`));
      if(voor)return{name:naam,quantity:Number(numericAmount(voor[2]).toFixed(3)),unit:JA_UNITS[voor[1]]||'stuks',display:original};
      const na=staart.match(new RegExp(`^(${amountToken})\\s*(${JA_UNIT_WOORDEN})?$`));
      if(na)return{name:naam,quantity:Number(numericAmount(na[1]).toFixed(3)),unit:JA_UNITS[na[2]]||'stuks',display:original};
      if(/^(少々|適量|適宜|お好みで|お好みにより)$/.test(staart))return{name:naam,quantity:1,unit:'naar smaak',display:original};
      if(staart)return{name:`${naam} (${staart})`,quantity:1,unit:'niet vermeld',display:original};
      return{name:naam,quantity:1,unit:'niet vermeld',display:original};
    }
  }
  const half=HALF_WOORDEN[language]&&new RegExp(`^(?:${HALF_WOORDEN[language]})\\s+(.+)$`,'i');
  const halfMatch=half&&original.match(half);
  if(halfMatch)return{name:halfMatch[1].trim(),quantity:0.5,unit:'stuk',display:original};
  const match=original.match(amountPattern);
  if(!match)return{name:original,quantity:1,unit:'niet vermeld',display:original};
  if(match[2])return{name:original,quantity:1,unit:'bronregel',display:original};
  // '350 à 500 g' is een bereik: letterlijk laten staan, niet middelen.
  if(/^à\s/i.test(match[3].trim()))return{name:original,quantity:1,unit:'bronregel',display:original};
  const quantity=Number(numericAmount(match[1]).toFixed(3));
  let rest=match[3].trim(),unit='stuks';
  const unitMatch=rest.match(unitPattern);
  if(unitMatch){const key=unitMatch[1].toLowerCase().replace(/\.$/,'');unit=unitAliases[key]||key;rest=unitMatch[2].trim();}
  if(ARTIKELS[language])rest=rest.replace(ARTIKELS[language],'').trim();
  if(!rest)return{name:original,quantity:1,unit:'niet vermeld',display:original};
  return{name:rest.replace(/\s+/g,' '),quantity:quantity>0?quantity:1,unit,display:original};
}

function wikiTime(value) {
  if(typeof value!=='string')return null;
  let minutes=0;
  const pattern=/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|h|minutes?|mins?|min)\b/gi;
  for(const match of value.matchAll(pattern)){const amount=match[2]?(Number(match[1])+Number(match[2]))/2:Number(match[1]);minutes+=amount*(match[3].toLowerCase().startsWith('h')?60:1);}
  return minutes?Math.round(minutes):null;
}
function wikiServings(value) {
  const match=String(value??'').match(/(\d+)(?:\s*[-–]\s*(\d+))?/);
  if(!match)return null;
  return Math.max(1,Math.round(match[2]?(Number(match[1])+Number(match[2]))/2:Number(match[1])));
}
function wikiCountry(category) {
  const key=String(category||'').split(':').pop().replace(/_recipes$/i,'').replace(/_/g,' ').trim().toLocaleLowerCase('en');
  return countryCuisines.get(key)||'Internationaal';
}
function wikibooksRecipe(row, index, metadata) {
  const recipe=row.recipe_data;
  const info=recipe.infobox||{};
  const lines=recipe.text_lines||[];
  const intro=lines.find(line=>line.line_type==='p'&&!line.section&&line.text&&!/^From the original recipe contributor:/i.test(line.text.trim()));
  return {
    sourceKey:`wikibooks-en:${normalizedName(recipe.title)}`,
    id:2000+index,
    name:recipe.title,
    cuisine:wikiCountry(info.category),
    time:wikiTime(info.time),
    servings:wikiServings(info.servings),
    description:intro?.text?.trim()||'Recipe from the Wikibooks Cookbook; see the linked source page for its notes and variations.',
    language:'en',
    ingredients:lines.filter(line=>line.section==='Ingredients'&&line.line_type==='ul'&&line.text?.trim()).map(line=>wikibooksIngredient(line.text)),
    steps:lines.filter(line=>line.section==='Procedure'&&line.line_type==='ol'&&line.text?.trim()).map(line=>line.text.trim()),
    source:{name:metadata.name,url:recipe.url,license:metadata.license,licenseUrl:metadata.licenseUrl},
  };
}
function wikibooksEsRecipe(record, index, metadata) {
  return {
    sourceKey:`wikibooks-es:${normalizedName(record.title)}`,
    id:10000+index,
    name:record.title,
    cuisine:record.countryCode?(countryNames.get(record.countryCode)||'Internationaal'):'Internationaal',
    time:Number.isFinite(record.time)?record.time:null,
    servings:Number.isFinite(record.servings)?record.servings:null,
    description:stripWikitext(record.description)||'Recept uit het Wikibooks-kookboek; zie de bronpagina voor variaties en opmerkingen.',
    language:'es',
    ingredients:record.ingredients.map(line=>wikibooksIngredient(line,'es')),
    steps:record.steps.slice(),
    source:{name:metadata.name,url:record.url,license:metadata.license,licenseUrl:metadata.licenseUrl},
  };
}

function wikibooksDeRecipe(record, index, metadata) {
  return {
    sourceKey:`wikibooks-de:${normalizedName(record.title)}`,
    // Eigen id-blok per bron; 4000 viel binnen het bereik van de Engelse bron
    // (2000 + 3393 recepten), waardoor 407 Duitse recepten een dubbel id kregen.
    id:30000+index,
    name:record.title,
    cuisine:record.countryCode?(countryNames.get(record.countryCode)||'Internationaal'):'Internationaal',
    time:Number.isFinite(record.time)?record.time:null,
    servings:Number.isFinite(record.servings)?record.servings:null,
    description:stripWikitext(record.description)||'Recept uit het Wikibooks-kookboek; zie de bronpagina voor variaties en opmerkingen.',
    language:'de',
    ingredients:record.ingredients.map(line=>wikibooksIngredient(line,'de')),
    steps:record.steps.slice(),
    source:{name:metadata.name,url:record.url,license:metadata.license,licenseUrl:metadata.licenseUrl},
  };
}

function wikibooksNlRecipe(record, index, metadata) {
  return {
    sourceKey:`wikibooks-nl:${normalizedName(record.title)}`,
    id:11000+index,
    name:record.name||record.title,
    cuisine:record.countryCode?(countryNames.get(record.countryCode)||'Internationaal'):'Internationaal',
    time:Number.isFinite(record.time)?record.time:null,
    servings:Number.isFinite(record.servings)?record.servings:null,
    description:record.description||'Recept uit het Wikibooks-kookboek; zie de bronpagina voor variaties en opmerkingen.',
    // Dit kookboek is al Nederlands; er is dus geen vertaling nodig en het recept
    // krijgt ook geen 'Vertaald'-label.
    language:'nl',
    alNederlands:true,
    ingredients:record.ingredients.map(line=>wikibooksIngredient(line,'nl')),
    steps:record.steps.slice(),
    source:{name:metadata.name,url:record.url,license:metadata.license,licenseUrl:metadata.licenseUrl},
  };
}

function generiekeWikiRecipe(record, index, metadata, idBase) {
  return {
    sourceKey:`${metadata.sourceKeyPrefix}:${normalizedName(record.title)}`,
    id:idBase+index,
    name:record.title,
    cuisine:record.countryCode?(countryNames.get(record.countryCode)||'Internationaal'):'Internationaal',
    time:Number.isFinite(record.time)?record.time:null,
    servings:Number.isFinite(record.servings)?record.servings:null,
    description:stripWikitext(record.description)||'Recept uit het Wikibooks-kookboek; zie de bronpagina voor variaties en opmerkingen.',
    language:record.language,
    ingredients:record.ingredients.map(line=>wikibooksIngredient(line,record.language)),
    steps:record.steps.slice(),
    source:{name:metadata.name,url:record.url,license:metadata.license,licenseUrl:metadata.licenseUrl},
  };
}

// Aantal recepten dat uit de open bronnen komt; de app start niet als dat aantal
// onverwacht verandert, zodat een halve import nooit stilletjes live gaat.
const EXPECTED_IMPORTS=9692;
const EXPECTED_TOTAL=9807;
// Diagnosemodus, alleen voor ontwikkeling en geautomatiseerde controles van
// onderdelen die losstaan van de recepten (profielen, sms, kledingkast). Zet
// deze variabele nooit in productie: dan start de app met nog niet vertaalde
// recepten in plaats van te weigeren.
const DEV_MODE=process.env.VOORRAADTHUIS_DEV==='1';
if(DEV_MODE)console.warn('[VoorraadThuis] VOORRAADTHUIS_DEV=1 — de volledigheidscontrole op de recepten staat uit.');

// Zet de drie open bronnen om naar de vorm van de app en ontdubbel op de brontekst.
function collectImports(existingRecipes) {
  if(!Array.isArray(existingRecipes))throw new TypeError('An existing curated recipe list is required for deduplication.');
  const used=new Set(existingRecipes.map(recipe=>normalizedName(recipe.name)));
  const imported=[];
  const add=(recipe)=>{
    const key=normalizedName(recipe.name);
    if(used.has(key))return;
    used.add(key);
    imported.push(recipe);
  };
  unitoolsData.recipes.forEach((recipe,index)=>add(unitoolsRecipe(recipe,index)));
  wikibooksEnData.recipes.forEach((row,index)=>add(wikibooksRecipe(row,index,wikibooksEnData.source)));
  wikibooksEsData.recipes.forEach((record,index)=>add(wikibooksEsRecipe(record,index,wikibooksEsData.source)));
  wikibooksDeData.recipes.forEach((record,index)=>add(wikibooksDeRecipe(record,index,wikibooksDeData.source)));
  wikibooksNlData.recipes.forEach((record,index)=>add(wikibooksNlRecipe(record,index,wikibooksNlData.source)));
  wikibooksFrData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksFrData.source,sourceKeyPrefix:'wikibooks-fr'},20000)));
  wikibooksItData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksItData.source,sourceKeyPrefix:'wikibooks-it'},21000)));
  wikibooksCaData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksCaData.source,sourceKeyPrefix:'wikibooks-ca'},22000)));
  wikibooksPtData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksPtData.source,sourceKeyPrefix:'wikibooks-pt'},23000)));
  wikibooksJaData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksJaData.source,sourceKeyPrefix:'wikibooks-ja'},24000)));
  wikibooksPlData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksPlData.source,sourceKeyPrefix:'wikibooks-pl'},25000)));
  wikibooksSvData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksSvData.source,sourceKeyPrefix:'wikibooks-sv'},26000)));
  wikibooksNbData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksNbData.source,sourceKeyPrefix:'wikibooks-nb'},27000)));
  wikibooksFiData.recipes.forEach((record,index)=>add(generiekeWikiRecipe(record,index,{...wikibooksFiData.source,sourceKeyPrefix:'wikibooks-fi'},28000)));
  // Cocktails en borrelhapjes krijgen hun eigen keuken, zodat ze met één klik in het
  // landenfilter bij elkaar staan in plaats van verspreid over veertien talen.
  wikibooksCocktailsData.recipes.forEach((record,index)=>{const r=generiekeWikiRecipe(record,index,{...wikibooksCocktailsData.source,sourceKeyPrefix:'wikibooks-cocktails'},29000);r.cuisine='Cocktails';if(record.language==='nl')r.alNederlands=true;add(r);});
  wikibooksBorrelhapjesData.recipes.forEach((record,index)=>{const r=generiekeWikiRecipe(record,index,{...wikibooksBorrelhapjesData.source,sourceKeyPrefix:'wikibooks-borrelhapjes'},31000);r.cuisine='Borrelhapjes';if(record.language==='nl')r.alNederlands=true;add(r);});
  // Selectie en ontdubbeling gebeuren op de brontekst, zodat de vertaling de keuze
  // nooit kan veranderen.
  if(!DEV_MODE&&imported.length!==EXPECTED_IMPORTS)throw new Error(`Expected ${EXPECTED_IMPORTS} licensed recipe imports, found ${imported.length}`);
  return imported;
}

function createOpenRecipes(existingRecipes) {
  const imported=collectImports(existingRecipes);
  const withoutTranslation=imported.filter(recipe=>!recipe.alNederlands&&!dutchTranslations.has(recipe.sourceKey));
  if(!DEV_MODE&&withoutTranslation.length)throw new Error(`Ontbrekende Nederlandse vertaling voor ${withoutTranslation.length} geïmporteerde recepten (bijvoorbeeld ${withoutTranslation[0].sourceKey}). Draai scripts/merge-recipe-translations.py.`);
  // Een vertaalde naam mag niet samenvallen met een bestaand recept; in dat geval
  // blijft de bronnaam staan, zodat elk recept een eigen naam houdt. Valt ook die
  // bronnaam samen (twee kookboeken met dezelfde titel), dan komt de brontaal er
  // tussen haakjes achter: de unieke naam en het exacte aantal blijven zo bestaan.
  const taken=new Set(existingRecipes.map(recipe=>normalizedName(recipe.name)));
  const translated=imported.map(recipe=>{
    const dutch=recipe.alNederlands?recipe:dutchRecipe(recipe);
    let naam=dutch.name;
    if(taken.has(normalizedName(naam))){
      naam=recipe.name;
      if(taken.has(normalizedName(naam))){
        const taal=recipe.alNederlands?'Kookboek':(BRONTAAL_KORT[recipe.language]||recipe.language||'onbekend');
        naam=`${recipe.name} (${taal})`;
        for(let nummer=2;taken.has(normalizedName(naam));nummer++)naam=`${recipe.name} (${taal} ${nummer})`;
      }
    }
    taken.add(normalizedName(naam));
    return naam===dutch.name?dutch:{...dutch,name:naam,sourceNameKept:recipe.name};
  });
  if(!DEV_MODE&&existingRecipes.length+translated.length!==EXPECTED_TOTAL)throw new Error(`Expected ${EXPECTED_TOTAL} recipes in total, found ${existingRecipes.length+translated.length}`);
  return translated;
}

module.exports=createOpenRecipes;
module.exports.dutchRecipe=dutchRecipe;
module.exports.translationCount=dutchTranslations.size;
module.exports.wikibooksIngredient=wikibooksIngredient;
module.exports.normalizedName=normalizedName;
module.exports.collectImports=collectImports;