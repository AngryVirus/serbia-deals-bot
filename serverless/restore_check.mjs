// Offline recovery only. This module never imports the Telegram SDK or an HTTP client.
import {DatabaseSync} from 'node:sqlite';
import {statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Store} from './tgcloud/lib/store.js';
import {initBasket,cartItems} from './tgcloud/lib/basket.js';
import {adTick} from './tgcloud/lib/ads.js';
import {prepareNotifications,deliverNotifications} from './tgcloud/lib/notifications.js';
import {rawRole,banned} from './tgcloud/lib/moderation-state.js';

const USER_KEYS=['first_seen','first_day','last_seen','last_day','name','username','delivery_blocked','query','searchFilters'];
const TABLES=['sd_users','sd_basket','sd_basket_filters','sd_watches','sd_admin_records'];

// Work only on the separately decrypted local copy. Never upload this file or
// run this against the live bot. Archived rows remain unchanged in ciphertext.
export async function sanitizeRestore(store){
 await store.init();await initBasket(store.db);
 await store.db.run('BEGIN IMMEDIATE');
 try{
  for(const row of await store.db.all('SELECT id,payload FROM sd_users')){
   const old=JSON.parse(row.payload);
   assert(old&&typeof old==='object'&&!Array.isArray(old));
   const payload=Object.fromEntries(USER_KEYS.filter(k=>Object.hasOwn(old,k)).map(k=>[k,old[k]]));
   await store.db.run('UPDATE sd_users SET payload=:payload WHERE id=:id',{':payload':JSON.stringify(payload),':id':row.id});
  }
  await store.db.run("DELETE FROM sd_admin_records WHERE kind NOT IN ('role','ban')");
  for(const row of await store.db.all('SELECT kind,key,payload FROM sd_admin_records')){
   const old=JSON.parse(row.payload);
   assert(old&&typeof old==='object'&&!Array.isArray(old));
   await store.db.run('UPDATE sd_admin_records SET payload=:payload WHERE kind=:kind AND key=:key',{':payload':JSON.stringify({...old,notice:'none',retry:0}),':kind':row.kind,':key':row.key});
  }
  for(const table of ['sd_queue','sd_locks','sd_rates','sd_updates','sd_basket_reports','sd_panel_media','sd_product_names','sd_chunks'])await store.db.run('DELETE FROM '+table);
  await store.db.run("DELETE FROM sd_meta WHERE key NOT IN ('users_tracking','ad_daily_limit','schema_version')");
  await store.setMeta('active',false);
  await store.setMeta('ad_emergency',Number.MAX_SAFE_INTEGER);
  // A new catalogue establishes each subscription's fresh baseline without
  // turning a price drop during the outage into an old notification replay.
  await store.db.run('UPDATE sd_watches SET baseline=0');
  await store.db.run('COMMIT');
 }catch(error){await store.db.run('ROLLBACK');throw error;}
}

export async function runRestoreCheck(path){
 const file=resolve(path);assert(statSync(file).isFile());
 const connection=new DatabaseSync(file);
 const db={
  async run(sql,p={}){return {rowsAffected:Number(connection.prepare(sql).run(p).changes)};},
  async get(sql,p={}){return connection.prepare(sql).get(p);},
  async all(sql,p={}){return connection.prepare(sql).all(p);}
 };
 try{
  assert.equal((await db.get('PRAGMA integrity_check')).integrity_check,'ok');
  const store=new Store(db);
  await sanitizeRestore(store);
  assert.equal(await store.meta('active'),false);
  const counts=Object.fromEntries(await Promise.all(TABLES.map(async table=>[table,(await db.get('SELECT COUNT(*) AS n FROM '+table)).n])));
  // Read real durable state through application accessors in the disposable DB.
  for(const row of await db.all('SELECT DISTINCT uid FROM sd_basket')){
   const items=await cartItems(store,row.uid);
   assert.equal(items.length,(await db.get('SELECT COUNT(*) AS n FROM sd_basket WHERE uid=:uid',{':uid':row.uid})).n);
   for(const item of items)assert(item.quantity>=1&&item.quantity<=99&&typeof item.query==='string');
  }
  for(const row of await db.all('SELECT kind,key FROM sd_admin_records')){
   if(row.kind==='role')assert(['user','moderator','admin','owner'].includes(await rawRole(store,Number(row.key))));
   else assert.equal(typeof await banned(store,Number(row.key)),'boolean');
  }
  let sends=0;
  const fail=()=>{sends++;throw Error('Offline recovery attempted an external send');};
  const api=new Proxy({}, {get:()=>fail});
  assert.equal((await adTick(store,api)).done,true);
  await prepareNotifications(store);
  assert.equal((await deliverNotifications(store,api)).sent,0);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM sd_queue')).n,0);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM sd_admin_records WHERE kind IN ('role','ban') AND json_extract(payload,'$.notice')='pending'")).n,0);
  assert.equal(sends,0);
  assert.equal(await store.meta('active'),false);
  return {offline_bot:true,paused:true,sends:0,counts};
 }finally{connection.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  assert.equal(process.argv.length,3);
  process.stdout.write(JSON.stringify(await runRestoreCheck(process.argv[2])));
 }catch{process.stderr.write('Offline restored-bot validation failed; private output withheld\n');process.exitCode=1;}
}
