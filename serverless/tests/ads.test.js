import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,message,callback} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {OWNER_ID} from '../tgcloud/lib/domain.js';
import {adTick,checkAds} from '../tgcloud/lib/ads.js';
const buttons=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat();
const read=async(f,kind,key)=>{const row=await f.db.get('SELECT payload FROM sd_admin_records WHERE kind=:kind AND key=:key',{':kind':kind,':key':key});return row&&JSON.parse(row.payload);};
async function record(f,kind,key,payload){await f.db.run('INSERT INTO sd_admin_records(kind,key,payload,at) VALUES(:kind,:key,:payload,:at) ON CONFLICT(kind,key) DO UPDATE SET payload=excluded.payload,at=excluded.at',{':kind':kind,':key':key,':payload':JSON.stringify(payload),':at':Date.now()});}
async function draft(f){await new Bot(f).handle(callback(OWNER_ID,'ads:new'));await new Bot(f).handle(message(OWNER_ID,'Проверочный текст'));return f.store.meta('ad_draft');}
async function launch(f,d){await new Bot(f).handle(callback(OWNER_ID,'ads:confirm:'+d.id));await new Bot(f).handle(callback(OWNER_ID,'ads:start:'+d.id));}
async function next(f){const id=await f.store.meta('ad_current'),c=await read(f,'ad_campaign',id);await record(f,'ad_campaign',id,{...c,retry_at:0});return adTick(f.store,f.api);}
async function setup(count=7){const f=await fixture();for(let i=1;i<=count;i++)await f.store.ensure(i);await new Bot(f).handle(message(OWNER_ID,'/start'));return f;}
const adCalls=f=>f.sent.filter(p=>p.text?.startsWith('📣 Реклама\n\n')||p.caption?.startsWith('📣 Реклама\n\n'));

