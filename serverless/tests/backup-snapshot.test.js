import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.js';
import {backupOperation} from '../tgcloud/lib/backup.js';
import {addList,saveBasketFilters} from '../tgcloud/lib/basket.js';

const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const create=(f,extra={})=>backupOperation(f.store,{operation:'backup_create',id,...extra});
const page=(f,table,after=null,extra={})=>backupOperation(f.store,{operation:'backup_page',id,table,after,...extra});

test('backup snapshot preserves durable rows but excludes transient state and orphan baskets',async()=>{
 const f=await fixture();await f.store.ensure(5);await addList(f.store,5,'молоко × 2',12);await saveBasketFilters(f.store,5,'12-0',{pack:{kind:'volume',amount:1000}});
 await addList(f.store,6,'удалённый профиль',13);
 await f.db.run("INSERT INTO sd_watches VALUES(5,'gtin:1','Молоко',1234),(6,'gtin:2','Orphan',2345)");
 await f.db.run("INSERT INTO sd_admin_records VALUES('role','99',:role,1),('ban','100',:ban,1),('ad_campaign','x','{}',1)",{':role':JSON.stringify({role:'moderator'}),':ban':JSON.stringify({active:true})});
 await f.store.setMeta('ad_daily_limit',3);await f.store.setMeta('ad_draft',{private:'draft'});
 const manifest=await create(f);assert.equal(manifest.version,1);assert.equal(manifest.pagination,'keyset-v1');assert.equal(manifest.counts.sd_users,1);assert.equal(manifest.counts.sd_basket,1);assert.equal(manifest.counts.sd_basket_filters,1);assert.equal(manifest.counts.sd_watches,1);assert.equal(manifest.counts.sd_admin_records,2);
 assert.deepEqual((await page(f,'sd_basket')).rows.map(r=>[r.uid,r.query,r.quantity]),[[5,'молоко',2]]);
 assert.deepEqual((await page(f,'sd_admin_records')).rows.map(r=>r.kind).sort(),['ban','role']);assert(!(await page(f,'sd_meta')).rows.some(r=>r.key==='active'||r.key==='ad_draft'));
});

test('backup snapshot remains immutable across subsequent live edits and resumed export',async()=>{
 const f=await fixture();await f.store.ensure(5);await addList(f.store,5,'молоко',1);const original=await create(f);
 await f.store.patch(5,{name:'changed'});await f.db.run('DELETE FROM sd_basket');await f.store.ensure(6);
 assert.deepEqual(await create(f,{resume:true}),original);assert.equal((await page(f,'sd_users')).rows.length,1);assert.equal(JSON.parse((await page(f,'sd_users')).rows[0].payload).name,undefined);assert.equal((await page(f,'sd_basket')).rows[0].query,'молоко');
 await assert.rejects(create(f),/already exists/);
});

test('live user lease gates the same snapshot statement and busy retry leaves no partial rows',async()=>{
 const f=await fixture();await f.store.ensure(5);await f.db.run('INSERT INTO sd_locks VALUES(5,\'handler\',:until)',{':until':Date.now()+60000});
 assert.deepEqual(await create(f),{busy:true});assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_backup_rows')).n,0);
 await f.db.run('DELETE FROM sd_locks');assert.equal((await create(f)).counts.sd_users,1);
});

test('expired user leases and worker leases do not block snapshots, including empty tables',async()=>{
 const f=await fixture();await f.db.run('INSERT INTO sd_locks VALUES(5,\'old\',1),(-3,\'ads\',:until)',{':until':Date.now()+60000});
 assert.equal((await create(f)).counts.sd_users,0);assert.deepEqual(await page(f,'sd_users'),{rows:[],next:null});
});

test('parallel same-ID creates cannot mix snapshots and exactly one immutable marker survives',async()=>{
 const f=await fixture();await f.store.ensure(5);const results=await Promise.allSettled([create(f),create(f)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM sd_backup_rows WHERE table_name='_snapshot'")).n,1);assert.equal((await create(f,{resume:true})).counts.sd_users,1);
});

test('backup keyset pages cover all rows without duplication and obey the byte budget',async()=>{
 const f=await fixture();for(let uid=1;uid<=430;uid++){await f.store.ensure(uid);await f.store.patch(uid,{name:'x'.repeat(500)});}await create(f);
 let after=null,rows=[];for(let i=0;i<20;i++){const result=await page(f,'sd_users',after);assert(Buffer.byteLength(JSON.stringify(result))<100*1024);if(!result.rows.length)break;assert.notEqual(result.next,after);rows.push(...result.rows);after=result.next;}
 assert.equal(rows.length,430);assert.equal(new Set(rows.map(r=>r.id)).size,430);assert.deepEqual((await page(f,'sd_users',after)).rows,[]);
});

test('oversized single row fails closed rather than returning a false successful empty page',async()=>{
 const f=await fixture();await f.store.ensure(5);await f.store.patch(5,{name:'x'.repeat(110000)});await create(f);
 await assert.rejects(page(f,'sd_users'),/safe response limit/);
});

test('snapshot expiry and release reject stale cursors and unknown input without private error data',async()=>{
 const f=await fixture();await create(f);await assert.rejects(page(f,'sd_queue'),/Invalid backup cursor/);await assert.rejects(page(f,'sd_users',42),/Invalid backup cursor/);await assert.rejects(backupOperation(f.store,{operation:'backup_drop',id}),/Unknown backup operation/);await assert.rejects(create(f,{id:'private-user-input'}),/Invalid snapshot ID/);
 await f.db.run('UPDATE sd_backup_rows SET created_at=:past',{':past':Date.now()-86400001});await assert.rejects(page(f,'sd_users'),/expired or missing/);await assert.rejects(create(f,{resume:true}),/expired or missing/);
 await backupOperation(f.store,{operation:'backup_create',id:other});assert.deepEqual(await backupOperation(f.store,{operation:'backup_release',id:other}),{released:true});await assert.rejects(page(f,'sd_users',null,{id:other}),/expired or missing/);
});
