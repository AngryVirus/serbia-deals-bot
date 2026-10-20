import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,message,callback,offer,publish} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {OWNER_ID,day} from '../tgcloud/lib/domain.js';
import {Store} from '../tgcloud/lib/store.js';
import {record,rawRole,roleOf,rank,mayRole,mayBan,decide,lockUser,unlockUser,userStats,resolveTarget} from '../tgcloud/lib/moderation-state.js';
import {deliverNotice,noticeTick,noticeText} from '../tgcloud/lib/moderation-notices.js';
import {prepareNotifications,deliverNotifications} from '../tgcloud/lib/notifications.js';
const actor=(id=OWNER_ID)=>({id,name:'Actual actor '+id,username:'actor_'+id});
let seq=0;
async function change(f,uid,kind,fields={},who=OWNER_ID){const old=await record(f.store,kind,uid);const ak='test-actor-'+(++seq),tk='test-target-'+seq;assert(await lockUser(f.store,who,ak));try{if(uid!==who)assert(await lockUser(f.store,uid,tk));return await decide(f.store,actor(who),{uid,kind,previous:old?.version||null,nonce:'version'+seq,...fields,locks:{actor:ak,target:tk}});}finally{await unlockUser(f.store,who,ak);await unlockUser(f.store,uid,tk);}}
async function role(f,uid,next='moderator',who=OWNER_ID){await f.store.ensure(uid);return change(f,uid,'role',{next},who);}
async function ban(f,uid,who=OWNER_ID){return change(f,uid,'ban',{active:true,reason:'Тестовая причина'},who);}
const keys=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
async function confirmLast(f,uid=OWNER_ID){const data=keys(f).find(k=>k?.startsWith('admin:confirm:'));assert(data);await new Bot(f).handle(callback(uid,data));return data;}

