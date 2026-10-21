import {productNames,bilingual} from './product-names.js';
import {banned,lockUser,unlockUser} from './moderation-state.js';
import { safe,money,positive } from './domain.js';
const eligible=`EXISTS(SELECT 1 FROM sd_users u JOIN sd_watches w ON w.uid=u.id WHERE u.id=sd_queue.uid AND u.enabled=1 AND u.blocked=0 AND w.product=sd_queue.product AND NOT EXISTS(SELECT 1 FROM sd_admin_records b WHERE b.kind='ban' AND b.key=CAST(u.id AS TEXT) AND json_extract(b.payload,'$.active')=1))`;
const currentSnapshot=`EXISTS(SELECT 1 FROM sd_offers o JOIN sd_sources s ON s.id=o.source AND s.current_gen=o.gen WHERE o.source=:source AND o.id=:offer_id AND o.payload=:snapshot)`;
const snapshotParams=best=>{const offer=JSON.parse(best.payload);return {':source':offer.source,':offer_id':offer.id,':snapshot':best.payload};};
export async function prepareNotifications(store){
 const after=await store.meta('watch_cursor')||0;
 const watches=await store.db.all(`SELECT w.rowid AS cursor,w.* FROM sd_watches w JOIN sd_users u ON u.id=w.uid WHERE w.rowid>:after AND u.enabled=1 AND u.blocked=0 AND NOT EXISTS(SELECT 1 FROM sd_admin_records b WHERE b.kind='ban' AND b.key=CAST(u.id AS TEXT) AND json_extract(b.payload,'$.active')=1) ORDER BY w.rowid LIMIT 30`,{':after':after});
 for(const watch of watches){
  if(await banned(store,watch.uid))continue;
  const best=await store.cheapest(watch.product);if(!best)continue;
  const observed={':uid':watch.uid,':product':watch.product,':previous':watch.baseline,':price':best.price,...snapshotParams(best)};
  if(best.price<watch.baseline){
   // Queue insertion and baseline advancement are retried independently. The
   // daily unique event keeps a crash between them from producing duplicates.
   const created=Math.floor(Date.now()/86400000)*86400000;
   await store.db.run(`INSERT INTO sd_queue(uid,product,price,offer,created) SELECT :uid,:product,:price,:offer,:created WHERE EXISTS(SELECT 1 FROM sd_watches w JOIN sd_users u ON u.id=w.uid WHERE w.uid=:uid AND w.product=:product AND w.baseline=:previous AND u.enabled=1 AND u.blocked=0 AND NOT EXISTS(SELECT 1 FROM sd_admin_records b WHERE b.kind='ban' AND b.key=CAST(u.id AS TEXT) AND json_extract(b.payload,'$.active')=1)) AND ${currentSnapshot} ON CONFLICT DO NOTHING`,{...observed,':offer':JSON.stringify(best),':created':created});
  }
  await store.db.run(`UPDATE sd_watches SET baseline=:price WHERE uid=:uid AND product=:product AND baseline=:previous AND ${currentSnapshot}`,observed);
 }
 await store.setMeta('watch_cursor',watches.length===30?watches.at(-1).cursor:0);
 return {checked:watches.length,more:watches.length===30};
}
export async function deliverNotifications(store,api){
 // Permanently retire obsolete events before taking a bounded batch. Otherwise
 // five disabled users' rows can occupy every batch forever and starve others.
 await store.db.run(`UPDATE sd_queue SET state='cancelled' WHERE state='pending' AND NOT (${eligible})`);
 const rows=await store.db.all(`SELECT * FROM sd_queue WHERE state='pending' AND after<=:now AND ${eligible} ORDER BY id LIMIT 5`,{':now':Date.now()});let sent=0,uncertain=0;
 for(const queued of rows){
  let row=queued;
  const key='price:'+row.id+':'+Date.now()+':'+Math.random();if(!await lockUser(store,row.uid,key))continue;
  try{
  if(await banned(store,row.uid)){await store.db.run("UPDATE sd_queue SET state='cancelled' WHERE id=:id AND state='pending'",{':id':row.id});continue;}
  // Coalesce only unclaimed evidence already present at this boundary. A later
  // preparation may insert another drop; sending/uncertain receipts stay intact.
  const pending=await store.db.get("SELECT MAX(id) AS through,MAX(after) AS retry_at FROM sd_queue WHERE uid=:uid AND product=:product AND state='pending'",{':uid':row.uid,':product':row.product});
  if(!pending?.through)continue;
  const fresh=await store.cheapest(row.product);
  const current=fresh&&await store.db.get("SELECT * FROM sd_queue WHERE uid=:uid AND product=:product AND state='pending' AND id<=:through AND price>=:price ORDER BY price,id DESC LIMIT 1",{':uid':row.uid,':product':row.product,':through':pending.through,':price':fresh.price});
  await store.db.run("UPDATE sd_queue SET state=CASE WHEN id=:keep THEN 'pending' WHEN :price IS NULL OR price<:price THEN 'expired' ELSE 'cancelled' END,after=MAX(after,:retry) WHERE uid=:uid AND product=:product AND state='pending' AND id<=:through",{':keep':current?.id||0,':price':fresh?.price??null,':retry':pending.retry_at||0,':uid':row.uid,':product':row.product,':through':pending.through});
  if(!current||pending.retry_at>Date.now())continue;
  row=current;
  const claim=await store.db.run(`UPDATE sd_queue SET state='sending' WHERE id=:id AND state='pending' AND after<=:now AND ${eligible} AND EXISTS(SELECT 1 FROM sd_locks WHERE id=:uid AND owner=:key AND expires>:now)`,{':id':row.id,':uid':row.uid,':key':key,':now':Date.now()});
  if(claim.rowsAffected!==1)continue;
  // Crash/timeout after this durable claim is uncertain and never auto-replayed.
  try{
   const offer=JSON.parse(fresh.payload),names=await productNames(store,null,[JSON.parse(fresh.payload)]);
   const observed={':id':row.id,':uid':row.uid,':product':row.product,':price':fresh.price,':key':key,':now':Date.now(),...snapshotParams(fresh)};
   // Repair a prepare crash before sending, including across UTC day boundaries.
   // Sending a lower observed price must never raise a newer, lower baseline.
   await store.db.run(`UPDATE sd_watches SET baseline=MIN(baseline,:price) WHERE uid=:uid AND product=:product AND ${currentSnapshot} AND EXISTS(SELECT 1 FROM sd_locks WHERE id=:uid AND owner=:key AND expires>:now)`,observed);
   // Concurrent preparation may have inserted equivalent evidence after our
   // pending snapshot. Once the baseline is durable, no stale CAS can add more.
   await store.db.run(`UPDATE sd_queue SET state='cancelled' WHERE uid=:uid AND product=:product AND state='pending' AND price>=:price AND ${currentSnapshot} AND EXISTS(SELECT 1 FROM sd_locks WHERE id=:uid AND owner=:key AND expires>:now)`,{...observed,':now':Date.now()});
   const authorized=await store.db.get(`SELECT 1 AS ready FROM sd_queue WHERE id=:id AND state='sending' AND ${eligible} AND ${currentSnapshot} AND EXISTS(SELECT 1 FROM sd_locks WHERE id=:uid AND owner=:key AND expires>:now)`,{...observed,':now':Date.now()});
   if(!authorized){await store.db.run("UPDATE sd_queue SET state='cancelled' WHERE id=:id AND state='sending'",{':id':row.id});continue;}
   const message=await api.sendMessage({chat_id:row.uid,text:`<b>Цена снизилась</b>\n${safe(names.get(offer.name)||bilingual(null,offer.name))}\n${safe(offer.format)}: <b>${money(fresh.price)}</b>\nПрайс: ${offer.date}`,parse_mode:'HTML',link_preview_options:{is_disabled:true}});
   if(!positive(message?.message_id))throw Error('Unconfirmed send');
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