test('advertising is owner-only including forged callbacks from administrators and moderators',async()=>{
 const f=await setup(3);for(const [uid,role] of [[1,'user'],[2,'moderator'],[3,'admin']]){if(role!=='user')await record(f,'role',String(uid),{role});await new Bot(f).handle(callback(uid,'admin'));assert(!buttons(f).some(b=>b.callback_data==='ads'));for(const action of ['ads','ads:new','ads:limit:5','ads:emergency','ads:start:fake'])await new Bot(f).handle(callback(uid,action));}
 assert.equal(await f.store.meta('ad_draft'),null);assert.equal(await f.store.meta('ad_emergency'),null);assert.equal(adCalls(f).length,0);await new Bot(f).handle(callback(OWNER_ID,'admin'));assert(buttons(f).some(b=>b.callback_data==='ads'));
});
test('preview and confirmation are required, duplicate launch is idempotent and excludes banned and unavailable users',async()=>{
 const f=await setup();await record(f,'ban','2',{active:true});await f.db.run('UPDATE sd_users SET blocked=1 WHERE id=3');const d=await draft(f);assert(d.previewed);assert(!d.confirmed);assert.equal(adCalls(f).length,1);await new Bot(f).handle(callback(OWNER_ID,'ads:start:'+d.id));assert.equal(await f.store.meta('ad_current'),null);
 await launch(f,d);await new Bot(f).handle(callback(OWNER_ID,'ads:start:'+d.id));await next(f);await next(f);const recipients=adCalls(f).slice(1).map(p=>p.chat_id);assert.deepEqual(recipients,[1,4,5,6,7,OWNER_ID]);assert.equal(new Set(recipients).size,recipients.length);assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM sd_admin_records WHERE kind='ad_launch'")).n,1);assert.deepEqual((await f.db.all("SELECT json_extract(payload,'$.action') AS action FROM sd_admin_records WHERE kind='ad_audit' ORDER BY at,key")).map(r=>r.action).sort(),['confirm','create','start']);
});
test('daily launch quota is durable across new bot instances and cannot be bypassed by another draft',async()=>{
 const f=await setup(1);await f.store.setMeta('ad_daily_limit',1);const first=await draft(f);await launch(f,first);await next(f);const second=await draft(f);await launch(f,second);assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM sd_admin_records WHERE kind='ad_launch'")).n,1);assert(f.sent.at(-1).text.includes('Суточный лимит'));assert.equal(await read(f,'ad_campaign',second.id),undefined);
});
test('parallel advertising workers share a durable lease and send each recipient once',async()=>{
 const f=await setup(12),d=await draft(f);await launch(f,d);let release,entered;const enteredPromise=new Promise(r=>entered=r),waiting=new Promise(r=>release=r),send=f.api.sendMessage;f.api.sendMessage=async p=>{if(p.text?.startsWith('📣 Реклама')){entered();await waiting;}return send(p);};
 const first=next(f);await enteredPromise;assert.deepEqual(await adTick(f.store,f.api),{busy:true});release();await first;await next(f);const users=adCalls(f).slice(1).map(p=>p.chat_id);assert.equal(users.length,13);assert.equal(new Set(users).size,13);
});
test('emergency stop interrupts the remaining batch and later workers never resume it',async()=>{
 const f=await setup(12),d=await draft(f);await launch(f,d);const before=adCalls(f).length,send=f.api.sendMessage;f.api.sendMessage=async p=>{const r=await send(p);if(p.text?.startsWith('📣 Реклама'))await f.store.setMeta('ad_emergency',Date.now());return r;};await next(f);assert.equal(adCalls(f).length,before+1);assert.equal((await read(f,'ad_campaign',d.id)).state,'stopped');await adTick(f.store,f.api);assert.equal(adCalls(f).length,before+1);
});
test('single campaign stop leaves price notifications and user baskets unchanged',async()=>{
 const f=await setup(12);await f.db.run('UPDATE sd_users SET enabled=1 WHERE id=1');await f.store.patch(1,{cart:[{id:'kept',query:'молоко',quantity:1}]});const before=await f.store.user(1),d=await draft(f);await launch(f,d);const sent=adCalls(f).length;await new Bot(f).handle(callback(OWNER_ID,'ads:stop:'+d.id));await next(f);assert.equal(adCalls(f).length,sent);const after=await f.store.user(1);assert.equal(after.enabled,1);assert.deepEqual(after.cart,before.cart);assert.equal((await read(f,'ad_campaign',d.id)).state,'stopped');
});
test('ambiguous sends and a crash after sending never result in automatic resending',async()=>{
 const f=await setup(2),d=await draft(f),send=f.api.sendMessage;f.api.sendMessage=async p=>{if(p.text?.startsWith('📣 Реклама')&&p.chat_id===1)throw Error('network timeout');return send(p);};
 const run=f.db.run;let crashed=false;f.db.run=async(sql,p)=>{if(!crashed&&sql.startsWith('INSERT INTO sd_admin_records(kind,key,payload,at)')&&p?.[':kind']==='ad_delivery'&&JSON.parse(p[':payload']).state==='sent'){crashed=true;throw Error('simulated receipt persistence failure');}return run(sql,p);};
 await assert.rejects(launch(f,d),/receipt persistence/);assert.equal((await read(f,'ad_delivery',d.id+':1')).state,'uncertain');assert.equal((await read(f,'ad_delivery',d.id+':2')).state,'sending');f.db.run=run;f.api.sendMessage=send;await next(f);await next(f);assert.equal(adCalls(f).filter(p=>p.chat_id===2).length,1);assert.equal(adCalls(f).filter(p=>p.chat_id===1).length,0);
});
test('explicit 429 retries later; 403 marks unreachable; deleted and recreated profiles are skipped',async()=>{
 const f=await setup(8),d=await draft(f),send=f.api.sendMessage;let limited=false;f.api.sendMessage=async p=>{if(p.text?.startsWith('📣 Реклама')){if(p.chat_id===1&&!limited){limited=true;throw {error_code:429,parameters:{retry_after:5}};}if(p.chat_id===2)throw {error_code:403,description:'bot was blocked by the user'};}return send(p);};await launch(f,d);assert.equal(await read(f,'ad_delivery',d.id+':1'),undefined);assert((await read(f,'ad_campaign',d.id)).retry_at>Date.now());await f.store.patch(7,{first_seen:0});await record(f,'ban','8',{active:true});await next(f);await next(f);const recipients=adCalls(f).slice(1).map(p=>p.chat_id);assert.equal(recipients.filter(i=>i===1).length,1);assert(!recipients.includes(2));assert(!recipients.includes(7));assert(!recipients.includes(8));assert.equal((await f.store.user(2)).blocked,1);
});
test('photo drafts preserve caption entities and links; editing invalidates old confirmation; navigation cancels input',async()=>{
 const f=await setup(1);await new Bot(f).handle(callback(OWNER_ID,'ads:new'));const update=message(OWNER_ID,undefined);Object.assign(update.message,{photo:[{file_id:'virtual-photo'}],caption:'Акция',caption_entities:[{type:'bold',offset:0,length:5}]});await new Bot(f).handle(update);let d=await f.store.meta('ad_draft');assert.equal(d.photo,'virtual-photo');const photo=adCalls(f).at(-1);assert.equal(photo.caption_entities[0].offset,'📣 Реклама\n\n'.length);const old=d.id;await new Bot(f).handle(callback(OWNER_ID,'ads:confirm:'+old));await new Bot(f).handle(callback(OWNER_ID,'ads:link:'+old));await new Bot(f).handle(message(OWNER_ID,'Подробнее | https://example.org/offer'));d=await f.store.meta('ad_draft');assert.notEqual(d.id,old);assert(!d.confirmed);assert.equal(adCalls(f).at(-1).reply_markup.inline_keyboard[0][0].url,'https://example.org/offer');await new Bot(f).handle(callback(OWNER_ID,'ads:start:'+old));assert.equal(await f.store.meta('ad_current'),null);await new Bot(f).handle(callback(OWNER_ID,'ads:new'));await new Bot(f).handle(callback(OWNER_ID,'admin'));assert.equal((await f.store.user(OWNER_ID)).pending,undefined);await new Bot(f).handle(message(OWNER_ID,'молоко'));assert.equal(await f.store.meta('ad_draft'),null);
});
test('advertising audit expires after ten days and rejected previews cannot be launched',async()=>{
 const f=await setup(1);await record(f,'ad_audit','old',{action:'create'});await f.db.run("UPDATE sd_admin_records SET at=0 WHERE kind='ad_audit'");await new Bot(f).handle(callback(OWNER_ID,'ads'));assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM sd_admin_records WHERE kind='ad_audit'")).n,0);const send=f.api.sendMessage;f.api.sendMessage=async p=>{if(p.text?.startsWith('📣 Реклама'))throw Error('preview unavailable');return send(p);};const d=await draft(f);assert(!d.previewed);await launch(f,d);assert.equal(await f.store.meta('ad_current'),null);
});

test('deleting user data removes their advertising targets and receipts without affecting another user',async()=>{
 const f=await setup(2),d=await draft(f);await launch(f,d);assert(await read(f,'ad_delivery',d.id+':1'));await f.store.deleteUser(1);assert.equal(await read(f,'ad_delivery',d.id+':1'),undefined);assert.equal(await read(f,'ad_target',d.id+':'+String(1).padStart(20,'0')),undefined);assert(await read(f,'ad_delivery',d.id+':2'));await f.store.ensure(1);await next(f);assert.equal(adCalls(f).filter(p=>p.chat_id===1).length,1);
});

test('runtime check validates the actual atomic launch SQL with no lease and creates no ad state',async()=>{
 const f=await setup(1),before=await f.db.get('SELECT COUNT(*) AS n FROM sd_admin_records');assert.deepEqual(await checkAds(f.store),{ok:true,launch_sql_checked:true,changed_rows:0,campaign_state:'none',draft_present:false});assert.deepEqual(await f.db.get('SELECT COUNT(*) AS n FROM sd_admin_records'),before);assert.equal(adCalls(f).length,0);
});
