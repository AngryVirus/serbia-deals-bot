import { requireValue,positive,queryGroups,day,cutoff,currentPrice,bulbQuery,energyQuery,volumeQuery,weightQuery,plumQuery,pestoQuery,freshProduceQuery,freshMeatQuery,relatedChickenQuery,oilQuery,butterQuery } from './domain.js';
const SCHEMA=[
 `CREATE TABLE IF NOT EXISTS sd_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS sd_admin_records(kind TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(kind,key))`,
 `CREATE INDEX IF NOT EXISTS sd_admin_time ON sd_admin_records(kind,at)`,
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
const termPrefixes=prefixes=>{const lengths=new Map();for(const p of prefixes){if(!lengths.has(p.length))lengths.set(p.length,[]);lengths.get(p.length).push(p);}const rootLength=Math.min(3,...prefixes.map(p=>p.length)),roots=[...new Set(prefixes.map(p=>p.slice(0,rootLength)))];return `(substr(e.term,1,${rootLength}) IN (${roots.map(t=>"'"+t+"'").join(',')}) AND (`+[...lengths].map(([length,terms])=>`substr(e.term,1,${length}) IN (${terms.map(t=>"'"+t+"'").join(',')})`).join(' OR ')+'))';};
const hasTerm=condition=>`EXISTS(SELECT 1 FROM sd_terms e WHERE e.offer=o.rowid AND (${condition}))`;
// Preserve boundaries around stock codes (SK24 250ml); only join units to amounts.
const COMPACT_TITLE=(()=>{let sql="replace(replace(replace(lower(o.name),char(9),' '),'  ',' '),'  ',' ')";for(const [from,to] of [[',','.'],['мл','ml'],['кг','kg'],['г','g'],['л','l'],[' ml','ml'],[' kg','kg'],[' cl','cl'],[' g','g'],[' l','l'],[' %','%']])sql=`replace(${sql},'${from}','${to}')`;return "(' '||"+sql+"||' ')";})();
const ENERGY_TYPE=`(${hasTerm("e.term>='energet' AND e.term<'energeu'")} OR (${hasTerm("e.term='energy'")} AND ${hasTerm("e.term IN ('drink','drinks','napitak','pice')")}) OR (${hasTerm("e.term='red'")} AND ${hasTerm("e.term='bull'")}) OR ${hasTerm("e.term='redbull'")} OR lower(trim(json_extract(o.payload,'$.brand'))) IN ('red bull','redbull','guarana','monster','monster energy','hell','hell energy','ultra energy'))`;
const ENERGY=`(${ENERGY_TYPE} AND (NOT ${hasTerm("e.term GLOB '[0-9]*g'")} OR ${hasTerm("e.term GLOB '[0-9]*ml' OR e.term GLOB '[0-9]*l' OR e.term GLOB '[0-9]*cl'")}))`;
const processedPrefixes=['pavl','perec','sos','supa','kisel','paster','marin','pasiran','konzerv','pelat','susen','suseni','pire','namaz','sok','cips','arom','seme','sjeme','sadnic','koncentr','dvopek','oljusten','seckan','plocic','corb','kuvan','posud','testenin','sardin','tunj','skus','filet','pasulj','pec','kecap'];
const PLUM_FOOD=`NOT ${hasTerm(termPrefixes(['rakij','sljivovic','paradajz','rajcic','sljivar','sampon','sapun','balzam','dzem','pekmez','knedl','cokolad','coko','kasic','kasa','hipp','nutrin','fruct','gerber','pouch','pauc','bombon','desert','caj','keks','ovs','ovselin','mlecn','mlekc','obrok','sok','pice','pralin','smooth','voc','cili']))}`;
const PESTO_SAUCE=`NOT ${hasTerm(termPrefixes(['pastet','rolnic','sir','humus','hummus','pile','pizz','cips']))}`;
const FRESH_PRODUCE=`NOT ${hasTerm(termPrefixes(processedPrefixes)+" OR e.term GLOB '[0-9]*ml' OR e.term GLOB '[0-9]*l'")}`;
const preparedMeatPrefixes=['past','kubet','smok','smaz','kitekat','patelin','fryer','sampinjon','deligh','dog','cat','kobasic','salam','virsl','hrenov','bujon','corb','supa','sos','namaz','instant','gotov','sendvic','pizz','hrana','konzerv','pohov','panir','pecen','dimlj','nudl','noodl','popcorn','kokic','clips','zacin','flips','peciv','lisnat','burek','sunk','narezak','delikates','rolnic','kroasan','pita','mesavin','igrack','gumen','zvizd','pse','psi','fix','mack','hrana','drzac','makaz','arom','cips','posebn','pljek','parizer','kuvan','kasic','nutrino','hipp','gril','rostilj','cevap','pljesk','moksi','mack','mac','psa','pedigree','whiskas','friskies'];
const rawMeatPrefixes=['file','batak','karabatak','kril','grud','prs','snic','belo','bijel','meso','svez','svjez','celo','cijel','but','pleck','rebr','vrat','jetr','src','ledj','bubac','bubreg','zelud'];
const CHICKEN_FOOD=`NOT ${hasTerm(termPrefixes(['dog','cat','pse','psa','psi','mack','pedigree','whiskas','frisk','kitekat','moksi','deligh','igrack','gumen','zvizd','drzac','makaz']))}`;
const FRESH_MEAT=`(NOT ${hasTerm(termPrefixes(preparedMeatPrefixes))} AND ${hasTerm("e.term IN ('pile','piletina','curetina','junetina','govedina','svinjetina') OR "+termPrefixes(rawMeatPrefixes))})`;
const PLAIN_OIL=`(${hasTerm("e.term IN ('ulje','ulja')")} AND NOT ${hasTerm(termPrefixes(['grisin','tuna','tunje','riba','sardin','skus','keks','kreker','namaz','sos','majonez','pasta','testen','cips','hrana','sapun','kupk','sampon','losion','kozmet','motor','menjac','hidraul','masaz','eteric','miris','filter','konzerv','mask','kosu','kosa','krem','serum','balzam','regener','gel','tusir','tela','telo','ruke']))})`;
const PLAIN_BUTTER=`NOT ${hasTerm(termPrefixes(['posud','noz','mazal','kutij','tacn','podmet','porcel','stakl','cuv','keks','biskvit','kroasan','peciv','grisin','kokic','popcorn','baget','marg','kikirik','badem','pistac','orah','kokos','kakao']))}`;
export class Store{
 constructor(db){const bound=(sql,p={})=>Object.fromEntries([...sql.matchAll(/:[A-Za-z_]\w*/g)].map(x=>x[0]).filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]));this.db=Object.fromEntries(['run','get','all'].map(method=>[method,(sql,p)=>db[method](sql,bound(sql,p))]));}
 async init(){for(const sql of SCHEMA)await this.db.run(sql);await this.db.run("DELETE FROM sd_admin_records WHERE kind='audit' AND at<:cutoff",{':cutoff':Date.now()-10*86400000});await this.db.run("INSERT INTO sd_meta(key,value) VALUES('users_tracking',:now) ON CONFLICT DO NOTHING",{':now':JSON.stringify(Date.now())});}
 async meta(key){const row=await this.db.get('SELECT value FROM sd_meta WHERE key=:key',{':key':key});return row?JSON.parse(row.value):null;}
 async setMeta(key,value){await this.db.run('INSERT INTO sd_meta(key,value) VALUES(:key,:value) ON CONFLICT(key) DO UPDATE SET value=excluded.value',{':key':key,':value':JSON.stringify(value)});}
 async user(uid){const row=await this.db.get('SELECT * FROM sd_users WHERE id=:uid',{':uid':uid});return row?{...row,...JSON.parse(row.payload)}:null;}
 async ensure(uid){requireValue(positive(uid));await this.db.run('INSERT INTO sd_users(id,payload) VALUES(:uid,:payload) ON CONFLICT DO NOTHING',{':uid':uid,':payload':JSON.stringify({first_seen:Date.now(),first_day:day()})});return this.user(uid);}
 async patch(uid,fields){
  const keys=Object.keys(fields);if(!keys.length)return;
  requireValue(keys.every(key=>/^[A-Za-z][A-Za-z0-9_]*$/.test(key)));
  const params={':uid':uid,':fields':JSON.stringify(fields)},paths=keys.map((key,i)=>{params[':path'+i]='$.'+key;return ':path'+i;});
  // Replace supplied top-level objects atomically; json_patch alone recursively
  // merges empty objects and resurrects removed filter/draft selections.
  await this.db.run(`UPDATE sd_users SET payload=json_patch(json_remove(payload,${paths.join(',')}),:fields) WHERE id=:uid`,params);
 }
 async rate(uid,now=Date.now()){
  const id='search:'+uid,result=await this.db.run(`INSERT INTO sd_rates(id,n,expires) VALUES(:id,1,:end) ON CONFLICT(id) DO UPDATE SET n=CASE WHEN expires<=:now THEN 1 ELSE n+1 END,expires=CASE WHEN expires<=:now THEN :end ELSE expires END WHERE expires<=:now OR n<20`,{':id':id,':end':now+60000,':now':now});
  if(result.rowsAffected===1)return 0;const row=await this.db.get('SELECT expires FROM sd_rates WHERE id=:id',{':id':id});return Math.max(1,Math.ceil((row.expires-now)/1000));
 }
 async searchPlan(query,now=Date.now(),source=null,filters={}){
  const groups=queryGroups(query),params={':today':day(now),':cutoff':cutoff(now),':offset':0};
  const exact=token=>['so','sir','med','luk','sok','cola','kola','pivo','vino'].includes(token)||/^(?:e\d+|gu\d+|g\d+|\d+(?:w|lm|k|kg|g|ml|l)|\d{8,14})$/.test(token);
  const range=(alias,key,token)=>exact(token)?`${alias}.term=:${key}`:`(${alias}.term>=:${key} AND ${alias}.term<:${key}end)`;
  const clauses=groups.map((group,i)=>{const ranges=group.map((token,j)=>{const key='g'+i+'_'+j;params[':'+key]=token;params[':'+key+'end']=token+'\uffff';return range('t',key,token);});return `EXISTS(SELECT 1 FROM sd_terms t WHERE t.offer=o.rowid AND (${ranges.join(' OR ')}))`;});
  const anchors=groups[0].map((token,j)=>range('a','g0_'+j,token)).join(' OR ');
  if(source){requireValue(/^[a-f0-9]{24}$/.test(source));params[':source']=source;}
  const volume=volumeQuery(query)||weightQuery(query);let volumeClause='';if(volume){volumeClause=' AND ('+volume.forms.map((form,i)=>{params[':volume'+i]='*[^0-9.]'+form+'[^a-z0-9]*';return COMPACT_TITLE+' GLOB :volume'+i;}).join(' OR ')+')';}
  let refinement='';
  if(typeof filters.brand==='string'&&filters.brand.length<=80){params[':brand']=filters.brand;refinement+=" AND json_extract(o.payload,'$.brand')=:brand";}
  if(Array.isArray(filters.type)&&filters.type.length<=4&&filters.type.every(t=>/^[a-z]{2,20}$/.test(t))){refinement+=' AND '+hasTerm(filters.type.map((t,i)=>{params[':type'+i]=t;params[':typeend'+i]=t+'\uffff';return `(e.term>=:type${i} AND e.term<:typeend${i})`;}).join(' OR '));}
  if(typeof filters.socket==='string'&&/^(E14|E27|GU10|G9|G4|H4|H7)$/i.test(filters.socket)){params[':socket']=filters.socket;refinement+=" AND json_extract(o.payload,'$.traits.socket')=:socket";}
  const compact=COMPACT_TITLE;
  if(filters.pack&&['volume','weight'].includes(filters.pack.kind)&&Number.isInteger(filters.pack.amount)&&filters.pack.amount>0&&filters.pack.amount<=100000){const n=filters.pack.amount,forms=filters.pack.kind==='volume'?[n+'ml',(n/1000)+'l',(n/10)+'cl']:[n+'g',(n/1000)+'kg'];refinement+=' AND ('+forms.map((f,i)=>{params[':pack'+i]='*[^0-9.]'+f+'[^a-z0-9]*';return compact+' GLOB :pack'+i;}).join(' OR ')+')';}
  if(typeof filters.fat==='string'&&/^\d+(?:\.\d+)?$/.test(filters.fat)){params[':fat']='*[^0-9.]'+filters.fat+'%*';refinement+=' AND '+compact+' GLOB :fat';}
  return {params,sql:`SELECT DISTINCT o.id,o.product,o.source AS source_id,o.payload,s.name AS source_name,s.url AS source_url,s.checked AS downloaded,${PRICE} AS price FROM sd_terms a CROSS JOIN sd_offers o CROSS JOIN sd_sources s WHERE o.rowid=a.offer AND s.id=o.source AND s.current_gen=o.gen AND o.date>=:cutoff AND o.date<=:today AND (${anchors}) ${bulbQuery(query)?"AND json_extract(o.payload,'$.traits.kind')='bulb'":''} ${energyQuery(query)?'AND '+ENERGY:''} ${freshProduceQuery(query)?'AND '+FRESH_PRODUCE:''} ${plumQuery(query)?'AND '+PLUM_FOOD:''} ${pestoQuery(query)?'AND '+PESTO_SAUCE:''} ${relatedChickenQuery(query)?'AND '+CHICKEN_FOOD:''} ${freshMeatQuery(query)?'AND '+FRESH_MEAT:''} ${oilQuery(query)?'AND '+PLAIN_OIL:''} ${butterQuery(query)?'AND '+PLAIN_BUTTER:''} ${clauses.length>1?'AND '+clauses.slice(1).join(' AND '):''} ${volumeClause} ${refinement} ${source?'AND o.source=:source':''}`};
 }
 async search(query,offset=0,now=Date.now()){
  const plan=await this.searchPlan(query,now);plan.params[':offset']=Math.min(1000,Math.max(0,offset));
  return this.db.all(plan.sql+' ORDER BY price,o.id LIMIT 6 OFFSET :offset',plan.params);
 }
 async searchChains(query,now=Date.now(),filters={}){
  const plan=await this.searchPlan(query,now,null,filters);
  return this.db.all(`WITH matches AS (${plan.sql}) SELECT source_id,source_name,MIN(price) AS min_price,MAX(price) AS max_price,COUNT(*) AS offers FROM matches GROUP BY source_id,source_name ORDER BY min_price,source_name LIMIT 100`,plan.params);
 }
 async searchChain(query,source,offset=0,now=Date.now(),filters={}){
  const plan=await this.searchPlan(query,now,source,filters);plan.params[':offset']=Math.min(1000,Math.max(0,offset));
  return this.db.all(`WITH matches AS (${plan.sql}), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY product ORDER BY price,id) AS position,MIN(price) OVER(PARTITION BY product) AS min_price,MAX(price) OVER(PARTITION BY product) AS max_price FROM matches) SELECT * FROM ranked WHERE position=1 ORDER BY price,id LIMIT 6 OFFSET :offset`,plan.params);
 }
 async refinementSamples(query,now=Date.now(),filters={}){
  const plan=await this.searchPlan(query,now,null,filters);return this.db.all(plan.sql+' LIMIT 120',plan.params);
 }
 async basketCandidates(query,now=Date.now()){
  const plan=await this.searchPlan(query,now);
  return this.db.all(`WITH matches AS (${plan.sql}), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY source_id,json_extract(payload,'$.format') ORDER BY price,id) AS position FROM matches) SELECT payload,source_name FROM ranked WHERE position=1 LIMIT 101`,plan.params);
 }
 async productLocations(product,source,now=Date.now()){
  return this.db.all(`SELECT json_extract(o.payload,'$.format') AS name,MIN(${PRICE}) AS price FROM sd_offers o ${ACTIVE} AND o.product=:product AND o.source=:source GROUP BY json_extract(o.payload,'$.format') ORDER BY price,json_extract(o.payload,'$.format') LIMIT 21`,{':product':product,':source':source,':today':day(now),':cutoff':cutoff(now)});
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
 async catalogHealth(now=Date.now()){return this.db.get('SELECT COUNT(*) AS active,COALESCE(SUM(date>=:cutoff AND date<=:today),0) AS fresh,MAX(CASE WHEN date<=:today THEN date END) AS latest FROM sd_sources WHERE current_gen IS NOT NULL',{':cutoff':cutoff(now),':today':day(now)});}
 async sources(){return this.db.all('SELECT id,name,url,date,checked,status,current_gen,current_gen IS NOT NULL AS active FROM sd_sources ORDER BY name');}
}
