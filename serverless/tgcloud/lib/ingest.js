import { requireValue,day,cutoff } from './domain.js';
import { Store } from './store.js';
export async function ingest(store,input){
 const {operation,source,gen,owner}=input;
 requireValue(/^[a-f0-9]{24}$/.test(source||'')&&/^[a-f0-9]{32}$/.test(gen||'')&&/^[a-f0-9-]{36}$/.test(owner||''));
 const db=store.db,now=Date.now(),p={':source':source,':gen':gen,':owner':owner,':now':now};
 if(operation==='begin'){
  requireValue(typeof input.name==='string'&&input.name.length<=160&&Number.isSafeInteger(input.chunks)&&input.chunks>0&&input.chunks<=5000);
  requireValue(input.url===`https://data.gov.rs/sr/datasets/${source}/`&&/^\d{4}-\d{2}-\d{2}$/.test(input.date)&&input.date>=cutoff(now)&&input.date<=day(now));
  await db.run(`INSERT INTO sd_sources(id,name,url,stage_gen,expected,owner,lease,date) VALUES(:source,:name,:url,:gen,:expected,:owner,:lease,:date) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,stage_gen=excluded.stage_gen,expected=excluded.expected,owner=excluded.owner,lease=excluded.lease WHERE sd_sources.lease<=:now OR sd_sources.lease IS NULL OR sd_sources.owner=:owner`,{...p,':name':input.name,':url':input.url,':expected':input.chunks,':lease':now+120000,':date':input.date});
  const state=await db.get('SELECT * FROM sd_sources WHERE id=:source',p);
  requireValue(state.owner===owner,'Source busy');
  if(state.current_gen===gen){await db.run("UPDATE sd_sources SET stage_gen=NULL,lease=NULL,owner=NULL,checked=:now,status='ok' WHERE id=:source AND owner=:owner",p);return {unchanged:true};}
  await db.run(`DELETE FROM sd_terms WHERE offer IN(SELECT rowid FROM sd_offers WHERE source=:source AND gen!=:gen AND gen!=COALESCE(:current,''))`,{...p,':current':state.current_gen});
  for(const table of ['sd_offers','sd_chunks'])await db.run(`DELETE FROM ${table} WHERE source=:source AND gen!=:gen AND gen!=COALESCE(:current,'')`,{...p,':current':state.current_gen});
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
  const rows=JSON.stringify(input.rows);requireValue(rows.length<1200000);
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
  const offers=await db.get('SELECT COUNT(*) AS n,MAX(date) AS date FROM sd_offers WHERE source=:source AND gen=:gen',p);requireValue(offers.n===input.count,'Offer count mismatch');
  const result=await db.run(`UPDATE sd_sources SET current_gen=:gen,stage_gen=NULL,lease=NULL,owner=NULL,date=:date,checked=:now,status='ok' WHERE id=:source AND owner=:owner AND stage_gen=:gen AND lease>:now`,{...p,':date':offers.date});requireValue(result.rowsAffected===1,'Publication lost lease');
  await db.run('DELETE FROM sd_terms WHERE offer IN(SELECT rowid FROM sd_offers WHERE source=:source AND gen!=:gen)',p);
  await db.run('DELETE FROM sd_offers WHERE source=:source AND gen!=:gen',p);
  await db.run('DELETE FROM sd_chunks WHERE source=:source AND gen!=:gen',p);
  return {published:true,count:offers.n};
 }
 throw Error('Unknown import operation');
}
