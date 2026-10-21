import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish} from './fixtures.js';
import {prepareNotifications,deliverNotifications} from '../tgcloud/lib/notifications.js';
import {lockUser} from '../tgcloud/lib/moderation-state.js';
const today=()=>Math.floor(Date.now()/86400000)*86400000;
async function queued(f,uid,price=20000,after=0){await f.db.run("INSERT INTO sd_queue(uid,product,price,offer,created,after) VALUES(:uid,:product,:price,'{}',:created,:after)",{':uid':uid,':product':offer().product,':price':price,':created':today(),':after':after});}
async function subscriber(f,uid){await f.store.ensure(uid);await f.store.watch(uid,offer().id);await f.db.run('UPDATE sd_users SET enabled=1 WHERE id=:uid',{':uid':uid});}
async function count(f,state){return (await f.db.get('SELECT COUNT(*) AS n FROM sd_queue WHERE state=:state',{':state':state})).n;}

test('five disabled pending events cannot starve a later eligible subscriber',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await subscriber(f,2);for(let i=0;i<5;i++)await queued(f,1,20000+i);await queued(f,2);await f.db.run('UPDATE sd_users SET enabled=0 WHERE id=1');
 assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal(f.sent[0].chat_id,2);assert.equal(await count(f,'cancelled'),5);assert.equal(await count(f,'sent'),1);assert.equal((await deliverNotifications(f.store,f.api)).sent,0);
});
test('missing watches and orphaned user rows are retired before the delivery batch is limited',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await subscriber(f,2);await f.db.run('DELETE FROM sd_watches WHERE uid=1');for(let i=0;i<3;i++)await queued(f,1,20000+i);for(let i=0;i<2;i++)await queued(f,44,20000+i);await queued(f,2);
 assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal(f.sent[0].chat_id,2);assert.equal(await count(f,'cancelled'),5);
});
test('re-enabling notifications does not resurrect cancelled events; a subsequent price drop creates new evidence',async()=>{
 const f=await fixture();await publish(f,[offer(1,{regular:40000})]);await subscriber(f,1);await publish(f,[offer(1,{regular:20000})],'c'.repeat(32));await prepareNotifications(f.store);assert.equal(await count(f,'pending'),1);await f.db.run('UPDATE sd_users SET enabled=0 WHERE id=1');await deliverNotifications(f.store,f.api);assert.equal(await count(f,'cancelled'),1);
 await f.db.run('UPDATE sd_users SET enabled=1 WHERE id=1');await prepareNotifications(f.store);assert.equal((await deliverNotifications(f.store,f.api)).sent,0);await publish(f,[offer(1,{regular:18000})],'d'.repeat(32));await prepareNotifications(f.store);assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal(f.sent.length,1);assert(f.sent[0].text.includes('180,00 RSD'));
});
test('future retry deadlines at the queue head do not block an eligible event due now',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await subscriber(f,2);for(let i=0;i<5;i++)await queued(f,1,20000+i,Date.now()+60000);await queued(f,2);
 assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal(f.sent[0].chat_id,2);assert.equal(await count(f,'pending'),5);
});
test('banned subscribers are cancelled without blocking later deliveries',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await subscriber(f,2);for(let i=0;i<5;i++)await queued(f,1,20000+i);await queued(f,2);await f.db.run("INSERT INTO sd_admin_records(kind,key,payload,at) VALUES('ban','1',:payload,:at)",{':payload':JSON.stringify({active:true}),':at':Date.now()});
 assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal(f.sent[0].chat_id,2);assert.equal(await count(f,'cancelled'),5);
});
test('an expired delivery lease cannot send after another worker bans the recipient or delete the new lease',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await queued(f,1);const cheapest=f.store.cheapest.bind(f.store);f.store.cheapest=async product=>{const row=await cheapest(product);await f.db.run('UPDATE sd_locks SET expires=0 WHERE id=1');assert(await lockUser(f.store,1,'new-ban-worker'));await f.db.run("INSERT INTO sd_admin_records(kind,key,payload,at) VALUES('ban','1',:payload,:at)",{':payload':JSON.stringify({active:true}),':at':Date.now()});return row;};
 assert.equal((await deliverNotifications(f.store,f.api)).sent,0);assert.equal(f.sent.length,0);await deliverNotifications(f.store,f.api);assert.equal(await count(f,'cancelled'),1);assert.equal((await f.db.get('SELECT owner FROM sd_locks WHERE id=1')).owner,'new-ban-worker');
});
test('ambiguous delivery and interrupted sending stay unreplayed while explicit 429 alone can retry',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await subscriber(f,2);await queued(f,1);await queued(f,2);let calls=0;f.api.sendMessage=async p=>{calls++;if(p.chat_id===1)throw {error_code:429,parameters:{retry_after:120}};throw Error('network timeout');};
 await deliverNotifications(f.store,f.api);assert.equal(await count(f,'pending'),2);await f.db.run('UPDATE sd_queue SET after=0 WHERE uid=1');f.api.sendMessage=async p=>{calls++;if(p.chat_id===1)return {message_id:1};throw Error('network timeout');};await deliverNotifications(f.store,f.api);assert.equal(await count(f,'sent'),1);assert.equal(await count(f,'uncertain'),1);const previous=calls;await deliverNotifications(f.store,f.api);assert.equal(calls,previous);
});

