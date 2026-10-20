import {banned,lockUser,unlockUser} from './moderation-state.js';
import { safe,money,day } from './domain.js';
export async function prepareNotifications(store){
 const after=await store.meta('watch_cursor')||0;
 const watches=await store.db.all(`SELECT w.rowid AS cursor,w.* FROM sd_watches w JOIN sd_users u ON u.id=w.uid WHERE w.rowid>:after AND u.enabled=1 AND u.blocked=0 AND NOT EXISTS(SELECT 1 FROM sd_admin_records b WHERE b.kind='ban' AND b.key=CAST(u.id AS TEXT) AND json_extract(b.payload,'$.active')=1) ORDER BY w.rowid LIMIT 30`,{':after':after});
 for(const watch of watches){
  if(await banned(store,watch.uid))continue;
  const best=await store.cheapest(watch.product);if(!best)continue;
  if(best.price<watch.baseline){
   // Queue insertion and baseline advancement are retried independently. The
   // daily unique event keeps a crash between them from producing duplicates.
   const created=Math.floor(Date.now()/86400000)*86400000;
   await store.db.run(`INSERT INTO sd_queue(uid,product,price,offer,created) VALUES(:uid,:product,:price,:offer,:created) ON CONFLICT DO NOTHING`,{':uid':watch.uid,':product':watch.product,':price':best.price,':offer':JSON.stringify(best),':created':created});
  }
  await store.db.run('UPDATE sd_watches SET baseline=:price WHERE uid=:uid AND product=:product',{':price':best.price,':uid':watch.uid,':product':watch.product});
 }
 await store.setMeta('watch_cursor',watches.length===30?watches.at(-1).cursor:0);
 return {checked:watches.length,more:watches.length===30};
}
export async function deliverNotifications(store,api){
 const rows=await store.db.all(`SELECT * FROM sd_queue WHERE state='pending' AND after<=:now ORDER BY id LIMIT 5`,{':now':Date.now()});let sent=0,uncertain=0;
 for(const row of rows){
  const key='price:'+row.id+':'+Date.now()+':'+Math.random();if(!await lockUser(store,row.uid,key))continue;
  try{
  if(await banned(store,row.uid)){await store.db.run("UPDATE sd_queue SET state='cancelled' WHERE id=:id AND state='pending'",{':id':row.id});continue;}
  const claim=await store.db.run(`UPDATE sd_queue SET state='sending' WHERE id=:id AND state='pending' AND EXISTS(SELECT 1 FROM sd_users u JOIN sd_watches w ON w.uid=u.id WHERE u.id=:uid AND u.enabled=1 AND u.blocked=0 AND w.product=:product)`,{':id':row.id,':uid':row.uid,':product':row.product});
  if(claim.rowsAffected!==1)continue;
  // Crash/timeout after this durable claim is uncertain and never auto-replayed.
  try{
   const fresh=await store.cheapest(row.product);
   if(!fresh||fresh.price>row.price){await store.db.run("UPDATE sd_queue SET state='expired' WHERE id=:id",{':id':row.id});continue;}
   const offer=JSON.parse(fresh.payload);
   const message=await api.sendMessage({chat_id:row.uid,text:`<b>Цена снизилась</b>\n${safe(offer.name)}\n${safe(offer.format)}: <b>${money(fresh.price)}</b>\nПрайс: ${offer.date}\nПолучено: ${day(fresh.downloaded)}\n${safe(fresh.source_url)}`,parse_mode:'HTML',link_preview_options:{is_disabled:true}});
   if(!Number.isSafeInteger(message?.message_id))throw Error('Unconfirmed send');
   await store.db.run("UPDATE sd_queue SET state='sent' WHERE id=:id",{':id':row.id});sent++;
  }catch(error){
   const code=error.error_code||error.code;
   if(code===429){const seconds=Number(error.parameters?.retry_after);await store.db.run("UPDATE sd_queue SET state='pending',after=:after WHERE id=:id",{':id':row.id,':after':Date.now()+Math.min(86400,Math.max(60,seconds||60))*1000});break;}
   if(code===403){await store.patch(row.uid,{delivery_blocked:/bot was blocked by the user/i.test(error.description||error.message||'')});await store.db.run('UPDATE sd_users SET blocked=1,enabled=0 WHERE id=:uid',{':uid':row.uid});await store.db.run("UPDATE sd_queue SET state='blocked' WHERE uid=:uid AND state IN ('pending','sending')",{':uid':row.uid});}
   else{await store.db.run("UPDATE sd_queue SET state='uncertain' WHERE id=:id",{':id':row.id});uncertain++;}
  }
  }finally{await unlockUser(store,row.uid,key);}
 }
 await store.db.run("DELETE FROM sd_queue WHERE state!='pending' AND created<:cutoff",{':cutoff':Date.now()-10*86400000});
 return {sent,uncertain};
}
