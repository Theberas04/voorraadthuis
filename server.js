const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('node:sqlite');
const { URL } = require('node:url');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'voorraad.db');
fs.mkdirSync(path.dirname(DB_PATH), {recursive:true});
const db = new sqlite3.DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, barcode TEXT UNIQUE, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT 'stuks', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS shopping(id INTEGER PRIMARY KEY, product_id INTEGER UNIQUE, name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT 'stuks')`);
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>100000)reject(Error('payload too large'));});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch{reject(Error('invalid JSON'));}});});}
function products(){return db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all();}
function shopping(){return db.prepare('SELECT * FROM shopping ORDER BY name COLLATE NOCASE').all();}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');try{
 if(url.pathname==='/api/products'&&req.method==='GET')return json(res,200,products());
 if(url.pathname==='/api/shopping'&&req.method==='GET')return json(res,200,shopping());
 if(url.pathname==='/api/products'&&req.method==='POST'){const x=await body(req);const name=String(x.name||'').trim();const barcode=String(x.barcode||'').trim()||null;const quantity=Number(x.quantity??1);const unit=String(x.unit||'stuks').trim();if(!name||name.length>120||!Number.isFinite(quantity)||quantity<=0||quantity>100000||unit.length>24)return json(res,400,{error:'Controleer naam, hoeveelheid en eenheid.'});try{const result=db.prepare('INSERT INTO products(name,barcode,quantity,unit) VALUES(?,?,?,?) ON CONFLICT(barcode) DO UPDATE SET name=excluded.name, quantity=products.quantity+excluded.quantity, updated_at=CURRENT_TIMESTAMP').run(name,barcode,quantity,unit);return json(res,201,db.prepare('SELECT * FROM products WHERE id=? OR barcode=?').get(Number(result.lastInsertRowid),barcode));}catch(e){return json(res,409,{error:'Barcode is al gekoppeld aan een ander product.'});}}
 let m=url.pathname.match(/^\/api\/products\/(\d+)$/);if(m&&req.method==='PATCH'){const id=Number(m[1]),x=await body(req);if(x.action==='consume'){const p=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!p)return json(res,404,{error:'Product niet gevonden.'});db.prepare('DELETE FROM products WHERE id=?').run(id);db.prepare('INSERT INTO shopping(product_id,name,quantity,unit) VALUES(?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET quantity=shopping.quantity+excluded.quantity').run(id,p.name,p.quantity,p.unit);return json(res,200,{ok:true});}if(x.action==='restore'){const p=db.prepare('SELECT * FROM shopping WHERE id=?').get(id);if(!p)return json(res,404,{error:'Product niet gevonden.'});db.prepare('INSERT INTO products(name,quantity,unit) VALUES(?,?,?)').run(p.name,p.quantity,p.unit);db.prepare('DELETE FROM shopping WHERE id=?').run(id);return json(res,200,{ok:true});}}
 m=url.pathname.match(/^\/api\/shopping\/(\d+)$/);if(m&&req.method==='DELETE'){db.prepare('DELETE FROM shopping WHERE id=?').run(Number(m[1]));return json(res,200,{ok:true});}
 if(url.pathname==='/api/shopping'&&req.method==='POST'){const x=await body(req);const name=String(x.name||'').trim(),quantity=Number(x.quantity??1),unit=String(x.unit||'stuks').trim();if(!name||!Number.isFinite(quantity)||quantity<=0)return json(res,400,{error:'Ongeldig product.'});db.prepare('INSERT INTO shopping(name,quantity,unit) VALUES(?,?,?)').run(name,quantity,unit);return json(res,201,{ok:true});}
 if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{status:'ok'});
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return fs.createReadStream(path.join(__dirname,'public','index.html')).pipe(res);}
 res.writeHead(404);res.end('Not found');
 }catch(e){json(res,400,{error:e.message||'Fout'});}});
if(require.main===module)server.listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log(`VoorraadThuis luistert op ${process.env.HOST||'0.0.0.0'}:${process.env.PORT||3000}`));
module.exports={server,db};
