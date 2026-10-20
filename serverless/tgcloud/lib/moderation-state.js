import {OWNER_ID,positive,day} from './domain.js';
export const ROLE_NAMES={user:'Пользователь',moderator:'Модератор',admin:'Администратор',owner:'Владелец'};
export const rank=role=>({user:0,moderator:1,admin:2,owner:3}[role]??0);
export const snapshot=from=>({id:from.id,name:[from.first_name,from.last_name].filter(Boolean).join(' ').slice(0,100),username:/^[a-zA-Z0-9_]{5,32}$/.test(from.username||'')?from.username:null});
export const label=person=>[person?.name,person?.username?'@'+person.username:null].filter(Boolean).join(' · ')||String(person?.id||'не указан');
export async function record(store,kind,uid){const r=await store.db.get('SELECT payload FROM sd_admin_records WHERE kind=:kind AND key=:key',{':kind':kind,':key':String(uid)});return r?JSON.parse(r.payload):null;}
export async function banned(store,uid){return uid!==OWNER_ID&&(await record(store,'ban',uid))?.active===true;}
export async function rawRole(store,uid){if(uid===OWNER_ID)return 'owner';const role=(await record(store,'role',uid))?.role;return ['moderator','admin'].includes(role)?role:'user';}
export async function roleOf(store,uid){return await banned(store,uid)?'user':rawRole(store,uid);}
export const mayBan=(actor,actorId,target,targetId)=>positive(targetId)&&actorId!==targetId&&targetId!==OWNER_ID&&rank(actor)>rank(target);
export const mayRole=(actor,actorId,target,targetId,next)=>mayBan(actor,actorId,target,targetId)&&['user','moderator','admin'].includes(next)&&(actor==='owner'||actor==='admin'&&['user','moderator'].includes(target)&&['user','moderator'].includes(next));
export async function lockUser(store,uid,key,now=Date.now()){return (await store.db.run(`INSERT INTO sd_locks(id,owner,expires) VALUES(:uid,:key,:expires) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE sd_locks.expires<=:now`,{':uid':uid,':key':key,':expires':now+180000,':now':now})).rowsAffected===1;}
export async function unlockUser(store,uid,key){await store.db.run('DELETE FROM sd_locks WHERE id=:uid AND owner=:key',{':uid':uid,':key':key});}
export async function trackUser(store,from,now=Date.now()){
 const fields={...snapshot(from),last_seen:now,last_day:day(now),delivery_blocked:false};
 await store.patch(from.id,fields);await store.db.run('UPDATE sd_users SET blocked=0 WHERE id=:uid',{':uid':from.id});
}
export async function resolveTarget(store,api,input){
 if(/^[1-9]\d{0,15}$/.test(input)&&positive(Number(input)))return {uid:Number(input)};
 if(!/^@[a-zA-Z0-9_]{5,32}$/.test(input))throw Error('Введите числовой Telegram ID или @username.');
 const tag=input.slice(1).toLowerCase(),rows=await store.db.all(`SELECT id FROM sd_users WHERE lower(json_extract(payload,'$.username'))=:tag LIMIT 2`,{':tag':tag});
 if(rows.length!==1)throw Error('Пользователь с этим @username не найден. Попросите его открыть бота или укажите числовой ID.');
 await verifyTag(api,rows[0].id,tag);return {uid:rows[0].id,tag};
}
export async function verifyTag(api,uid,tag){
 if(!tag)return;
 let chat;try{chat=await api.getChat({chat_id:uid});}catch{throw Error('Не удалось проверить @username. Используйте числовой ID.');}
 if(chat?.type!=='private'||chat.id!==uid||chat.username?.toLowerCase()!==tag)throw Error('@username изменился. Выберите пользователя заново по ID.');
}
// Caller holds both actor and target leases. Decision and audit commit together.
export async function decide(store,actor,draft,now=Date.now()){
 const currentRole=await rawRole(store,draft.uid),actorRole=await roleOf(store,actor.id),old=await record(store,draft.kind,draft.uid);
 if((old?.version||null)!==(draft.previous||null))throw Error('Состояние изменилось. Откройте карточку заново.');
 if(draft.kind==='role'){
  if(!mayRole(actorRole,actor.id,currentRole,draft.uid,draft.next)||draft.next===currentRole)throw Error('Недостаточно прав для изменения этой роли.');
  if(draft.next!=='user'&&await banned(store,draft.uid))throw Error('Сначала снимите блокировку пользователя.');
  if(!await store.user(draft.uid))throw Error('Сначала попросите пользователя открыть бота.');
 }else{
  if(!mayBan(actorRole,actor.id,currentRole,draft.uid)||!draft.active&&rank(actorRole)<2)throw Error('Недостаточно прав для этого действия.');
  if(Boolean(old?.active)===draft.active)throw Error('Это состояние уже установлено.');
  if(draft.active&&(!draft.reason?.trim()||draft.reason.length>300))throw Error('Укажите причину от 1 до 300 символов.');
 }
 const action=draft.kind==='ban'?(draft.active?'ban':'unban'):draft.next==='user'?'revoke':rank(draft.next)>rank(currentRole)?(currentRole==='user'?'grant':'promote'):'demote';
 const value={version:draft.nonce,uid:draft.uid,actor,at:now,action,notice:'pending',retry:0,...(draft.kind==='role'?{role:draft.next,previous_role:currentRole}:{active:draft.active,reason:draft.active?draft.reason:old.reason,ban_actor:draft.active?actor:old.ban_actor||old.actor})};
 const audit={uid:draft.uid,actor,action,kind:draft.kind,role:draft.next||null,reason:draft.kind==='ban'?value.reason:null,at:now};
 const committed=await store.db.run(`INSERT INTO sd_admin_records(kind,key,payload,at) SELECT kind,key,payload,:now FROM (SELECT :kind AS kind,:uid AS key,:value AS payload UNION ALL SELECT 'audit',:version,:audit) WHERE EXISTS(SELECT 1 FROM sd_locks WHERE id=:actor AND owner=:actorLock AND expires>:leaseNow) AND EXISTS(SELECT 1 FROM sd_locks WHERE id=:target AND owner=:targetLock AND expires>:leaseNow) ON CONFLICT(kind,key) DO UPDATE SET payload=excluded.payload,at=excluded.at`,{':kind':draft.kind,':uid':String(draft.uid),':value':JSON.stringify(value),':now':now,':version':draft.nonce,':audit':JSON.stringify(audit),':actor':actor.id,':target':draft.uid,':actorLock':draft.locks?.actor||'',':targetLock':draft.locks?.target||'',':leaseNow':Date.now()});
 if(committed.rowsAffected!==2)throw Error('Состояние изменилось. Откройте карточку заново.');
 await store.patch(draft.uid,{adminInput:null,adminDraft:null,pending:null});
 if(draft.kind==='ban'&&draft.active)await store.db.run("UPDATE sd_queue SET state='cancelled' WHERE uid=:uid AND state='pending'",{':uid':draft.uid});
 return value;
}
export async function userStats(store,now=Date.now()){
 const today=day(now),week=day(now-6*86400000),month=day(now-29*86400000);
 return store.db.get(`SELECT COUNT(*) AS total,COALESCE(SUM(json_extract(payload,'$.last_day')=:today),0) AS today,COALESCE(SUM(json_extract(payload,'$.last_day')>=:week),0) AS week,COALESCE(SUM(json_extract(payload,'$.last_day')>=:month),0) AS month,COALESCE(SUM(json_extract(payload,'$.first_day')=:today),0) AS new_today,COALESCE(SUM(json_extract(payload,'$.first_day')>=:week),0) AS new_week,COALESCE(SUM(json_extract(payload,'$.first_day')>=:month),0) AS new_month,COALESCE(SUM(enabled=1 AND blocked=0 AND NOT EXISTS(SELECT 1 FROM sd_admin_records b WHERE b.kind='ban' AND b.key=CAST(sd_users.id AS TEXT) AND json_extract(b.payload,'$.active')=1)),0) AS subscribed,COALESCE(SUM(blocked=1),0) AS unavailable,COALESCE(SUM(blocked=1 AND json_extract(payload,'$.delivery_blocked')=1),0) AS blocked_bot FROM sd_users`,{':today':today,':week':week,':month':month});
}