test('successive pending price drops coalesce to one current message and never modify ambiguous receipts',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);for(const [gen,regular] of [['c',18000],['d',16000]]){await publish(f,[offer(1,{regular})],gen.repeat(32));await prepareNotifications(f.store);}
 await f.db.run("INSERT INTO sd_queue(uid,product,price,offer,created,state) VALUES(1,:product,19000,'{}',:now,'uncertain')",{':product':offer().product,':now':today()});await f.db.run("INSERT INTO sd_queue(uid,product,price,offer,created,state) VALUES(1,:product,19500,'{}',:now,'sending')",{':product':offer().product,':now':today()});
 assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal(f.sent.length,1);assert(f.sent[0].text.includes('160,00 RSD'));assert.equal(await count(f,'sent'),1);assert.equal(await count(f,'cancelled'),1);assert.equal(await count(f,'uncertain'),1);assert.equal(await count(f,'sending'),1);assert.equal((await deliverNotifications(f.store,f.api)).sent,0);
});
test('a later drop cannot bypass an earlier explicit 429 retry or produce duplicate messages after retry',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await publish(f,[offer(1,{regular:18000})],'c'.repeat(32));await prepareNotifications(f.store);let calls=0;f.api.sendMessage=async()=>{calls++;throw {error_code:429,parameters:{retry_after:120}};};await deliverNotifications(f.store,f.api);assert.equal(calls,1);
 await publish(f,[offer(1,{regular:16000})],'d'.repeat(32));await prepareNotifications(f.store);await deliverNotifications(f.store,f.api);assert.equal(calls,1);assert.equal(await count(f,'pending'),1);assert.equal(await count(f,'cancelled'),1);await f.db.run("UPDATE sd_queue SET after=0 WHERE state='pending'");f.api.sendMessage=async p=>{calls++;f.sent.push(p);return {message_id:1};};assert.equal((await deliverNotifications(f.store,f.api)).sent,1);await deliverNotifications(f.store,f.api);assert.equal(calls,2);assert.equal(f.sent.length,1);assert(f.sent[0].text.includes('160,00 RSD'));
});
test('coalescing retains the lowest still-current event after a price rebound',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);for(const [gen,regular] of [['c',18000],['d',16000],['e',17000]]){await publish(f,[offer(1,{regular})],gen.repeat(32));await prepareNotifications(f.store);}
 assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal(f.sent.length,1);assert(f.sent[0].text.includes('170,00 RSD'));assert.equal(await count(f,'expired'),1);assert.equal(await count(f,'sent'),1);
});

