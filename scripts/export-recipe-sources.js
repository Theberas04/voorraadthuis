#!/usr/bin/env node
/* Schrijft de geïmporteerde recepten uit de open bronnen naar één bestand, zodat de
   vertaalpijplijn op precies dezelfde tekst werkt als de app gebruikt.
   Gebruik: node scripts/export-recipe-sources.js <uitvoerbestand> */
const fs=require('node:fs');
const path=require('node:path');
const {collectImports}=require('../recipes-open');

const serverBron=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const ingebouwd=[...serverBron.matchAll(/\{id:\d+,name:'([^']+)'/g)].map(match=>({name:match[1]}));
const internationaal=require('../recipes-international');
const recepten=[...ingebouwd,...internationaal.map(recipe=>({name:recipe.name}))];
if(recepten.length!==115)throw new Error(`Verwacht 115 eigen recepten, gevonden ${recepten.length}`);

// Recepten die al Nederlands zijn (het Nederlandse Wikibooks-kookboek) hoeven niet
// vertaald te worden en horen dus niet in de vertaalpijplijn.
const imports=collectImports(recepten).filter(recipe=>!recipe.alNederlands).map(recipe=>({
  key:recipe.sourceKey,
  language:recipe.language,
  source:recipe.source.name,
  name:recipe.name,
  cuisine:recipe.cuisine,
  description:recipe.description,
  ingredients:recipe.ingredients.map(ingredient=>({name:ingredient.name,...(ingredient.display!=null?{display:ingredient.display}:{})})),
  steps:recipe.steps,
}));
const uit=process.argv[2];
if(!uit)throw new Error('Geef een uitvoerbestand op.');
fs.writeFileSync(uit,JSON.stringify(imports,null,1));
const perBron=imports.reduce((totaal,recipe)=>{totaal[recipe.source]=(totaal[recipe.source]||0)+1;return totaal},{});
const tekens=JSON.stringify(imports).length;
console.log(JSON.stringify({bestand:uit,records:imports.length,per_bron:perBron,totaal_tekens:tekens,gemiddeld:Math.round(tekens/imports.length)},null,1));