test('role hierarchy rejects self, owner, peers and administrative escalation',async()=>{
 for(const r of ['user','moderator','admin','owner']){assert.equal(mayBan(r,5,'owner',OWNER_ID),false);assert.equal(mayBan(r,5,'user',5),false);}
 assert(mayBan('moderator',5,'user',6));assert(!mayBan('moderator',5,'moderator',6));assert(!mayRole('admin',5,'moderator',6,'admin'));assert(!mayRole('admin',5,'admin',6,'user'));assert(mayRole('owner',OWNER_ID,'moderator',6,'admin'));
 const f=await fixture();await role(f,5,'admin');await role(f,6,'moderator',5);await assert.rejects(role(f,6,'admin',5),/Недостаточно/);await assert.rejects(role(f,OWNER_ID,'user'),/Недостаточно/);await assert.rejects(ban(f,5,5),/Недостаточно/);
});
test('staff menus expose only permitted tools and ordinary forged callbacks cannot grant roles',async()=>{
 const f=await fixture();await role(f,5);await role(f,6,'admin');
 await new Bot(f).handle(callback(5,'admin'));assert.deepEqual(keys(f),['admin:ban','home']);
 await new Bot(f).handle(callback(6,'admin'));assert(keys(f).includes('admin:list:team:0'));assert(!keys(f).some(k=>/stats|audit|sources/.test(k)));
 await new Bot(f).handle(callback(7,'admin:role:8:admin'));assert.equal(await roleOf(f.store,8),'user');assert.equal(keys(f).length,4);
 await new Bot(f).handle(callback(5,'admin:stats'));assert(f.sent.at(-1).text.includes('недоступно'));
 await new Bot(f).handle(callback(5,'admin:unban:8'));assert(f.sent.at(-1).text.includes('Недостаточно'));
 const fake=callback(OWNER_ID,'admin');fake.callback_query.message.chat.id=7;const count=f.sent.length;await new Bot(f).handle(fake);assert.equal(f.sent.length,count);
});
test('owner promotes, demotes and revokes directly; actor and transition appear in notices and audit',async()=>{
 const f=await fixture();await role(f,5);
 for(const [next,action] of [['admin','promote'],['moderator','demote'],['user','revoke']]){
  const cb=callback(OWNER_ID,`admin:role:5:${next}`);Object.assign(cb.callback_query.from,{first_name:'Настоящий',username:'RealActor'});await new Bot(f).handle(cb);
  const confirm=callback(OWNER_ID,keys(f).find(k=>k.startsWith('admin:confirm:')));Object.assign(confirm.callback_query.from,{first_name:'Настоящий',username:'RealActor'});await new Bot(f).handle(confirm);
  assert.equal(await rawRole(f.store,5),next);const r=await record(f.store,'role',5);assert.equal(r.action,action);assert.equal(r.actor.username,'RealActor');assert.equal(r.notice,'sent');assert(f.sent.some(p=>p.chat_id===5&&p.text?.includes('RealActor')));
 }
 assert.equal((await f.db.get("SELECT COUNT(*) n FROM sd_admin_records WHERE kind='audit'")).n,4);
});
test('ban requires ID and reason, confirmation replay creates one event and one picture with support only for recipient',async()=>{
 const f=await fixture();f.InputFile=class{constructor(bytes){this.bytes=bytes;}};await f.store.ensure(5);await role(f,6);
 await new Bot(f).handle(callback(6,'admin:ban'));await new Bot(f).handle(message(6,'5'));await new Bot(f).handle(message(6,'Нарушение правил'));
 assert(!f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.url));assert(!await record(f.store,'ban',5));
 const data=await confirmLast(f,6);await new Bot(f).handle(callback(6,data));const notices=f.sent.filter(p=>p.chat_id===5&&p.photo);assert.equal(notices.length,1);assert(notices[0].photo.bytes.length>1000);assert.equal(notices[0].reply_markup.inline_keyboard[0][0].url,'https://t.me/AngryVirus');
 const r=await record(f.store,'ban',5);assert.equal(r.actor.id,6);assert.equal(r.reason,'Нарушение правил');assert(noticeText('ban',r).includes('6'));assert.equal((await f.db.get("SELECT COUNT(*) n FROM sd_admin_records WHERE kind='audit' AND json_extract(payload,'$.kind')='ban'")).n,1);
});
test('banned users get no callback acknowledgement or search, ban survives deletion and fresh Store',async()=>{
 const f=await fixture();await f.store.ensure(5);await ban(f,5);await deliverNotice(f.store,f.api,null,'ban',5);const before=f.sent.length;let acks=0;f.api.answerCallbackQuery=async()=>{acks++;};
 for(const u of [callback(5,'notify:on'),callback(5,'admin'),message(5,'/start'),message(5,'/delete')])await new Bot(f).handle(u);
 assert.equal(acks,0);assert.equal(f.sent.length,before);await f.store.deleteUser(5);const other=new Store(f.db);assert.equal((await record(other,'ban',5)).active,true);await new Bot(f).handle(message(5,'/start'));assert.equal(await other.user(5),null);
});
test('preban by ID delivers exactly once on first contact without creating banned profile',async()=>{
 const f=await fixture();await ban(f,55);assert.equal((await deliverNotice(f.store,f.api,null,'ban',55)).sent,0);await new Bot(f).handle(message(55,'/start'));await new Bot(f).handle(message(55,'/menu'));assert.equal(f.sent.filter(p=>p.chat_id===55).length,1);assert.equal(await f.store.user(55),null);
});
test('administrator can unban users but cannot unban a banned peer administrator',async()=>{
 const f=await fixture();await role(f,5,'admin');await role(f,6,'admin');await ban(f,6);assert.equal(await roleOf(f.store,6),'user');assert.equal(await rawRole(f.store,6),'admin');await assert.rejects(change(f,6,'ban',{active:false},5),/Недостаточно/);
 await ban(f,7);await change(f,7,'ban',{active:false},5);assert.equal((await record(f.store,'ban',7)).active,false);
 await role(f,8);await ban(f,9,8);await assert.rejects(change(f,9,'ban',{active:false},8),/Недостаточно/);
});
test('stale role version and revoked actor invalidate previously displayed confirmation',async()=>{
 const f=await fixture();await role(f,5,'admin');await f.store.ensure(6);await new Bot(f).handle(callback(5,'admin:role:6:moderator'));const token=keys(f).find(k=>k.startsWith('admin:confirm:'));
 await change(f,5,'role',{next:'user'});await new Bot(f).handle(callback(5,token));assert.equal(await rawRole(f.store,6),'user');
 const old=await record(f.store,'role',5);await change(f,5,'role',{next:'admin'});await assert.rejects(decide(f.store,actor(),{kind:'role',uid:5,next:'moderator',previous:old.version,nonce:'stale'}),/Состояние/);
});
test('username lookup verifies numeric private chat and rechecks reassigned tag on confirmation',async()=>{
 const f=await fixture();await f.store.ensure(5);await f.store.patch(5,{username:'Known_User'});let actual='Known_User';f.api.getChat=async({chat_id})=>({id:chat_id,type:'private',username:actual});
 assert.equal((await resolveTarget(f.store,f.api,'@known_user')).uid,5);await new Bot(f).handle(callback(OWNER_ID,'admin:ban'));await new Bot(f).handle(message(OWNER_ID,'@Known_User'));await new Bot(f).handle(message(OWNER_ID,'Причина'));actual='Changed_User';await confirmLast(f);assert.equal(await record(f.store,'ban',5),null);assert(f.sent.at(-1).text.includes('@username'));
 await assert.rejects(resolveTarget(f.store,f.api,'@unknown_user'),/не найден/);
});
test('parallel notice workers send once; ambiguous delivery and interrupted sending never replay',async()=>{
 const f=await fixture();await f.store.ensure(5);await ban(f,5);const results=await Promise.all([noticeTick(f.store,f.api),noticeTick(f.store,f.api)]);assert.equal(results.reduce((n,r)=>n+r.sent,0),1);assert.equal(f.sent.length,1);
 await change(f,5,'ban',{active:false});let calls=0;f.api.sendMessage=async()=>{calls++;throw Error('timeout');};await noticeTick(f.store,f.api);await noticeTick(f.store,f.api);assert.equal(calls,1);assert.equal((await record(f.store,'ban',5)).notice,'uncertain');
 await ban(f,5);await f.db.run("UPDATE sd_admin_records SET payload=json_set(payload,'$.notice','sending') WHERE kind='ban'");await noticeTick(f.store,f.api);assert.equal(calls,1);
});
test('429 retries after its deadline, 403 retries only after real private contact',async()=>{
 const f=await fixture();await f.store.ensure(5);await ban(f,5);f.api.sendMessage=async()=>{throw {code:429,parameters:{retry_after:120}};};await noticeTick(f.store,f.api);const waiting=await record(f.store,'ban',5);assert.equal(waiting.notice,'pending');assert(waiting.retry>Date.now()+110000);assert.equal((await noticeTick(f.store,f.api)).checked,0);
 await f.db.run("UPDATE sd_admin_records SET payload=json_set(payload,'$.retry',0)");f.api.sendMessage=async()=>{throw {code:403,description:'Forbidden: bot was blocked by the user'};};await noticeTick(f.store,f.api);assert.equal((await record(f.store,'ban',5)).notice,'blocked');assert.equal((await noticeTick(f.store,f.api)).checked,0);
 let count=0;f.api.sendMessage=async()=>{count++;return {message_id:1};};await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(message(5,'/start'));assert.equal(count,1);
});
test('target lease serializes ban confirmation with workers and retries without losing draft',async()=>{
 const f=await fixture();await f.store.ensure(5);await new Bot(f).handle(callback(OWNER_ID,'admin:ban:5'));await new Bot(f).handle(message(OWNER_ID,'Причина'));const token=keys(f).find(k=>k.startsWith('admin:confirm:'));
 assert(await lockUser(f.store,5,'other'));await new Bot(f).handle(callback(OWNER_ID,token));assert.equal(await record(f.store,'ban',5),null);assert((await f.store.user(OWNER_ID)).adminDraft);await unlockUser(f.store,5,'other');await new Bot(f).handle(callback(OWNER_ID,token));assert((await record(f.store,'ban',5)).active);
});
test('price notifications never reach banned users, queued prices cancelled and settings preserved',async()=>{
 const f=await fixture();await f.store.ensure(5);await publish(f,[offer()]);await f.store.watch(5,offer().id);await f.db.run('UPDATE sd_users SET enabled=1 WHERE id=5');await publish(f,[offer(1,{regular:10000})],'c'.repeat(32));await prepareNotifications(f.store);await ban(f,5);assert.equal((await f.db.get('SELECT state FROM sd_queue')).state,'cancelled');assert.equal((await deliverNotifications(f.store,f.api)).sent,0);assert.equal((await f.store.user(5)).enabled,1);await prepareNotifications(f.store);assert.equal(f.sent.length,0);
});
test('delivery holds target lease until send finishes, preventing conflicting administrative decision',async()=>{
 const f=await fixture();await f.store.ensure(5);await publish(f,[offer()]);await f.store.watch(5,offer().id);await f.db.run('UPDATE sd_users SET enabled=1 WHERE id=5');await publish(f,[offer(1,{regular:10000})],'c'.repeat(32));await prepareNotifications(f.store);
 let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);f.api.sendMessage=async()=>{started();await gate;return {message_id:1};};const sending=deliverNotifications(f.store,f.api);await ready;assert.equal(await lockUser(f.store,5,'ban-attempt'),false);release();await sending;assert(await lockUser(f.store,5,'ban-attempt'));await unlockUser(f.store,5,'ban-attempt');
});
test('audit retention removes only records older than ten days; bans and roles persist',async()=>{
 const f=await fixture();await role(f,5);await ban(f,6);const old=Date.now()-11*86400000;await f.db.run("UPDATE sd_admin_records SET at=:old",{':old':old});await f.store.init();assert.equal((await f.db.get("SELECT COUNT(*) n FROM sd_admin_records WHERE kind='audit'")).n,0);assert.equal(await rawRole(f.store,5),'moderator');assert((await record(f.store,'ban',6)).active);
});
test('activity stats distinguish old unknown registration, confirmed bot block and generic 403',async()=>{
 const f=await fixture();await f.db.run("INSERT INTO sd_users(id,payload,blocked) VALUES(5,'{}',1)");await f.store.patch(5,{delivery_blocked:true});await new Bot(f).handle(message(6,'/start'));await f.store.ensure(7);await f.db.run('UPDATE sd_users SET blocked=1 WHERE id=7');const s=await userStats(f.store);assert.equal(s.total,3);assert.equal(s.today,1);assert.equal(s.new_today,2);assert.equal(s.unavailable,2);assert.equal(s.blocked_bot,1);assert.equal((await f.store.user(5)).first_day,undefined);
 await new Bot(f).handle(message(5,'/start'));assert.equal((await userStats(f.store)).unavailable,1);assert.equal((await f.store.user(5)).first_day,undefined);
});
test('navigation and cancel discard pending administration without consuming shopping messages',async()=>{
 const f=await fixture();await new Bot(f).handle(callback(OWNER_ID,'admin:ban'));await new Bot(f).handle(message(OWNER_ID,'/cancel'));assert.equal((await f.store.user(OWNER_ID)).adminInput,undefined);await new Bot(f).handle(callback(OWNER_ID,'admin:ban'));await new Bot(f).handle(callback(OWNER_ID,'search'));assert.equal((await f.store.user(OWNER_ID)).adminInput,undefined);
});
test('expired decision lease cannot commit state or audit after another worker takes over',async()=>{
 const f=await fixture();await f.store.ensure(5);await lockUser(f.store,OWNER_ID,'actor');await lockUser(f.store,5,'target');await f.db.run('UPDATE sd_locks SET expires=0 WHERE id=5');
 await assert.rejects(decide(f.store,actor(),{kind:'ban',uid:5,active:true,reason:'Причина',previous:null,nonce:'expired-lease',locks:{actor:'actor',target:'target'}}),/Состояние/);assert.equal(await record(f.store,'ban',5),null);assert.equal((await f.db.get("SELECT COUNT(*) n FROM sd_admin_records WHERE kind='audit'")).n,0);
});
test('simultaneous confirmations by different staff commit a single ban and audit',async()=>{
 const f=await fixture();await f.store.ensure(5);await role(f,6,'admin');const tokens=[];
 for(const uid of [OWNER_ID,6]){await new Bot(f).handle(callback(uid,'admin:ban:5'));await new Bot(f).handle(message(uid,'Причина '+uid));tokens.push(keys(f).find(k=>k.startsWith('admin:confirm:')));}
 await Promise.all([new Bot(f).handle(callback(OWNER_ID,tokens[0])),new Bot(f).handle(callback(6,tokens[1]))]);assert((await record(f.store,'ban',5)).active);assert.equal((await f.db.get("SELECT COUNT(*) n FROM sd_admin_records WHERE kind='audit' AND json_extract(payload,'$.kind')='ban'")).n,1);assert.equal(f.sent.filter(p=>p.chat_id===5&&p.text?.includes('Доступ к боту ограничен')).length,1);
});
