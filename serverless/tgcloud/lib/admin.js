import {OWNER_ID,positive,safe,day} from './domain.js';
import {ROLE_NAMES,rank,roleOf,rawRole,record,banned,label,mayBan,mayRole,resolveTarget,verifyTag,decide,lockUser,unlockUser,userStats} from './moderation-state.js';
import {deliverNotice} from './moderation-notices.js';
const b=(text,callback_data)=>({text,callback_data}),BACK=[[b('⚙️ Админка','admin')],[b('🏠 Меню','home')]],nonce=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,12);
const person=async(bot,uid)=>({id:uid,...await bot.store.user(uid)});
const show=(bot,text,rows=BACK)=>bot.panel(text,rows);
async function setInput(bot,input){await bot.store.patch(bot.uid,{adminInput:input,adminDraft:null,pending:null});bot.user.adminInput=input;bot.user.adminDraft=null;}
async function targetCard(bot,uid){
 const role=await roleOf(bot.store,bot.uid),targetRole=await rawRole(bot.store,uid),target=await person(bot,uid),ban=await record(bot.store,'ban',uid),rows=[];
 if(mayBan(role,bot.uid,targetRole,uid)){
  if(!ban?.active)rows.push([b('🚫 Заблокировать','admin:ban:'+uid)]);
  else if(rank(role)>=2)rows.push([b('✅ Разблокировать','admin:unban:'+uid)]);
 }
 for(const next of ['moderator','admin','user'])if(next!==targetRole&&mayRole(role,bot.uid,targetRole,uid,next)&&(!ban?.active||next==='user'))rows.push([b(next==='user'?'Снять полномочия':rank(next)>rank(targetRole)?'Назначить '+ROLE_NAMES[next].toLowerCase():'Понизить до модератора',`admin:role:${uid}:${next}`)]);
 return show(bot,`<b>${safe(label(target))}</b>\nID: ${uid}\nРоль: ${ROLE_NAMES[targetRole]}\nСтатус: ${ban?.active?'заблокирован':'доступ открыт'}`+(ban?.active?`\nПричина: ${safe(ban.reason)}\nЗаблокировал: ${safe(label(ban.actor))}`:''),[...rows,...BACK]);
}
async function preview(bot,kind,uid,fields={},tag=null){
 const actorRole=await roleOf(bot.store,bot.uid),targetRole=await rawRole(bot.store,uid),old=await record(bot.store,kind,uid);
 if(kind==='role'?!mayRole(actorRole,bot.uid,targetRole,uid,fields.next):!mayBan(actorRole,bot.uid,targetRole,uid)||!fields.active&&rank(actorRole)<2)return show(bot,'<b>Недостаточно прав</b>');
 const draft={kind,uid,...fields,tag,nonce:nonce(),previous:old?.version||null,expires:Date.now()+10*60000};
 await bot.store.patch(bot.uid,{adminDraft:draft,adminInput:null});bot.user.adminDraft=draft;
 const target=await person(bot,uid),title=kind==='role'?'Изменить полномочия?':fields.active?'Заблокировать пользователя?':'Разблокировать пользователя?';
 return show(bot,`<b>${title}</b>\n\n${safe(label(target))}\nID: ${uid}\n`+(kind==='role'?`${ROLE_NAMES[targetRole]} → ${ROLE_NAMES[fields.next]}`:`Причина: ${safe(fields.reason||old?.reason||'не указана')}`)+`\nДействие выполнит: ${safe(label(bot.actor))}\n\nПользователь получит отдельное уведомление.`,[[b('Подтвердить','admin:confirm:'+draft.nonce)],...BACK]);
}
async function confirm(bot,token){
 const draft=bot.user.adminDraft;
 if(!draft||draft.nonce!==token||draft.expires<Date.now())return show(bot,'<b>Подтверждение устарело</b>\n\nОткройте карточку пользователя заново.');
 const key='admin:'+bot.uid+':'+draft.nonce;
 if(!await lockUser(bot.store,draft.uid,key))return show(bot,'<b>Пользователь сейчас занят</b>\n\nПовторите подтверждение через несколько секунд.',[[b('Повторить','admin:confirm:'+draft.nonce)],...BACK]);
 try{
  await verifyTag(bot.api,draft.uid,draft.tag);
  await decide(bot.store,bot.actor,{...draft,locks:{actor:bot.requestLock,target:key}});
  await bot.store.patch(bot.uid,{adminDraft:null,adminInput:null});
  const notice=await deliverNotice(bot.store,bot.api,bot.InputFile,draft.kind,draft.uid,false,key);
  const text=notice.sent?'Уведомление доставлено.':notice.state==='uncertain'?'Доставка уведомления не подтверждена; автоматического повтора не будет.':notice.state==='failed'?'Не удалось отправить уведомление.':notice.state==='blocked'?'Пользователь недоступен для сообщений.':'Уведомление ожидает доставки.';
  return show(bot,'<b>Готово</b>\n\n'+text,[...(rank(await roleOf(bot.store,bot.uid))>=2?[[b('К пользователю','admin:user:'+draft.uid)]]:[]),...BACK]);
 }catch(error){const allowed=/Недостаточно|Состояние изменилось|Сначала|состояние уже|Укажите причину|@username|Не удалось проверить/.test(error.message);return show(bot,'<b>Действие не выполнено</b>\n\n'+(allowed?safe(error.message):'Повторите позже. Изменение могло сохраниться — проверьте карточку пользователя.'));}
 finally{await unlockUser(bot.store,draft.uid,key);}
}
async function list(bot,kind,page=0){
 const role=await roleOf(bot.store,bot.uid);if(kind==='audit'&&role!=='owner'||kind==='users'&&role!=='owner'||kind==='team'&&rank(role)<2||kind==='bans'&&rank(role)<2)return show(bot,'<b>Недостаточно прав</b>');
 let rows,title;
 if(kind==='users'){rows=await bot.store.db.all('SELECT id,payload FROM sd_users ORDER BY id LIMIT 6 OFFSET :offset',{':offset':page*5});title='Пользователи';}
 else {rows=await bot.store.db.all(`SELECT key,payload FROM sd_admin_records WHERE kind=:kind ${kind==='bans'?"AND json_extract(payload,'$.active')=1":kind==='team'?"AND json_extract(payload,'$.role') IN ('moderator','admin')":''} ORDER BY at DESC,key LIMIT 6 OFFSET :offset`,{':kind':kind==='team'?'role':kind==='bans'?'ban':'audit',':offset':page*5});title=kind==='team'?'Команда':kind==='bans'?'Блокировки':'Журнал команды · 10 дней';}
 const shown=rows.slice(0,5),buttons=[];let text=`<b>${title}</b>\n\n`;
 for(const row of shown){const data=JSON.parse(row.payload),uid=row.id||Number(row.key);if(kind==='audit'){const actions={ban:'блокировка',unban:'разблокировка',grant:'назначение',promote:'повышение',demote:'понижение',revoke:'снятие полномочий'};text+=`${day(data.at)} ${new Date(data.at).toISOString().slice(11,16)} UTC\n${safe(label(data.actor))}\n${actions[data.action]||data.action} · ID ${data.uid}${data.role?' · '+ROLE_NAMES[data.role]:''}${data.reason?'\nПричина: '+safe(data.reason):''}\n\n`;}
  else{const user=kind==='users'?{id:uid,...data}:await person(bot,uid);buttons.push([b(label(user).slice(0,55),'admin:user:'+uid)]);}
 }
 if(!shown.length)text+='Записей пока нет.';
 if(kind==='team')text+='Выберите человека, чтобы изменить его полномочия.';
 const nav=[];if(page)nav.push(b('⬅️ Назад',`admin:list:${kind}:${page-1}`));if(rows.length>5)nav.push(b('Далее ➡️',`admin:list:${kind}:${page+1}`));if(nav.length)buttons.push(nav);
 if(['team','users'].includes(kind))buttons.push([b('🔎 Найти по ID или @username','admin:find')]);
 return show(bot,text,[...buttons,...BACK]);
}
export async function adminRoute(bot,action,text){
 const role=await roleOf(bot.store,bot.uid),adminAction=action.startsWith('admin'),input=bot.user.adminInput;
 if(!adminAction&&!input)return false;
 if(rank(role)<1){await bot.store.patch(bot.uid,{adminInput:null,adminDraft:null});await bot.home();return true;}
 try{
  if(!adminAction&&text){
   if(input.kind==='reason'){
    if(!text.trim()||text.length>300){await show(bot,'<b>Укажите причину</b>\n\nОт 1 до 300 символов.');return true;}
    await preview(bot,'ban',input.uid,{active:true,reason:text},input.tag);
   }else{
    const target=await resolveTarget(bot.store,bot.api,text);
    if(input.kind==='ban'){
     const targetRole=await rawRole(bot.store,target.uid);if(!mayBan(role,bot.uid,targetRole,target.uid))throw Error('Недостаточно прав для блокировки этого пользователя.');
     await setInput(bot,{kind:'reason',...target});await show(bot,'<b>Причина блокировки</b>\n\nВведите причину от 1 до 300 символов. Она будет показана пользователю.');
    }else await targetCard(bot,target.uid);
   }
   if(input.kind!=='reason'&&input.kind!=='ban')await setInput(bot,null);
   if(bot.inputMessageId)try{await bot.api.deleteMessage({chat_id:bot.uid,message_id:bot.inputMessageId});}catch{}
   return true;
  }
  if(!adminAction)return false;
  // Navigating to another admin page invalidates an unrelated confirmation.
  if(!action.startsWith('admin:confirm:'))await setInput(bot,null);
  if(action==='admin'){
   const rows=[[b('🚫 Заблокировать','admin:ban')]];
   if(rank(role)>=2)rows.push([b('✅ Блокировки / разбаны','admin:list:bans:0')],[b('👥 Команда','admin:list:team:0')]);
   if(role==='owner')rows.push([b('📊 Пользователи','admin:stats')],[b('📋 Журнал команды','admin:list:audit:0')],[b('🏪 Состояние магазинов','admin:sources')]);
   await show(bot,`<b>Администрирование</b>\n\nВаша роль: ${ROLE_NAMES[role]}\n`+(role==='moderator'?'Вы можете блокировать пользователей.':role==='admin'?'Баны, разбаны и управление модераторами.':'Управление пользователями, командой и магазинами.'),[...rows,[b('🏠 Меню','home')]]);
  }else if(action==='admin:ban'||action==='admin:find'){
   if(action==='admin:find'&&rank(role)<2)throw Error('Недостаточно прав.');
   await setInput(bot,{kind:action==='admin:ban'?'ban':'find'});await show(bot,'<b>Кого выбрать?</b>\n\nПришлите числовой Telegram ID или @username. По имени можно найти только тех, кто уже открывал бота.\n\n/cancel — отменить.');
  }else if(/^admin:user:[1-9]\d{0,15}$/.test(action)){
   if(rank(role)<2)throw Error('Недостаточно прав.');await targetCard(bot,Number(action.split(':')[2]));
  }else if(/^admin:ban:[1-9]\d{0,15}$/.test(action)){
   const uid=Number(action.split(':')[2]);if(!mayBan(role,bot.uid,await rawRole(bot.store,uid),uid))throw Error('Недостаточно прав.');await setInput(bot,{kind:'reason',uid});await show(bot,'<b>Причина блокировки</b>\n\nВведите причину от 1 до 300 символов.');
  }else if(/^admin:unban:[1-9]\d{0,15}$/.test(action))await preview(bot,'ban',Number(action.split(':')[2]),{active:false});
  else if(/^admin:role:[1-9]\d{0,15}:(user|moderator|admin)$/.test(action)){const [, ,uid,next]=action.split(':');await preview(bot,'role',Number(uid),{next});}
  else if(/^admin:confirm:[a-z0-9]{10,30}$/.test(action))await confirm(bot,action.slice(14));
  else if(/^admin:list:(users|team|bans|audit):\d{1,5}$/.test(action)){const [,,kind,page]=action.split(':');await list(bot,kind,Math.min(10000,Number(page)));}
  else if(action==='admin:stats'&&role==='owner'){
   const s=await userStats(bot.store),counts=await bot.store.db.get(`SELECT SUM(kind='ban' AND json_extract(payload,'$.active')=1) AS bans,SUM(kind='role' AND json_extract(payload,'$.role') IN ('moderator','admin')) AS staff FROM sd_admin_records WHERE kind IN ('role','ban')`);
   await show(bot,`<b>Пользователи</b>\n\nВсего: ${s.total}\nПользовались сегодня / 7 / 30 дней: ${s.today} / ${s.week} / ${s.month}\nНовые сегодня / 7 / 30 дней: ${s.new_today} / ${s.new_week} / ${s.new_month}\nУведомления включены и доступны: ${s.subscribed}\nНедоступны для доставки (403): ${s.unavailable}\nИз них подтвердили блокировку бота: ${s.blocked_bot}\nЗаблокированы командой: ${counts.bans||0}\nВ команде, кроме владельца: ${counts.staff||0}\n\nУчёт активности с ${day(await bot.store.meta('users_tracking'))}. У старых профилей дата регистрации может быть неизвестна. Удалённые профили не учитываются. Дни — по времени Сербии.\n\nОбновить — перечитать счётчики; сбор прайсов не запускается.`,[[b('🔎 Список пользователей','admin:list:users:0')],[b('🔄 Обновить счётчики','admin:stats')],...BACK]);
  }else if(action==='admin:sources'&&role==='owner'){
   const sources=await bot.store.sources();await show(bot,'<b>Состояние магазинов</b>\n\n'+(sources.map(s=>`${safe(s.name)}: ${safe(s.status)} · ${safe(s.date||'прайса нет')}`).join('\n')||'Сбор ещё не выполнен.')+'\n\nКнопка перечитывает состояние, сбор не запускается.',[[b('🔄 Перечитать состояние','admin:sources')],...BACK]);
  }else await show(bot,'<b>Действие недоступно</b>');
 }catch(error){const allowed=/Введите|Пользователь с этим|@username|Недостаточно/.test(error.message);await show(bot,'<b>Не удалось выполнить действие</b>\n\n'+(allowed?safe(error.message):'Повторите позже.'));}
 return true;
}