test('a delayed preparation cannot overwrite a newer baseline or enqueue another copy after its alert was delivered',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await publish(f,[offer(1,{regular:18000})],'c'.repeat(32));let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);const {Store}=await import('../tgcloud/lib/store.js');const stale=new Store(f.db),cheapest=stale.cheapest.bind(stale);stale.cheapest=async p=>{const row=await cheapest(p);entered();await gate;return row;};
 const old=prepareNotifications(stale);await ready;await publish(f,[offer(1,{regular:16000})],'d'.repeat(32));await prepareNotifications(f.store);assert.equal((await deliverNotifications(f.store,f.api)).sent,1);release();await old;
 assert.equal((await f.db.get('SELECT baseline FROM sd_watches')).baseline,16000);assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_queue')).n,1);assert.equal((await deliverNotifications(f.store,f.api)).sent,0);assert.equal(f.sent.length,1);
});
test('source-generation validation defeats a baseline amount ABA and genuine increases allow subsequent drops',async()=>{
 const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await publish(f,[offer(1,{regular:18000})],'c'.repeat(32));let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);const {Store}=await import('../tgcloud/lib/store.js');const stale=new Store(f.db),cheapest=stale.cheapest.bind(stale);stale.cheapest=async p=>{const row=await cheapest(p);entered();await gate;return row;};const old=prepareNotifications(stale);await ready;
 for(const [gen,regular] of [['d',16000],['e',20000]]){await publish(f,[offer(1,{regular})],gen.repeat(32));await prepareNotifications(f.store);}release();await old;assert.equal((await f.db.get('SELECT baseline FROM sd_watches')).baseline,20000);assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_queue WHERE price=18000')).n,0);
 await publish(f,[offer(1,{regular:19000})],'f'.repeat(32));await prepareNotifications(f.store);assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert(f.sent[0].text.includes('190,00 RSD'));assert.equal((await f.db.get('SELECT baseline FROM sd_watches')).baseline,19000);
});
test('a crash after enqueue is repairable and delivery persists the baseline before another UTC day can replay it',async()=>{
 const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
 try{
  const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await publish(f,[offer(1,{regular:18000})],'c'.repeat(32));const run=f.db.run;let crash=true;f.db.run=async(sql,p)=>{if(crash&&sql.startsWith('UPDATE sd_watches SET baseline=:price')){crash=false;throw Error('crash after enqueue');}return run(sql,p);};await assert.rejects(prepareNotifications(f.store),/crash after enqueue/);f.db.run=run;assert.equal((await f.db.get('SELECT baseline FROM sd_watches')).baseline,20000);assert.equal(await count(f,'pending'),1);
  now+=86400000;assert.equal((await deliverNotifications(f.store,f.api)).sent,1);assert.equal((await f.db.get('SELECT baseline FROM sd_watches')).baseline,18000);await prepareNotifications(f.store);assert.equal((await deliverNotifications(f.store,f.api)).sent,0);assert.equal(f.sent.length,1);assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_queue')).n,1);
 }finally{Date.now=originalNow;}
});
test('uncertain delivery repairs a crashed preparation and is not replayed as a fresh daily event',async()=>{
 const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
 try{
  const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await publish(f,[offer(1,{regular:18000})],'c'.repeat(32));const run=f.db.run;f.db.run=async(sql,p)=>{if(sql.startsWith('UPDATE sd_watches SET baseline=:price'))throw Error('prepare crashed');return run(sql,p);};await assert.rejects(prepareNotifications(f.store),/prepare crashed/);f.db.run=run;let calls=0;f.api.sendMessage=async()=>{calls++;throw Error('ambiguous API timeout');};await deliverNotifications(f.store,f.api);assert.equal(await count(f,'uncertain'),1);assert.equal((await f.db.get('SELECT baseline FROM sd_watches')).baseline,18000);
  now+=86400000;await prepareNotifications(f.store);await deliverNotifications(f.store,f.api);assert.equal(calls,1);assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_queue')).n,1);assert.equal(await count(f,'uncertain'),1);
 }finally{Date.now=originalNow;}
});
test('a crash after sending preserves the durable baseline and an interrupted sending receipt cannot replay next day',async()=>{
 const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
 try{
  const f=await fixture();await publish(f,[offer()]);await subscriber(f,1);await publish(f,[offer(1,{regular:18000})],'c'.repeat(32));const run=f.db.run;f.db.run=async(sql,p)=>{if(sql.startsWith('UPDATE sd_watches SET baseline=:price'))throw Error('prepare crashed');return run(sql,p);};await assert.rejects(prepareNotifications(f.store),/prepare crashed/);f.db.run=async(sql,p)=>{if(sql.startsWith("UPDATE sd_queue SET state='sent'")||sql.startsWith("UPDATE sd_queue SET state='uncertain'"))throw Error('receipt persistence crashed');return run(sql,p);};await assert.rejects(deliverNotifications(f.store,f.api),/receipt persistence crashed/);f.db.run=run;assert.equal(await count(f,'sending'),1);assert.equal(f.sent.length,1);assert.equal((await f.db.get('SELECT baseline FROM sd_watches')).baseline,18000);
  now+=86400000;await prepareNotifications(f.store);await deliverNotifications(f.store,f.api);assert.equal(f.sent.length,1);assert.equal(await count(f,'sending'),1);assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_queue')).n,1);
 }finally{Date.now=originalNow;}
});
