import { requireValue,day,cutoff,emptyQuality,auditOffer,measuredOffer } from './domain.js';
export async function indexMeasures(db,source,gen,offers){
 if(!offers.length)return;
 const params={':rows':JSON.stringify(offers.map(measuredOffer)),':source':source,':gen':gen};
 await db.run("INSERT INTO sd_offers(source,gen,id,product,name,regular,discount,begin,end,date,payload) SELECT o.source,o.gen,o.id,o.product,o.name,o.regular,o.discount,o.begin,o.end,o.date,json_set(o.payload,'$._measure',json_extract(r.value,'$._measure')) FROM json_each(:rows) r CROSS JOIN sd_offers o WHERE o.source=:source AND o.gen=:gen AND o.id=json_extract(r.value,'$.id') ON CONFLICT(source,gen,id) DO UPDATE SET payload=excluded.payload",params);
 await db.run("INSERT INTO sd_terms(offer,term) SELECT o.rowid,t.value FROM json_each(:rows) r CROSS JOIN sd_offers o CROSS JOIN json_each(r.value,'$.terms') t WHERE o.source=:source AND o.gen=:gen AND o.id=json_extract(r.value,'$.id') ON CONFLICT DO NOTHING",params);
}
async function cleanupGeneration(store,source,gen){
 const db=store.db,p={':source':source,':gen':gen};
 const state=await db.get('SELECT current_gen,stage_gen FROM sd_sources WHERE id=:source',p);
 requireValue(gen!==state?.current_gen&&gen!==state?.stage_gen,'Cannot clean a live generation');
 const rows=await db.all('SELECT rowid AS id FROM sd_offers WHERE source=:source AND gen=:gen LIMIT 250',p);
 if(rows.length){const ids={':ids':JSON.stringify(rows.map(r=>r.id))};await db.run('DELETE FROM sd_terms WHERE offer IN(SELECT value FROM json_each(:ids))',ids);await db.run('DELETE FROM sd_offers WHERE rowid IN(SELECT value FROM json_each(:ids))',ids);return false;}
 await db.run('DELETE FROM sd_chunks WHERE source=:source AND gen=:gen',p);return true;
}
export async function ingest(store,input){
 const {operation,source,gen,owner}=input;
 requireValue(/^[a-f0-9]{24}$/.test(source||'')&&/^[a-f0-9]{32}$/.test(gen||'')&&/^[a-f0-9-]{36}$/.test(owner||''));
 const db=store.db,now=Date.now(),p={':source':source,':gen':gen,':owner':owner,':now':now};
 const cleanupKey='cleanup:'+source;
 const pending=async()=>{const value=await store.meta(cleanupKey);return Array.isArray(value)?value:value?[value]:[];};
 const enqueue=async old=>{const list=await pending();if(old&&!list.includes(old))await store.setMeta(cleanupKey,[...list,old]);};
 const clean=async()=>{let list=await pending();const live=await db.get('SELECT current_gen,stage_gen FROM sd_sources WHERE id=:source',p);const safe=list.filter(g=>g!==live?.current_gen&&g!==live?.stage_gen);if(safe.length!==list.length){list=safe;await store.setMeta(cleanupKey,list);}if(!list.length)return false;const done=await cleanupGeneration(store,source,list[0]);if(done){await db.run('DELETE FROM sd_meta WHERE key=:key',{':key':'catalog_count:'+source+':'+list[0]});list.shift();await store.setMeta(cleanupKey,list);}return !done||list.length>0;};
 if(operation==='cleanup'){
  const lock=await db.run('UPDATE sd_sources SET owner=:owner,lease=:lease WHERE id=:source AND (owner IS NULL OR owner=:owner OR lease<=:now)',{...p,':lease':now+120000});
  requireValue(lock.rowsAffected===1,'Source busy');
  try{return {cleanup:await clean()};}finally{await db.run('UPDATE sd_sources SET owner=NULL,lease=NULL WHERE id=:source AND owner=:owner AND stage_gen IS NULL',p);}
 }
 if(operation==='begin'){
  requireValue(typeof input.name==='string'&&input.name.length<=160&&Number.isSafeInteger(input.chunks)&&input.chunks>0&&input.chunks<=5000);
  requireValue(input.url===`https://data.gov.rs/sr/datasets/${source}/`&&/^\d{4}-\d{2}-\d{2}$/.test(input.date)&&input.date>=cutoff(now)&&input.date<=day(now));
  const previous=await db.get('SELECT * FROM sd_sources WHERE id=:source',p);
  await db.run(`INSERT INTO sd_sources(id,name,url,stage_gen,expected,owner,lease,date) VALUES(:source,:name,:url,:gen,:expected,:owner,:lease,:date) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,stage_gen=excluded.stage_gen,expected=excluded.expected,owner=excluded.owner,lease=excluded.lease WHERE sd_sources.lease<=:now OR sd_sources.lease IS NULL OR sd_sources.owner=:owner`,{...p,':name':input.name,':url':input.url,':expected':input.chunks,':lease':now+120000,':date':input.date});
  const state=await db.get('SELECT * FROM sd_sources WHERE id=:source',p);
  requireValue(state.owner===owner,'Source busy');
  if(state.current_gen===gen){await db.run("UPDATE sd_sources SET stage_gen=NULL,lease=NULL,owner=NULL,checked=:now,status='ok' WHERE id=:source AND owner=:owner",p);return {unchanged:true};}
  if(previous?.stage_gen&&previous.stage_gen!==gen&&previous.stage_gen!==previous.current_gen)await enqueue(previous.stage_gen);
  if(await clean())return {cleanup:true};
  const done=await db.all('SELECT part FROM sd_chunks WHERE source=:source AND gen=:gen',p);
  return {done:done.map(x=>x.part)};
 }
 const state=await db.get('SELECT * FROM sd_sources WHERE id=:source',p);
 requireValue(state?.owner===owner&&state.stage_gen===gen&&state.lease>now,'Source lease expired');
 await db.run('UPDATE sd_sources SET lease=:lease WHERE id=:source AND owner=:owner',{...p,':lease':now+120000});
 if(operation==='chunk'){
  requireValue(Number.isInteger(input.part)&&input.part>=0&&input.part<state.expected&&Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=600);
  for(const row of input.rows){
   requireValue(row.source===source&&/^[a-f0-9]{32}$/.test(row.id)&&typeof row.name==='string'&&row.name.length<=300&&typeof row.product==='string'&&row.product.length<=50);
   requireValue(Number.isSafeInteger(row.regular)&&row.regular>0&&row.regular<=1e9&&(!row.discount||Number.isSafeInteger(row.discount)&&row.discount>0&&row.discount<row.regular));
   requireValue(row.date>=cutoff(now)&&row.date<=day(now)&&Array.isArray(row.terms)&&row.terms.length<=35&&row.terms.every(t=>typeof t==='string'&&t.length<=100));
  }
  const rows=JSON.stringify(input.rows.map(measuredOffer));requireValue(rows.length<1200000);
  await db.run(`INSERT INTO sd_offers(source,gen,id,product,name,regular,discount,begin,end,date,payload) SELECT :source,:gen,json_extract(value,'$.id'),json_extract(value,'$.product'),json_extract(value,'$.name'),json_extract(value,'$.regular'),json_extract(value,'$.discount'),json_extract(value,'$.begin'),json_extract(value,'$.end'),json_extract(value,'$.date'),json_remove(value,'$.terms','$.norm') FROM json_each(:rows) WHERE 1 ON CONFLICT(source,gen,id) DO UPDATE SET payload=excluded.payload,regular=excluded.regular,discount=excluded.discount,begin=excluded.begin,end=excluded.end`,{...p,':rows':rows});
  // CROSS JOIN fixes the loop order: one indexed offer lookup per input row.
  // Letting SQLite start from all source offers makes a large import quadratic.
  await db.run(`INSERT INTO sd_terms(offer,term) SELECT o.rowid,t.value FROM json_each(:rows) r CROSS JOIN sd_offers o CROSS JOIN json_each(r.value,'$.terms') t WHERE o.source=:source AND o.gen=:gen AND o.id=json_extract(r.value,'$.id') AND length(t.value)<=100 ON CONFLICT DO NOTHING`,{...p,':rows':rows});
  await db.run('INSERT INTO sd_chunks(source,gen,part) VALUES(:source,:gen,:part) ON CONFLICT DO NOTHING',{...p,':part':input.part});
  return {accepted:input.rows.length};
 }
 if(operation==='finish'){
  const count=await db.get('SELECT COUNT(*) AS n FROM sd_chunks WHERE source=:source AND gen=:gen',p);
  requireValue(count.n===state.expected&&Number.isInteger(input.count)&&input.count>0,'Incomplete source upload');
  const verifyKey='verify:'+source;
  let check=await store.meta(verifyKey);
  if(check?.gen!==gen||!check.quality)check={gen,after:'',count:0,date:'',quality:emptyQuality()};
  const page=await db.all('SELECT o.id,o.date,o.payload,old.name AS previous_name,old.regular AS previous_regular FROM sd_offers o LEFT JOIN sd_offers old ON old.source=:source AND old.gen=:previous AND old.id=o.id WHERE o.source=:source AND o.gen=:gen AND o.id>:after ORDER BY o.id LIMIT 1000',{...p,':after':check.after,':previous':state.current_gen});
  const legacy=page.map(row=>JSON.parse(row.payload)).filter(offer=>!Object.hasOwn(offer,'_measure'));
  await indexMeasures(db,source,gen,legacy);
  for(const row of page){check.after=row.id;check.count++;auditOffer(check.quality,JSON.parse(row.payload),{name:row.previous_name,regular:row.previous_regular});if(row.date>check.date)check.date=row.date;}
  await store.setMeta(verifyKey,check);
  if(page.length===1000)return {verifying:true,count:check.count};
  requireValue(check.count===input.count,'Offer count mismatch');
  const offers={n:check.count},snapshot={date:check.date};
  await store.setMeta('catalog_count:'+source+':'+gen,offers.n);
  const previousCount=state.current_gen?await store.meta('catalog_count:'+source+':'+state.current_gen):null;
  await store.setMeta('catalog_quality:'+source,{gen,date:check.date,checked:now,...check.quality,coverage_drop:previousCount>100&&offers.n<previousCount/2});
  if(state.current_gen&&state.current_gen!==gen)await enqueue(state.current_gen);
  const result=await db.run(`UPDATE sd_sources SET current_gen=:gen,stage_gen=NULL,lease=NULL,owner=NULL,date=:date,checked=:now,status='ok' WHERE id=:source AND owner=:owner AND stage_gen=:gen AND lease>:now`,{...p,':date':snapshot.date});requireValue(result.rowsAffected===1,'Publication lost lease');
  return {published:true,count:offers.n};
 }
 throw Error('Unknown import operation');
}
