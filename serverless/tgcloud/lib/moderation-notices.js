import {record,label,lockUser,unlockUser} from './moderation-state.js';
import {safe,positive} from './domain.js';
import {renderImage} from './image-renderer.js';
export function noticeText(kind,row){
 const who=safe(label(row.actor));
 if(kind==='ban')return row.active?`<b>Доступ к боту ограничен</b>\n\nПричина: ${safe(row.reason)}\nЗаблокировал: ${who}\n\nЕсли вы не согласны с блокировкой, обратитесь к руководству бота по кнопке ниже.`:`<b>Доступ к боту восстановлен</b>\n\nБлокировку снял: ${who}\nПредыдущая причина: ${safe(row.reason)}\nЗаблокировал: ${safe(label(row.ban_actor))}\n\nВы снова можете пользоваться ботом. Нажмите /start.`;
 const titles={grant:'Вам назначены полномочия',promote:'Ваши полномочия повышены',demote:'Ваши полномочия понижены',revoke:'Ваши полномочия сняты'};
 const rights=row.role==='admin'?'Вы можете блокировать и разблокировать пользователей, назначать и снимать модераторов.':row.role==='moderator'?'Вы можете блокировать пользователей.':'Административные функции больше недоступны.';
 return `<b>${titles[row.action]||'Полномочия изменены'}</b>\n\nРоль: ${row.role==='admin'?'Администратор':row.role==='moderator'?'Модератор':'Пользователь'}\nИзменил: ${who}\n\n${rights}\n\nОткройте /menu, чтобы увидеть доступные функции.`;
}
// Must hold recipient lease, shared with inbound updates and price deliveries.
export async function deliverNotice(store,api,InputFile,kind,uid,contact=false,heldLock=null){
 if(!heldLock){const key='direct-notice:'+Date.now()+':'+Math.random();if(!await lockUser(store,uid,key))return {sent:0};try{return await deliverNotice(store,api,InputFile,kind,uid,contact,key);}finally{await unlockUser(store,uid,key);}}
 const row=await record(store,kind,uid);if(!row)return {sent:0};
 if(!(row.notice==='pending'&&row.retry<=Date.now()||contact&&row.notice==='blocked'))return {sent:0};
 if(!contact&&!await store.user(uid))return {sent:0};
 const claim=await store.db.run(`UPDATE sd_admin_records SET payload=json_set(payload,'$.notice','sending') WHERE kind=:kind AND key=:uid AND json_extract(payload,'$.version')=:version AND json_extract(payload,'$.notice')=:state AND EXISTS(SELECT 1 FROM sd_locks WHERE id=:target AND owner=:lock AND expires>:now)`,{':kind':kind,':uid':String(uid),':version':row.version,':state':row.notice,':target':uid,':lock':heldLock,':now':Date.now()});
 if(claim.rowsAffected!==1)return {sent:0};
 let state='sent',retry=0;
 try{
  const text=noticeText(kind,row),reply_markup=kind==='ban'?{inline_keyboard:[[{text:'💬 Связаться с руководством',url:'https://t.me/AngryVirus'}]]}:undefined;
  let message;
  if(kind==='ban'&&InputFile){const image=renderImage(text);message=await api.sendPhoto({chat_id:uid,photo:new InputFile(image.bytes,'access-notice.png',{type:'image/png'}),reply_markup});}
  else message=await api.sendMessage({chat_id:uid,text,parse_mode:'HTML',...(reply_markup?{reply_markup}:{})});
  if(!positive(message?.message_id))throw Error('Unconfirmed notification');
 }catch(error){
  const code=error.error_code||error.code;
  state=code===429?'pending':code===403?'blocked':code===400?'failed':'uncertain';
  if(code===403){await store.patch(uid,{delivery_blocked:/bot was blocked by the user/i.test(error.description||error.message||'')});await store.db.run('UPDATE sd_users SET blocked=1,enabled=0 WHERE id=:uid',{':uid':uid});}
  if(code===429)retry=Date.now()+Math.min(86400,Math.max(60,Number(error.parameters?.retry_after)||60))*1000;
 }
 await store.db.run(`UPDATE sd_admin_records SET payload=json_set(payload,'$.notice',:state,'$.retry',:retry) WHERE kind=:kind AND key=:uid AND json_extract(payload,'$.version')=:version AND json_extract(payload,'$.notice')='sending'`,{':kind':kind,':uid':String(uid),':version':row.version,':state':state,':retry':retry});
 return {sent:state==='sent'?1:0,state};
}
export async function noticeTick(store,api,InputFile){
 const rows=await store.db.all(`SELECT r.kind,r.key FROM sd_admin_records r JOIN sd_users u ON CAST(u.id AS TEXT)=r.key WHERE r.kind IN ('role','ban') AND json_extract(r.payload,'$.notice')='pending' AND COALESCE(json_extract(r.payload,'$.retry'),0)<=:now ORDER BY r.at LIMIT 5`,{':now':Date.now()});let sent=0;
 for(const row of rows){const uid=Number(row.key),key='notice:'+row.kind+':'+Date.now()+':'+Math.random();if(!await lockUser(store,uid,key))continue;
  try{sent+=(await deliverNotice(store,api,InputFile,row.kind,uid,false,key)).sent;}finally{await unlockUser(store,uid,key);}
 }return {sent,checked:rows.length};
}
