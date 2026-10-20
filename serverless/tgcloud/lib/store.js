import { requireValue,positive,queryGroups,day,cutoff,currentPrice,bulbQuery,energyQuery,freshProduceQuery } from './domain.js';
const SCHEMA=[
 `CREATE TABLE IF NOT EXISTS sd_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS sd_users(id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,blocked INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL DEFAULT '{}')`,
 `CREATE TABLE IF NOT EXISTS sd_rates(id TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS sd_updates(id TEXT PRIMARY KEY,expires INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS sd_locks(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS sd_sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,current_gen TEXT,stage_gen TEXT,expected INTEGER,owner TEXT,lease INTEGER,date TEXT,checked INTEGER,status TEXT NOT NULL DEFAULT 'pending')`,
 `CREATE TABLE IF NOT EXISTS sd_offers(source TEXT NOT NULL,gen TEXT NOT NULL,id TEXT NOT NULL,product TEXT NOT NULL,name TEXT NOT NULL,regular INTEGER NOT NULL,discount INTEGER,begin TEXT,end TEXT,date TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source,gen,id))`,
 `CREATE INDEX IF NOT EXISTS sd_product ON sd_offers(product,source,gen)`,
 `CREATE INDEX IF NOT EXISTS sd_offer_id ON sd_offers(id,source,gen)`,
 `CREATE TABLE IF NOT EXISTS sd_terms(offer INTEGER NOT NULL,term TEXT NOT NULL,PRIMARY KEY(term,offer)) WITHOUT ROWID`,
 `CREATE INDEX IF NOT EXISTS sd_terms_cleanup ON sd_terms(offer)`,
 `CREATE TABLE IF NOT EXISTS sd_chunks(source TEXT NOT NULL,gen TEXT NOT NULL,part INTEGER NOT NULL,PRIMARY KEY(source,gen,part))`,
 `CREATE TABLE IF NOT EXISTS sd_watches(uid INTEGER NOT NULL,product TEXT NOT NULL,name TEXT NOT NULL,baseline INTEGER NOT NULL,PRIMARY KEY(uid,product))`,
 `CREATE TABLE IF NOT EXISTS sd_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,uid INTEGER NOT NULL,product TEXT NOT NULL,price INTEGER NOT NULL,offer TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',after INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,UNIQUE(uid,product,price,created))`,
 `CREATE INDEX IF NOT EXISTS sd_queue_pending ON sd_queue(state,after,id)`
];
export const PRICE=`CASE WHEN o.discount IS NOT NULL AND o.begin<=:today AND (o.end>=:today OR o.end IS NULL AND o.date=:today) THEN o.discount ELSE o.regular END`;
export const ACTIVE=`JOIN sd_sources s ON s.id=o.source AND s.current_gen=o.gen WHERE o.date>=:cutoff AND o.date<=:today`;
const hasTerm=condition=>`EXISTS(SELECT 1 FROM sd_terms e WHERE e.offer=o.rowid AND (${condition}))`;
const ENERGY=`(${hasTerm("e.term>='energet' AND e.term<'energeu' OR e.term>='energij' AND e.term<'energik'")} OR (${hasTerm("e.term='energy'")} AND ${hasTerm("e.term IN ('drink','drinks','napitak','pice')")}) OR (${hasTerm("e.term='red'")} AND ${hasTerm("e.term='bull'")}) OR ${hasTerm("e.term='redbull'")} OR lower(trim(json_extract(o.payload,'$.brand'))) IN ('red bull','redbull','guarana','monster','monster energy','hell','hell energy','ultra energy'))`;
const processedPrefixes=['pavlak','sos','supa','kisel','paster','marin','pasiran','konzerv','pelat','susen','suseni','pire','namaz','sok','cips','arom','seme','sjeme','sadnic','koncentr','dvopek','oljusten','seckan','plocic','corb','kuvan','posud','testenin','sardin','tunj','skus','filet','pasulj','pec','kecap'];
const FRESH_PRODUCE=`NOT ${hasTerm(processedPrefixes.map(t=>`e.term>='${t}' AND e.term<'${t}\uffff'`).join(' OR ')+" OR e.term GLOB '[0-9]*ml' OR e.term GLOB '[0-9]*l'")}`;
export class Store{
 constructor(db){const bound=(sql,p={})=>Object.fromEntries([...sql.matchAll(/:[A-Za-z_]\w*/g)].map(x=>x[0]).filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]));this.db=Object.fromEntries(['run','get','all'].map(method=>[method,(sql,p)=>db[method](sql,bound(sql,p))]));}
 async init(){for(const sql of SCHEMA)await this.db.run(sql);}
 async meta(key){const row=await this.db.get('SELECT value FROM sd_meta WHERE key=:key',{':key':key});return row?JSON.parse(row.value):null;}
 async setMeta(key,value){await this.db.run('INSERT INTO sd_meta(key,value) VALUES(:key,:value) ON CONFLICT(key) DO UPDATE SET value=excluded.value',{':key':key,':value':JSON.stringify(value)});}
 async user(uid){const row=await this.db.get('SELECT * FROM sd_users WHERE id=:uid',{':uid':uid});return row?{...row,...JSON.parse(row.payload)}:null;}
 async ensure(uid){requireValue(positive(uid));await this.db.run('INSERT INTO sd_users(id) VALUES(:uid) ON CONFLICT DO NOTHING',{':uid':uid});return this.user(uid);}
 async patch(uid,fields){await this.db.run('UPDATE sd_users SET payload=json_patch(payload,:fields) WHERE id=:uid',{':uid':uid,':fields':JSON.stringify(fields)});}
 async rate(uid,now=Date.now()){
  const id='search:'+uid,result=await this.db.run(`INSERT INTO sd_rates(id,n,expires) VALUES(:id,1,:end) ON CONFLICT(id) DO UPDATE SET n=CASE WHEN expires<=:now THEN 1 ELSE n+1 END,expires=CASE WHEN expires<=:now THEN :end ELSE expires END WHERE expires<=:now OR n<20`,{':id':id,':end':now+60000,':now':now});
  if(result.rowsAffected===1)return 0;const row=await this.db.get('SELECT expires FROM sd_rates WHERE id=:id',{':id':id});return Math.max(1,Math.ceil((row.expires-now)/1000));
 }
 async search(query,offset=0,now=Date.now()){
  const groups=queryGroups(query),params={':today':day(now),':cutoff':cutoff(now),':offset':Math.min(1000,Math.max(0,offset))};
  const exact=token=>['so','sir','med','luk','sok','cola','kola','pivo','vino'].includes(token)||/^(?:e\d+|gu\d+|g\d+|\d+(?:w|lm|k|kg|g|ml|l)|\d{8,14})$/.test(token);
  const range=(alias,key,token)=>exact(token)?`${alias}.term=:${key}`:`(${alias}.term>=:${key} AND ${alias}.term<:${key}end)`;
  const clauses=groups.map((group,i)=>{const ranges=group.map((token,j)=>{const key='g'+i+'_'+j;params[':'+key]=token;params[':'+key+'end']=token+'\uffff';return range('t',key,token);});return `EXISTS(SELECT 1 FROM sd_terms t WHERE t.offer=o.rowid AND (${ranges.join(' OR ')}))`;});
  const anchors=groups[0].map((token,j)=>range('a','g0_'+j,token)).join(' OR ');
  return this.db.all(`SELECT DISTINCT o.payload,s.name AS source_name,s.url AS source_url,s.checked AS downloaded,${PRICE} AS price FROM sd_terms a JOIN sd_offers o ON o.rowid=a.offer ${ACTIVE} AND (${anchors}) ${bulbQuery(query)?"AND json_extract(o.payload,'$.traits.kind')='bulb'":''} ${energyQuery(query)?'AND '+ENERGY:''} ${freshProduceQuery(query)?'AND '+FRESH_PRODUCE:''} ${clauses.length>1?'AND '+clauses.slice(1).join(' AND '):''} ORDER BY price,o.id LIMIT 6 OFFSET :offset`,params);
 }
 async offer(id,now=Date.now()){
  if(!/^[a-f0-9]{32}$/.test(id||''))return null;
  return this.db.get(`SELECT o.payload,s.name AS source_name,s.url AS source_url,s.checked AS downloaded,${PRICE} AS price FROM sd_offers o ${ACTIVE} AND o.id=:id ORDER BY price LIMIT 1`,{':id':id,':today':day(now),':cutoff':cutoff(now)});
 }
 async cheapest(product,now=Date.now()){return this.db.get(`SELECT o.payload,s.name AS source_name,s.url AS source_url,s.checked AS downloaded,${PRICE} AS price FROM sd_offers o ${ACTIVE} AND o.product=:product ORDER BY price,o.id LIMIT 1`,{':product':product,':today':day(now),':cutoff':cutoff(now)});}
 async watch(uid,id){const row=await this.offer(id);if(!row)return false;const offer=JSON.parse(row.payload);const best=await this.cheapest(offer.product);
  await this.db.run(`INSERT INTO sd_watches(uid,product,name,baseline) SELECT :uid,:product,:name,:price WHERE (SELECT COUNT(*) FROM sd_watches WHERE uid=:uid)<100 ON CONFLICT(uid,product) DO NOTHING`,{':uid':uid,':product':offer.product,':name':offer.name,':price':best.price});return true;
 }
 async watches(uid){return this.db.all('SELECT product,name,baseline FROM sd_watches WHERE uid=:uid ORDER BY name LIMIT 100',{':uid':uid});}
 async removeWatch(uid,product){await this.db.run('DELETE FROM sd_watches WHERE uid=:uid AND product=:product',{':uid':uid,':product':product});await this.db.run("UPDATE sd_queue SET state='cancelled' WHERE uid=:uid AND product=:product AND state='pending'",{':uid':uid,':product':product});}
 async deleteUser(uid){await this.db.run('DELETE FROM sd_watches WHERE uid=:uid',{':uid':uid});await this.db.run('DELETE FROM sd_queue WHERE uid=:uid',{':uid':uid});await this.db.run('DELETE FROM sd_rates WHERE id=:key',{':key':'search:'+uid});await this.db.run('DELETE FROM sd_updates WHERE id LIKE :prefix',{':prefix':uid+':%'});await this.db.run('DELETE FROM sd_users WHERE id=:uid',{':uid':uid});}
 async sources(){return this.db.all('SELECT id,name,url,date,checked,status,current_gen,current_gen IS NOT NULL AS active FROM sd_sources ORDER BY name');}
}
