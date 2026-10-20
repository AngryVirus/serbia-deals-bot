import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,callback} from './fixtures.js';
import {Store} from '../tgcloud/lib/store.js';
import {OWNER_ID,day} from '../tgcloud/lib/domain.js';
import {checkHealth,sourceHealth} from '../tgcloud/lib/health.js';
import {Bot} from '../tgcloud/lib/bot.js';
const OLD=()=>day(Date.now()-4*86400000);
async function expired(f,source){await f.db.run('UPDATE sd_sources SET date=:date WHERE id=:source',{':date':OLD(),':source':source});}
async function queueErrors(f,n){for(let i=0;i<n;i++)await f.db.run("INSERT INTO sd_queue(uid,product,price,offer,state,created) VALUES(5,:product,1,'{}','uncertain',:now)",{':product':'test'+i,':now':Date.now()});}

test('successful collection cannot hide one stale published source and warns only owner',async()=>{
 const f=await fixture(),a=offer(),b=offer(2,{source:'b'.repeat(24)});await publish(f,[a]);await publish(f,[b]);await expired(f,a.source);await f.store.setMeta('last_collection',Date.now());const state=await checkHealth(f.store,f.api);assert.equal(state.stale,false);assert.equal(state.stale_sources,1);assert.equal(state.problem,'source_prices_stale');assert.equal(f.sent.length,1);assert.equal(f.sent[0].chat_id,OWNER_ID);assert(f.sent[0].text.includes('Нет свежих цен'));await checkHealth(new Store(f.db),f.api);assert.equal(f.sent.length,1);
});
test('parallel health workers claim a warning once and source recovery is delivered once',async()=>{
 const f=await fixture(),a=offer();await publish(f,[a]);await expired(f,a.source);await f.store.setMeta('last_collection',Date.now());await Promise.all([checkHealth(f.store,f.api),checkHealth(f.store,f.api)]);assert.equal(f.sent.length,1);await f.db.run('UPDATE sd_sources SET date=:date',{':date':day()});await Promise.all([checkHealth(f.store,f.api),checkHealth(f.store,f.api)]);assert.equal(f.sent.length,2);assert(f.sent[1].text.includes('снова доступны'));
});
test('independent delivery and source incidents report recovery separately without claiming everything recovered',async()=>{
 const f=await fixture(),a=offer();await publish(f,[a]);await expired(f,a.source);await f.store.setMeta('last_collection',Date.now());await queueErrors(f,10);await checkHealth(f.store,f.api);assert(f.sent[0].text.includes('проблем доставки'));await f.db.run("UPDATE sd_queue SET state='sent'");await checkHealth(f.store,f.api);assert.equal(f.sent.length,2);assert(f.sent[1].text.includes('ниже порога'));assert(!f.sent[1].text.includes('Свежие цены снова доступны'));assert.equal((await checkHealth(f.store,f.api)).stale_sources,1);assert.equal(f.sent.length,2);
});
test('fresh retained prices after failed refresh and unpublished candidates are not falsely marked stale',async()=>{
 const f=await fixture();await publish(f,[offer()]);await f.db.run("UPDATE sd_sources SET status='unavailable'");await f.db.run("INSERT INTO sd_sources(id,name,url,status) VALUES(:id,'Candidate','https://example.org','unavailable')",{':id':'c'.repeat(24)});await f.store.setMeta('last_collection',Date.now());const result=await checkHealth(f.store,f.api);assert.equal(result.stale_sources,0);assert.equal(f.sent.length,0);const source=(await f.store.sources()).find(x=>x.current_gen);assert.equal(sourceHealth(source).fresh,true);assert(sourceHealth(source).label.includes('не удалось'));
});
test('paused bot does not send false operational alerts and active uninitialized collection is detected',async()=>{
 const f=await fixture();await f.store.setMeta('active',false);assert.equal((await checkHealth(f.store,f.api)).paused,true);assert.equal(f.sent.length,0);await f.store.setMeta('active',true);assert.equal((await checkHealth(f.store,f.api)).uninitialized,true);assert.equal(f.sent.length,1);assert(f.sent[0].text.includes('Нет отметки'));
});
test('explicit 429 retries after its deadline while timeout or interrupted sends are never repeated',async()=>{
 const f=await fixture();await f.store.setMeta('last_collection',Date.now()-37*3600000);let calls=0;f.api.sendMessage=async()=>{calls++;throw {code:429,parameters:{retry_after:120}};};await checkHealth(f.store,f.api);await checkHealth(f.store,f.api);assert.equal(calls,1);const pending=await f.store.meta('health_snapshot_v2');assert.equal(pending.notice,'pending');assert(pending.retry>Date.now()+110000);await f.store.setMeta('health_snapshot_v2',{...pending,retry:0});f.api.sendMessage=async()=>{calls++;throw Error('private sensitive error');};await checkHealth(f.store,f.api);await checkHealth(f.store,f.api);assert.equal(calls,2);assert.equal((await f.store.meta('health_snapshot_v2')).notice,'uncertain');const saved=await f.store.meta('health_snapshot_v2');assert(!JSON.stringify(saved).includes('private sensitive'));await f.store.setMeta('health_snapshot_v2',{...saved,notice:'sending'});await checkHealth(f.store,f.api);assert.equal(calls,2);
});
test('a changing stale-source list reports only newly stale or newly recovered networks',async()=>{
 const f=await fixture(),a=offer(),b=offer(2,{source:'b'.repeat(24)});await publish(f,[a]);await publish(f,[b]);await f.db.run('UPDATE sd_sources SET name=:name WHERE id=:id',{':id':a.source,':name':'Network A'});await f.db.run('UPDATE sd_sources SET name=:name WHERE id=:id',{':id':b.source,':name':'Network B'});await f.store.setMeta('last_collection',Date.now());await expired(f,a.source);await checkHealth(f.store,f.api);await expired(f,b.source);await checkHealth(f.store,f.api);assert.equal(f.sent.length,2);assert(f.sent[1].text.includes('Network B'));assert(!f.sent[1].text.includes('Network A'));await f.db.run('UPDATE sd_sources SET date=:date WHERE id=:id',{':date':day(),':id':a.source});await checkHealth(f.store,f.api);assert.equal(f.sent.length,3);assert(f.sent[2].text.includes('Network A'));assert(!f.sent[2].text.includes('Network B'));
});
test('source report is owner-only, paginated and translates refresh failures',async()=>{
 const f=await fixture();for(let i=0;i<8;i++)await f.db.run("INSERT INTO sd_sources(id,name,url,status,current_gen,date) VALUES(:id,:name,'https://example.org','unavailable','test',:date)",{':id':String(i).padStart(24,'0'),':name':'Network '+i,':date':day()});await new Bot(f).handle(callback(OWNER_ID,'admin:sources'));let panel=f.sent.at(-1);assert(panel.text.includes('Со свежим прайсом: 8'));assert(panel.text.includes('обновление не удалось'));assert(!panel.text.includes('unavailable'));assert(panel.reply_markup.inline_keyboard.flat().some(x=>x.callback_data==='admin:sources:1'));await new Bot(f).handle(callback(OWNER_ID,'admin:sources:1'));panel=f.sent.at(-1);assert(panel.text.includes('Network 7'));assert(!panel.text.includes('Network 0'));await new Bot(f).handle(callback(5,'admin:sources:1'));assert(!f.sent.at(-1).text.includes('Network 7'));
});
test('an enabled source that never published is monitored while unrelated candidates stay quiet',async()=>{
 const f=await fixture();await f.store.setMeta('last_collection',Date.now());const id='d'.repeat(24);await f.db.run("INSERT INTO sd_sources(id,name,url,status) VALUES(:id,'Required Network','https://example.org','unavailable')",{':id':id});await f.store.setMeta('expected_sources',[id]);const result=await checkHealth(f.store,f.api);assert.equal(result.stale_sources,1);assert(f.sent[0].text.includes('Required Network'));
});
test('collector roster is recorded only for enabled collection, not overwritten by ad hoc imports',async()=>{
 const f=await fixture(),{manage}=await import('../tgcloud/lib/manage.js'),ctx={ownerRun:true};const required={id:'d'.repeat(24),name:'Required'},adhoc={id:'e'.repeat(24),name:'One-off'};await manage({operation:'register_sources',rows:[required],expected:true},ctx,f);await manage({operation:'register_sources',rows:[adhoc],expected:false},ctx,f);assert.deepEqual(await f.store.meta('expected_sources'),[required.id]);
});
test('health lease keeps warning/recovery sends ordered without blocking the owner menu lease',async()=>{
 const f=await fixture(),{lockUser,unlockUser}=await import('../tgcloud/lib/moderation-state.js');await f.store.setMeta('last_collection',Date.now()-37*3600000);let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);f.api.sendMessage=async()=>{started();await gate;return {message_id:1};};const running=checkHealth(f.store,f.api);await ready;assert.equal((await checkHealth(f.store,f.api)).busy,true);assert(await lockUser(f.store,OWNER_ID,'owner-menu'));await unlockUser(f.store,OWNER_ID,'owner-menu');release();await running;assert.equal(await f.db.get('SELECT id FROM sd_locks WHERE id=-1'),undefined);
});
