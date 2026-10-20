const unitoolsData = require('./recipe-data/unitools-recipes.json');
const wikibooksData = require('./recipe-data/wikibooks-recipes.json');
const translationsData = require(process.env.TRANSLATIONS_FILE||'./recipe-data/translations-nl.json');
const dutchTranslations = new Map(Object.entries(translationsData.items||{}));

/* Vervang de tekst van een geïmporteerd recept door de Nederlandse vertaling.
   Id, hoeveelheid, eenheid, bron en licentie blijven ongewijzigd. */
function dutchRecipe(recipe) {
  const translation = dutchTranslations.get(String(recipe.id));
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
    language:'nl',
    translatedFrom:recipe.language,
  };
}

const regionNames = new Intl.DisplayNames(['nl'], {type:'region'});
const countryNames = new Map(unitoolsData.countries.map(country => [country.code, regionNames.of(country.code)]));
const countryCuisines = new Map(unitoolsData.countries.map(country => [country.cuisine.en.replace(/ cuisine$/i, '').toLocaleLowerCase('en'), countryNames.get(country.code)]));
const licenseUrl = 'https://creativecommons.org/licenses/by-sa/4.0/';
const unitLabels = {g:'gram',kg:'kg',ml:'ml',l:'liter',piece:'stuks',tbsp:'eetlepels',tsp:'theelepels',toTaste:'naar smaak',clove:'tenen',pinch:'snufje',sprig:'takjes',slice:'plakken'};

function normalizedName(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function unitoolsRecipe(recipe, index) {
  const cookMinutes = recipe.cookMinutes;
  return {
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
    source:{name:'UniTools World Recipes',url:unitoolsData.landingPage,license:unitoolsData.license,licenseUrl:unitoolsData.licenseUrl||licenseUrl},
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
const unitPattern=/^(cups?|c|tablespoons?|tbsp\.?|teaspoons?|tsp\.?|ounces?|oz\.?|pounds?|lbs?\.?|grams?|g|kilograms?|kg|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l|cloves?|pinches?|dashes?|sticks?|slices?|cans?|packages?|packets?|bunch(?:es)?|sprigs?|pieces?|heads?|large|medium|small)\b\.?\s*(.*)$/i;
const unitAliases={cups:'cup',c:'cup',tablespoon:'eetlepel',tablespoons:'eetlepels',tbsp:'eetlepel',teaspoon:'theelepel',teaspoons:'theelepels',tsp:'theelepel',ounce:'ounce',ounces:'ounces',oz:'ounce',pound:'pond',pounds:'pond',lb:'pond',lbs:'pond',gram:'gram',grams:'gram',g:'gram',kilogram:'kg',kilograms:'kg',kg:'kg',milliliter:'ml',milliliters:'ml',millilitre:'ml',millilitres:'ml',ml:'ml',liter:'liter',liters:'liter',litre:'liter',litres:'liter',l:'liter',clove:'teen',cloves:'tenen',pinch:'snufje',pinches:'snufjes',dash:'scheutje',dashes:'scheutjes',stick:'stuk',sticks:'stukken',slice:'plak',slices:'plakken',can:'blik',cans:'blikken',package:'pakje',packages:'pakjes',packet:'pakje',packets:'pakjes',bunch:'bos',bunches:'bossen',sprig:'takje',sprigs:'takjes',piece:'stuk',pieces:'stuks',head:'stuk',heads:'stuks',large:'large',medium:'medium',small:'small'};
function wikibooksIngredient(line) {
  const original=String(line||'').trim();
  const match=original.match(amountPattern);
  if(!match)return{name:original,quantity:1,unit:'niet vermeld',display:original};
  if(match[2])return{name:original,quantity:1,unit:'bronregel',display:original};
  const quantity=Number(numericAmount(match[1]).toFixed(3));
  let rest=match[3].trim(),unit='stuks';
  const unitMatch=rest.match(unitPattern);
  if(unitMatch){const key=unitMatch[1].toLowerCase().replace(/\.$/,'');unit=unitAliases[key]||key;rest=unitMatch[2].trim();}
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
    id:2000+index,
    name:recipe.title,
    cuisine:wikiCountry(info.category),
    time:wikiTime(info.time),
    servings:wikiServings(info.servings),
    description:intro?.text?.trim()||'Recipe from the Wikibooks Cookbook; see the linked source page for its notes and variations.',
    language:'en',
    ingredients:lines.filter(line=>line.section==='Ingredients'&&line.line_type==='ul'&&line.text?.trim()).map(line=>wikibooksIngredient(line.text)),
    steps:lines.filter(line=>line.section==='Procedure'&&line.line_type==='ol'&&line.text?.trim()).map(line=>line.text.trim()),
    source:{name:'Wikibooks Cookbook',url:recipe.url,license:metadata.license,licenseUrl:metadata.licenseUrl},
  };
}

function createOpenRecipes(existingRecipes) {
  if(!Array.isArray(existingRecipes))throw new TypeError('An existing curated recipe list is required for deduplication.');
  const used=new Set(existingRecipes.map(recipe=>normalizedName(recipe.name)));
  const imported=[];
  unitoolsData.recipes.forEach((recipe,index)=>{
    const converted=unitoolsRecipe(recipe,index),key=normalizedName(converted.name);
    if(used.has(key))return;
    used.add(key);
    imported.push(converted);
  });
  wikibooksData.recipes.forEach((row,index)=>{
    const converted=wikibooksRecipe(row,index,wikibooksData.source),key=normalizedName(converted.name);
    if(used.has(key))return;
    used.add(key);
    imported.push(converted);
  });
  // Selectie en ontdubbeling gebeuren op de brontekst, zodat de vertaling de keuze
  // van de 885 recepten nooit kan veranderen.
  if(imported.length!==885)throw new Error(`Expected 885 licensed recipe imports, found ${imported.length}`);
  const withoutTranslation=imported.filter(recipe=>!dutchTranslations.has(String(recipe.id)));
  if(withoutTranslation.length)throw new Error(`Ontbrekende Nederlandse vertaling voor ${withoutTranslation.length} geïmporteerde recepten (bijvoorbeeld id ${withoutTranslation[0].id}). Draai scripts/merge-recipe-translations.py.`);
  // Een vertaalde naam mag niet samenvallen met een bestaand recept; in dat geval
  // blijft de bronnaam staan, zodat elk recept een eigen naam houdt.
  const taken=new Set(existingRecipes.map(recipe=>normalizedName(recipe.name)));
  return imported.map(recipe=>{
    const translated=dutchRecipe(recipe);
    const key=normalizedName(translated.name);
    if(taken.has(key))return {...translated,name:recipe.name,translatedNameKept:recipe.name};
    taken.add(key);
    return translated;
  });
}

module.exports=createOpenRecipes;
module.exports.dutchRecipe=dutchRecipe;
module.exports.translationCount=dutchTranslations.size;
module.exports.wikibooksIngredient=wikibooksIngredient;
