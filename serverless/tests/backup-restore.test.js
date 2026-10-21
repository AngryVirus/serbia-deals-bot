import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fixture,offer,publish} from './fixtures.js';
import {initBasket,addList,cartItems,saveBasketFilters} from '../tgcloud/lib/basket.js';
import {rawRole,banned,record} from '../tgcloud/lib/moderation-state.js';
import {noticeTick} from '../tgcloud/lib/moderation-notices.js';
import {prepareNotifications,deliverNotifications} from '../tgcloud/lib/notifications.js';
import {adTick} from '../tgcloud/lib/ads.js';
import {Store} from '../tgcloud/lib/store.js';
import {sanitizeRestore,runRestoreCheck} from '../restore_check.mjs';

async function administrative(store,kind,uid,value){await store.db.run('INSERT INTO sd_admin_records(kind,key,payload,at) VALUES(:kind,:key,:payload,:at)',{':kind':kind,':key':String(uid),':payload':JSON.stringify(value),':at':Date.now()});}
const noSend=new Proxy({}, {get:()=>()=>{throw Error('No external API is allowed in recovery');}});

test('restoration retains baskets, exact quantities, filters, subscriptions and numeric moderation decisions',async()=>{
 const f=await fixture();
 try{
  await f.store.ensure(12);await f.store.ensure(13);
  await f.store.patch(12,{first_seen:123,first_day:'2026-10-20',name:'Private Example',username:'privateexample',query:'молоко',searchFilters:{pack:{kind:'volume',amount:1000}},id:999,panel:47,photo:true,pending:'ad_post',adminInput:'ban_reason',adminDraft:{uid:13,active:true},deleteDraft:{nonce:'stale'},cartTarget:'old',refinement:{query:'old'},searchRev:'old'});
  await f.db.run('UPDATE sd_users SET enabled=1 WHERE id=12');
  await addList(f.store,12,'молоко × 3, курица × 2','cart');
  await saveBasketFilters(f.store,12,'cart-0',{pack:{kind:'volume',amount:1000},type:['milkplain']});
  await f.db.run("INSERT INTO sd_watches(uid,product,name,baseline) VALUES(12,'gtin:123','Watch name',42000)");
  const actor={id:340780041,name:'Actor',username:'AngryVirus'};
  await administrative(f.store,'role',12,{version:'role-v1',uid:12,role:'admin',actor,notice:'pending',retry:1,action:'promote'});
  await administrative(f.store,'ban',88,{version:'ban-v1',uid:88,active:true,reason:'Example reason',actor,ban_actor:actor,notice:'sending',retry:1});
  const beforeItems=await cartItems(f.store,12);
  await sanitizeRestore(f.store);
  assert.deepEqual(await cartItems(f.store,12),beforeItems);
  const user=await f.store.user(12);
  assert.equal(user.id,12);assert.equal(user.enabled,1);assert.equal(user.name,'Private Example');assert.equal(user.first_seen,123);
  assert.deepEqual(user.searchFilters,{pack:{kind:'volume',amount:1000}});
  for(const key of ['panel','photo','pending','adminInput','adminDraft','deleteDraft','cartTarget','refinement','searchRev'])assert.equal(user[key],undefined,key);
  assert.equal(await rawRole(f.store,12),'admin');assert(await banned(f.store,88));
  assert.equal((await record(f.store,'ban',88)).reason,'Example reason');assert.deepEqual((await record(f.store,'role',12)).actor,actor);
  for(const [kind,uid] of [['role',12],['ban',88]]){const r=await record(f.store,kind,uid);assert.equal(r.notice,'none');assert.equal(r.retry,0);assert.equal(r.version,kind+'-v1');}
  assert.equal((await f.db.get('SELECT baseline FROM sd_watches WHERE uid=12')).baseline,0);
  assert.equal(await f.store.meta('active'),false);assert.equal(await f.store.meta('ad_emergency'),Number.MAX_SAFE_INTEGER);
 }finally{f.db.connection.close();}
});

