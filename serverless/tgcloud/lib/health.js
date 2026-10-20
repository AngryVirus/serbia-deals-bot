import {lockUser,unlockUser} from './moderation-state.js';
import {OWNER_ID,cutoff,day,positive} from './domain.js';
export function sourceHealth(source,now=Date.now()){
 const active=Boolean(source.current_gen||source.active),valid=/^\d{4}-\d{2}-\d{2}$/.test(source.date||'')&&source.date<=day(now),fresh=active&&valid&&source.date>=cutoff(now);
 return {active,fresh,label:!active?'Прайс ещё не загружен':!fresh?'Нет свежего прайса':source.status==='unavailable'?'Прайс доступен; последнее обновление не удалось':'Свежий прайс доступен'};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Negative lease IDs are reserved for workers; Telegram user IDs are positive.
export async function checkHealth(store,api,now=Date.now()){
 const key='health:'+now+':'+Math.random();if(!await lockUser(store,-1,key,now))return {busy:true};
 try{return await inspectHealth(store,api,now);}finally{await unlockUser(store,-1,key);}
}
async function inspectHealth(store,api,now){
 if(await store.meta('active')!==true)return {paused:true};
 const last=await store.meta('last_collection'),sources=await store.sources(),expected=await store.meta('expected_sources')||[],staleSources=sources.filter(s=>{const status=sourceHealth(s,now);return (status.active||expected.includes(s.id))&&!status.fresh;});
 const errors=await store.db.get("SELECT COUNT(*) AS count FROM sd_queue WHERE state IN ('blocked','uncertain','sending') AND created>=:cutoff",{':cutoff':now-86400000});
 const next={collection:!last?'missing':now-last>36*3600000?'stale':null,sources:staleSources.map(s=>s.id).sort(),delivery:errors.count>=10};
 const summary={uninitialized:!last,stale:next.collection!==null,stale_sources:next.sources.length,delivery_errors:errors.count,problem:next.collection?'collection_'+next.collection:next.sources.length?'source_prices_stale':next.delivery?'delivery_errors':null};
 const key='health_snapshot_v2';await store.db.run('INSERT INTO sd_meta(key,value) VALUES(:key,\'null\') ON CONFLICT DO NOTHING',{':key':key});
 const old=await store.meta(key),previous=old?.state||{collection:null,sources:[],delivery:false};let saved=old;
 if(!old||!same(previous,next)){
  const lines=[];
  if(next.collection!==previous.collection){if(next.collection==='missing')lines.push('⚠️ Нет отметки подтверждённого успешного сбора прайсов. Проверьте сбор.');else if(next.collection==='stale')lines.push('⚠️ Более 36 часов без подтверждённого успешного сбора прайсов.');else if(previous.collection)lines.push('✅ Успешный сбор прайсов возобновился.');}
  const added=next.sources.filter(id=>!previous.sources.includes(id)),recovered=previous.sources.filter(id=>!next.sources.includes(id));
  const names=ids=>ids.slice(0,5).map(id=>sources.find(s=>s.id===id)?.name||'ранее подключённая сеть').join(', ')+(ids.length>5?' и ещё '+(ids.length-5):'');
  if(added.length)lines.push('⚠️ Нет свежих цен: '+names(added)+'. Эти прайсы исключены из поиска до обновления.');
  if(recovered.length)lines.push('✅ Свежие цены снова доступны: '+names(recovered)+'.');
  if(next.delivery!==previous.delivery)lines.push(next.delivery?'⚠️ Выросло число проблем доставки за последние сутки. Проверьте очередь.':'✅ Число проблем доставки снизилось ниже порога предупреждения.');
  saved={state:next,text:lines.length?'SerbiaDealsBot\n\n'+lines.join('\n\n'):null,notice:lines.length?'pending':'none',retry:0};
  const update=await store.db.run('UPDATE sd_meta SET value=:next WHERE key=:key AND value=:old',{':key':key,':next':JSON.stringify(saved),':old':JSON.stringify(old)});
  if(update.rowsAffected!==1)return summary;
 }
 if(saved?.notice!=='pending'||saved.retry>now)return summary;
 const sending={...saved,notice:'sending'},claim=await store.db.run('UPDATE sd_meta SET value=:next WHERE key=:key AND value=:old',{':key':key,':next':JSON.stringify(sending),':old':JSON.stringify(saved)});
 if(claim.rowsAffected!==1)return summary;
 let notice='sent',retry=0;
 try{const result=await api.sendMessage({chat_id:OWNER_ID,text:saved.text});if(!positive(result?.message_id))throw Error('Unconfirmed send');}
 catch(error){const code=error.code||error.error_code;notice=code===429?'pending':code===403?'blocked':'uncertain';if(code===429)retry=now+Math.min(86400,Math.max(60,Number(error.parameters?.retry_after)||60))*1000;}
 await store.db.run('UPDATE sd_meta SET value=:next WHERE key=:key AND value=:old',{':key':key,':next':JSON.stringify({...saved,notice,retry}),':old':JSON.stringify(sending)});
 return summary;
}
