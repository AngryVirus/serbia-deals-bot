import { requireValue } from './domain.js';
import { initBasket } from './basket.js';

// Keep private durable state only. Catalogue prices can be collected again;
// queues, leases, drafts and callback state must never become runnable restores.
const queries = [
 ['sd_users', "printf('%020d',id)", "json_object('id',id,'enabled',enabled,'blocked',blocked,'payload',payload)", 'id>0'],
 ['sd_basket', 'json_array(uid,id)', "json_object('uid',uid,'id',id,'query',query,'product',product,'name',name,'quantity',quantity)", 'uid>0 AND EXISTS(SELECT 1 FROM sd_users u WHERE u.id=sd_basket.uid)'],
 ['sd_basket_filters', 'json_array(uid,id)', "json_object('uid',uid,'id',id,'payload',payload)", 'uid>0 AND EXISTS(SELECT 1 FROM sd_users u WHERE u.id=sd_basket_filters.uid) AND EXISTS(SELECT 1 FROM sd_basket b WHERE b.uid=sd_basket_filters.uid AND b.id=sd_basket_filters.id)'],
 ['sd_watches', 'json_array(uid,product)', "json_object('uid',uid,'product',product,'name',name,'baseline',baseline)", 'uid>0 AND EXISTS(SELECT 1 FROM sd_users u WHERE u.id=sd_watches.uid)'],
 ['sd_admin_records', 'json_array(kind,key)', "json_object('kind',kind,'key',key,'payload',payload,'at',at)", "kind IN ('role','ban')"],
 ['sd_meta', 'key', "json_object('key',key,'value',value)", "(key='users_tracking' AND json_valid(value) AND json_type(value)='integer' AND CAST(value AS INTEGER)>0) OR (key='ad_daily_limit' AND value IN ('1','3','5'))"],
];
const PAGE_ROWS=200, PAGE_BYTES=100*1024, TTL=86400000;

async function snapshotManifest(db,id){
 const marker=await db.get("SELECT created_at FROM sd_backup_rows WHERE snapshot=:id AND table_name='_snapshot'",{':id':id});
 requireValue(marker,'Snapshot expired or missing');
 const counts=await db.all('SELECT table_name,COUNT(*) AS n FROM sd_backup_rows WHERE snapshot=:id GROUP BY table_name',{':id':id});
 return {id,version:1,pagination:'keyset-v1',created_at:marker.created_at,counts:Object.fromEntries(queries.map(([table])=>[table,counts.find(row=>row.table_name===table)?.n||0]))};
}

// Called only behind the owner-only management endpoint. No operation sends API
// messages, activates the bot, or changes the live user and moderation tables.
export async function backupOperation(store,input){
 const {id,operation}=input||{};
 requireValue(typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id),'Invalid snapshot ID');
 requireValue(['backup_create','backup_page','backup_release'].includes(operation),'Unknown backup operation');
 const db=store.db,now=Date.now();
 await initBasket(db);
 await db.run('CREATE TABLE IF NOT EXISTS sd_backup_rows(snapshot TEXT NOT NULL,table_name TEXT NOT NULL,row_key TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(snapshot,table_name,row_key))');
 await db.run('DELETE FROM sd_backup_rows WHERE created_at<:before',{':before':now-TTL});
 if(operation==='backup_release'){
  await db.run('DELETE FROM sd_backup_rows WHERE snapshot=:id',{':id':id});return {released:true};
 }
 if(operation==='backup_create'){
  const saved=await db.get("SELECT 1 AS found FROM sd_backup_rows WHERE snapshot=:id AND table_name='_snapshot'",{':id':id});
  if(saved){requireValue(input.resume===true,'Snapshot already exists');return snapshotManifest(db,id);}
  requireValue(input.resume!==true,'Snapshot expired or missing');
  // One SQLite statement provides a consistent read across every UNION branch.
  // The same statement checks positive user leases, avoiding a logically partial
  // inbound edit or /delete without pausing production or racing a pre-check.
  const quiet='NOT EXISTS(SELECT 1 FROM sd_locks WHERE id>0 AND expires>:now)';
  const selections=queries.map(([table,key,row,where])=>`SELECT :id,'${table}',${key},${row},:now FROM ${table} WHERE (${where}) AND ${quiet}`);
  selections.push(`SELECT :id,'_snapshot','','{}',:now WHERE ${quiet}`);
  // Plain INSERT intentionally fails/rolls back if parallel requests reuse an ID.
  await db.run('INSERT INTO sd_backup_rows(snapshot,table_name,row_key,payload,created_at) '+selections.join(' UNION ALL '),{':id':id,':now':now});
  const marker=await db.get("SELECT 1 AS found FROM sd_backup_rows WHERE snapshot=:id AND table_name='_snapshot'",{':id':id});
  return marker?snapshotManifest(db,id):{busy:true};
 }
 const {table,after}=input;
 requireValue(queries.some(([name])=>name===table)&&(after===null||typeof after==='string'&&after.length<=4096),'Invalid backup cursor');
 requireValue(await db.get("SELECT 1 AS found FROM sd_backup_rows WHERE snapshot=:id AND table_name='_snapshot'",{':id':id}),'Snapshot expired or missing');
 const params={':id':id,':table':table,':after':after,':bytes':PAGE_BYTES};
 // Budget the encoded JSON response as well as raw string bytes: quotes and
 // backslashes in names/payloads otherwise make a nominal 100KiB page too big.
 const rows=await db.all(`SELECT row_key,payload FROM (
  SELECT row_key,payload,SUM(length(CAST(json_quote(payload) AS BLOB))+length(CAST(json_quote(row_key) AS BLOB))+32) OVER(ORDER BY row_key) AS bytes
  FROM (SELECT row_key,payload FROM sd_backup_rows WHERE snapshot=:id AND table_name=:table AND (:after IS NULL OR row_key>:after) ORDER BY row_key LIMIT ${PAGE_ROWS})
 ) WHERE bytes<=:bytes ORDER BY row_key`,params);
 if(!rows.length)requireValue(!await db.get('SELECT 1 AS found FROM sd_backup_rows WHERE snapshot=:id AND table_name=:table AND (:after IS NULL OR row_key>:after) LIMIT 1',params),'Snapshot row exceeds safe response limit');
 return {rows:rows.map(row=>JSON.parse(row.payload)),next:rows.length?rows.at(-1).row_key:after};
}