test('restoration discards price and advertising queues, old confirmations and notice delivery independently of active state',async()=>{
 const f=await fixture();
 try{
  await f.store.ensure(12);await initBasket(f.store.db);
  await f.db.run("INSERT INTO sd_queue(uid,product,price,offer,created,state) VALUES(12,'gtin:123',123,'{}',1,'pending')");
  await f.db.run("INSERT INTO sd_locks(id,owner,expires) VALUES(12,'old',9999999999999)");
  await f.db.run("INSERT INTO sd_rates(id,n,expires) VALUES('old',20,9999999999999)");
  await f.db.run("INSERT INTO sd_updates(id,expires) VALUES('old',9999999999999)");
  await f.db.run("INSERT INTO sd_basket_reports(uid,fingerprint,payload,expires) VALUES(12,'old','{}',9999999999999)");
  await f.db.run("INSERT INTO sd_panel_media(key,file_id) VALUES('old','old-private-file-id')");
  for(const kind of ['ad_control','ad_campaign','ad_delivery','ad_target','ad_launch','ad_audit'])await administrative(f.store,kind,12,{state:'running',id:'old',post:{text:'must never send'}});
  await administrative(f.store,'role',12,{role:'moderator',version:'v1',notice:'pending',retry:0});
  for(const [key,value] of [['ad_current','old'],['ad_draft',{confirmed:true}],['health_snapshot_v2',{pending:true}],['watch_cursor',99],['ad_daily_limit',3]])await f.store.setMeta(key,value);
  await sanitizeRestore(f.store);
  for(const table of ['sd_queue','sd_locks','sd_rates','sd_updates','sd_basket_reports','sd_panel_media'])assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM '+table)).n,0);
  assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM sd_admin_records WHERE kind LIKE 'ad_%'")).n,0);
  for(const key of ['ad_current','ad_draft','health_snapshot_v2','watch_cursor'])assert.equal(await f.store.meta(key),null);
  assert.equal(await f.store.meta('ad_daily_limit'),3);
  assert.equal((await adTick(f.store,noSend)).done,true);
  assert.deepEqual(await noticeTick(f.store,noSend,null),{sent:0,checked:0});
  assert.equal((await deliverNotifications(f.store,noSend)).sent,0);
  // A later deliberate activation must not revive deleted campaigns/notices.
  await f.store.setMeta('active',true);
  assert.equal((await adTick(f.store,noSend)).done,true);
  assert.equal((await noticeTick(f.store,noSend,null)).sent,0);
 }finally{f.db.connection.close();}
});

test('fresh prices reset restored baselines without replaying an outage drop; future decreases still notify',async()=>{
 const f=await fixture();
 try{
  await publish(f,[offer(1,{regular:40000})]);await f.store.ensure(12);await f.store.watch(12,offer().id);await f.db.run('UPDATE sd_users SET enabled=1 WHERE id=12');
  await publish(f,[offer(1,{regular:20000})],'c'.repeat(32));
  await sanitizeRestore(f.store);
  await prepareNotifications(f.store);
  assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_queue')).n,0);
  assert.equal((await f.db.get('SELECT baseline FROM sd_watches WHERE uid=12')).baseline,20000);
  assert.equal((await f.store.user(12)).enabled,1);
  await f.store.setMeta('active',true);
  await publish(f,[offer(1,{regular:18000})],'d'.repeat(32));await prepareNotifications(f.store);
  assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal(f.sent.length,1);
 }finally{f.db.connection.close();}
});

test('minimal archived SQLite gains required schema and passes offline drill without credentials or private stdout',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'deals-restore-test-')),path=join(directory,'restored.sqlite');
 try{
  const db=new DatabaseSync(path);
  db.exec(`CREATE TABLE sd_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE sd_users(id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL,blocked INTEGER NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE sd_basket(uid INTEGER NOT NULL,id TEXT NOT NULL,query TEXT NOT NULL,product TEXT,name TEXT,quantity INTEGER NOT NULL,PRIMARY KEY(uid,id));
   CREATE TABLE sd_basket_filters(uid INTEGER NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(uid,id));
   CREATE TABLE sd_watches(uid INTEGER NOT NULL,product TEXT NOT NULL,name TEXT NOT NULL,baseline INTEGER NOT NULL,PRIMARY KEY(uid,product));
   CREATE TABLE sd_admin_records(kind TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(kind,key));
   CREATE TABLE sd_backup_manifest(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  db.prepare('INSERT INTO sd_users VALUES(12,1,0,?)').run(JSON.stringify({name:'never-print-this-user',pending:'ban_reason'}));
  db.prepare("INSERT INTO sd_basket VALUES(12,'b1','молоко',NULL,NULL,2)").run();
  db.prepare("INSERT INTO sd_basket_filters VALUES(12,'b1','{}')").run();
  db.close();chmodSync(path,0o600);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
  const result=spawnSync(process.execPath,['serverless/restore_check.mjs',path],{cwd:new URL('../../',import.meta.url),env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);
  assert.equal(report.offline_bot,true);assert.equal(report.paused,true);assert.equal(report.sends,0);assert.equal(report.counts.sd_basket,1);
  assert(!result.stdout.includes('never-print'));assert(!result.stderr.includes('never-print'));
  const restored=new DatabaseSync(path);const adapter={async run(sql,p={}){return {rowsAffected:Number(restored.prepare(sql).run(p).changes)};},async get(sql,p={}){return restored.prepare(sql).get(p);},async all(sql,p={}){return restored.prepare(sql).all(p);}};
  const store=new Store(adapter);assert.equal(await store.meta('active'),false);assert.equal((await store.user(12)).pending,undefined);restored.close();
  const second=await runRestoreCheck(path);assert.equal(second.paused,true);assert.equal(second.counts.sd_basket,1);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('failed sanitization rolls back user changes and CLI errors withhold private input',async()=>{
 const f=await fixture();
 try{
  await f.store.ensure(12);await f.store.patch(12,{pending:'old-draft'});await f.store.ensure(13);
  await f.db.run("UPDATE sd_users SET payload='[]' WHERE id=13");
  await assert.rejects(sanitizeRestore(f.store));assert.equal((await f.store.user(12)).pending,'old-draft');assert.equal(await f.store.meta('active'),true);
  const result=spawnSync(process.execPath,['serverless/restore_check.mjs','/not-a-real-private-recovery-file'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert(!result.stderr.includes('not-a-real-private'));
 }finally{f.db.connection.close();}
});
