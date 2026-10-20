import { requireValue,currentPrice,money,safe,cutoff,day } from './domain.js';

export async function initBasket(db){await db.run(`CREATE TABLE IF NOT EXISTS sd_basket(uid INTEGER NOT NULL,id TEXT NOT NULL,query TEXT NOT NULL,product TEXT,name TEXT,quantity INTEGER NOT NULL,PRIMARY KEY(uid,id))`);}

export function parseList(text){
 const lines=String(text).split(/\n|;|,(?!\d)|(?<!\d),/).map(x=>x.replace(/^\s*[-•]\s*/,'').trim()).filter(Boolean);
 requireValue(lines.length>0&&lines.length<=20,'Укажите до 20 товаров, каждый с новой строки.');
 return lines.map(line=>{const match=line.match(/^(.*?)\s+(?:[xх×*]|—|–)\s*(\d{1,2})\s*$/i);const query=(match?match[1]:line).trim(),quantity=match?Number(match[2]):1;requireValue(query.length>0&&query.length<=120&&quantity>0&&quantity<=99,'Проверьте название и количество.');return {query,quantity};});
}

export async function addList(store,uid,text,event){
 const items=parseList(text);await initBasket(store.db);
 // Count only new IDs, inside the insertion statement. A replay near the
 // limit is harmless; concurrent writers cannot exceed thirty rows.
 const params={':uid':uid,':event':String(event),':items':JSON.stringify(items)};
 await store.db.run(`INSERT INTO sd_basket(uid,id,query,quantity) SELECT :uid,:event||'-'||key,json_extract(value,'$.query'),json_extract(value,'$.quantity') FROM json_each(:items) WHERE (SELECT COUNT(*) FROM sd_basket WHERE uid=:uid)+(SELECT COUNT(*) FROM json_each(:items) incoming WHERE NOT EXISTS(SELECT 1 FROM sd_basket b WHERE b.uid=:uid AND b.id=:event||'-'||incoming.key))<=30 ON CONFLICT DO NOTHING`,params);
 const missing=await store.db.get(`SELECT COUNT(*) AS n FROM json_each(:items) incoming WHERE NOT EXISTS(SELECT 1 FROM sd_basket b WHERE b.uid=:uid AND b.id=:event||'-'||incoming.key)`,params);
 requireValue(missing.n===0,'В корзине может быть до 30 позиций.');
}

export async function addOffer(store,uid,offer,target=null){
 await initBasket(store.db);
 if(target){const result=await store.db.run('UPDATE sd_basket SET product=:product,name=:name WHERE uid=:uid AND id=:id AND product IS NULL',{':uid':uid,':id':target,':product':offer.product,':name':offer.name});return result.rowsAffected===1;}
 const id='p'+offer.id;
 const result=await store.db.run(`INSERT INTO sd_basket(uid,id,query,product,name,quantity) SELECT :uid,:id,:name,:product,:name,1 WHERE (SELECT COUNT(*) FROM sd_basket WHERE uid=:uid)<30 ON CONFLICT(uid,id) DO NOTHING`,{':uid':uid,':id':id,':name':offer.name,':product':offer.product});
 requireValue(result.rowsAffected===1||await store.db.get('SELECT 1 AS present FROM sd_basket WHERE uid=:uid AND id=:id',{':uid':uid,':id':id}),'В корзине может быть до 30 позиций.');return true;
}

export async function cartItems(store,uid){await initBasket(store.db);return store.db.all('SELECT * FROM sd_basket WHERE uid=:uid ORDER BY id LIMIT 30',{':uid':uid});}

export async function expandPendingList(store,uid,id){
 const rows=await cartItems(store,uid),item=rows.find(x=>x.id===id&&!x.product);if(!item)return false;
 const parsed=parseList(item.query);if(parsed.length<2)return false;
 requireValue(id.length<=16,'Добавьте список заново, по одному товару на строку.');
 const existing=new Set(rows.map(x=>x.id));existing.delete(id);
 const items=parsed.map((x,i)=>({id:id+'s'+i,query:x.query,quantity:Math.min(99,x.quantity*item.quantity)}));
 for(const row of items)existing.add(row.id);requireValue(existing.size<=30,'В корзине может быть до 30 позиций.');
 await store.db.run(`INSERT INTO sd_basket(uid,id,query,quantity) SELECT :uid,json_extract(value,'$.id'),json_extract(value,'$.query'),json_extract(value,'$.quantity') FROM json_each(:items) WHERE 1 ON CONFLICT DO NOTHING`,{':uid':uid,':items':JSON.stringify(items)});
 await store.db.run('DELETE FROM sd_basket WHERE uid=:uid AND id=:id AND product IS NULL AND query=:query',{':uid':uid,':id':id,':query':item.query});return true;
}

export async function compareBasket(store,uid){
 const items=(await cartItems(store,uid)).flatMap(item=>item.product?[item]:parseList(item.query).map((parsed,index)=>({...item,id:index?item.id+'s'+index:item.id,query:parsed.query,quantity:Math.min(99,item.quantity*parsed.quantity)}))),pending=items.filter(x=>!x.product);
 requireValue(items.length<=30,'Слишком много товаров в списке. Разделите его на корзины до 30 позиций.');
 if(!items.length)return {items,pending,stores:[],split:null};
 const versions=pending.length?JSON.stringify((await store.sources()).map(s=>[s.id,s.current_gen])):null;
 const matrices=new Map(),cheapest=[],missing=[];
 // Resolve every item against one SQLite statement snapshot. A concurrent
 // source publication cannot mix old and new generations inside this basket.
 const allRows=await store.db.all(`SELECT o.payload,s.name AS source_name,b.id AS cart_id FROM sd_basket b JOIN sd_offers o ON o.product=b.product JOIN sd_sources s ON s.id=o.source AND s.current_gen=o.gen WHERE b.uid=:uid AND o.date>=:cutoff AND o.date<=:today LIMIT 6001`,{':uid':uid,':cutoff':cutoff(Date.now()),':today':day()});
 requireValue(allRows.length<=6000,'Слишком много предложений для одной корзины. Уточните товары.');
 for(const item of items){
  const rows=item.product?allRows.filter(row=>row.cart_id===item.id):await store.basketCandidates(item.query);
  requireValue(rows.length<=100,'Слишком много вариантов. Уточните товары в списке.');
  let best=null;
  for(const row of rows){
   const offer=JSON.parse(row.payload),price=currentPrice(offer),key=offer.source+'|'+offer.format;
   if(!matrices.has(key))matrices.set(key,{source:offer.source,chain:row.source_name,name:offer.format,items:new Map()});
   const found=matrices.get(key).items.get(item.id);
   if(!found||price<found.price)matrices.get(key).items.set(item.id,{id:item.id,name:item.name||offer.name,quantity:item.quantity,price,total:price*item.quantity});
   if(!best||price<best.price)best={id:item.id,name:item.name||offer.name,quantity:item.quantity,price,total:price*item.quantity,store:offer.format,date:offer.date};
  }
  if(best)cheapest.push(best);else missing.push(item.name||item.query);
 }
 const stores=[...matrices.values()].map(s=>({source:s.source,chain:s.chain,name:s.name,found:s.items.size,total:[...s.items.values()].reduce((n,x)=>n+x.total,0),missing:items.filter(x=>!s.items.has(x.id)).map(x=>x.name||x.query),items:[...s.items.values()]}));
 stores.sort((a,b)=>(b.found===items.length)-(a.found===items.length)||b.found-a.found||a.total-b.total);
 if(versions!==null)requireValue(versions===JSON.stringify((await store.sources()).map(s=>[s.id,s.current_gen])),'Прайсы обновились во время расчёта. Повторите сравнение.');
 return {items,pending,estimated:pending.length>0,stores,split:{complete:missing.length===0,total:cheapest.reduce((n,x)=>n+x.total,0),items:cheapest,missing}};
}

export function basketReport(result){
 if(!result.items.length)return '<b>Корзина пока пустая</b>\n\nДобавьте товары из поиска или отправьте список.';
 if(result.pending.length)return estimatedReport(result);
 const grouped=bestNetworks(result.stores),complete=grouped.filter(s=>s.found===result.items.length);
 let text='<b>Сравнение корзины</b>\n\nКоличество — упаковки или штуки выбранного товара.\n\n';
 text+=complete.length?'<b>Вся корзина в одной сети</b>\n'+complete.slice(0,4).map(s=>`${safe(s.name.slice(0,60))} — ${money(s.total)}`).join('\n'):'<b>Полная корзина в одной сети не найдена.</b>';
 const partial=grouped.filter(s=>s.found!==result.items.length).slice(0,3);
 if(partial.length)text+='\n\n<b>Неполные корзины</b>\n'+partial.map(s=>`${safe(s.name.slice(0,60))}: найдено ${s.found} из ${result.items.length}; сумма найденного ${money(s.total)}. Не найдено: ${s.missing.slice(0,3).map(x=>safe(x.slice(0,45))).join(', ')}${s.missing.length>3?' и ещё '+(s.missing.length-3):''}`).join('\n');
 if(result.split?.complete)text+='\n\n<b>Покупки в разных сетях</b>\n'+result.split.items.slice(0,8).map(i=>`${safe(i.name.slice(0,55))} × ${i.quantity}: ${money(i.total)} · ${safe(i.store.slice(0,40))}`).join('\n')+(result.split.items.length>8?'\nИ ещё '+(result.split.items.length-8)+' позиций.':'')+'\nИтого за всю корзину: '+money(result.split.total)+'\nДоставка и поездки не включены.';
 else if(result.split)text+='\n\nБез свежей цены: '+result.split.missing.slice(0,4).map(x=>safe(x.slice(0,50))).join(', ');
 return text+'\n\nРасчёт по опубликованным прайсам сетей. Наличие и цены конкретного филиала не подтверждены.';
}

function bestNetworks(stores){const seen=new Set();return stores.filter(s=>{const key=s.source||s.name;if(seen.has(key))return false;seen.add(key);return true;});}
function estimatedReport(result){
 const choices=bestNetworks(result.stores).slice(0,3);
 if(!choices.length)return '<b>Для списка пока нет предложений</b>\n\nНе удалось подобрать: '+result.items.slice(0,8).map(i=>safe(i.name||i.query)).join(', ')+'.\n\nУточните названия в корзине. Можно вводить по одному товару на строку или через запятую.';
 let text='<b>Подбор для вашего списка</b>\n\nПредварительная сумма: невыбранные позиции подобраны по названию из самых дешёвых найденных вариантов. Вид товара и упаковки могут различаться — проверьте список перед покупкой.\n\n';
 for(const store of choices){text+=`<b>${safe(store.chain||store.name)}</b> · ${safe(store.name)}\nНайдено ${store.found} из ${result.items.length}: ${money(store.total)}\n`+store.items.slice(0,4).map(i=>`${safe(i.name.slice(0,75))} × ${i.quantity} — ${money(i.total)}`).join('\n')+(store.items.length>4?'\nИ ещё '+(store.items.length-4)+' позиций.':'')+(store.missing.length?'\nНе найдено: '+store.missing.slice(0,3).map(n=>safe(n.slice(0,45))).join(', '):'')+'\n\n';}
 if(!choices.some(s=>s.found===result.items.length)&&result.split?.complete)text+='<b>Весь список в разных сетях</b> — '+money(result.split.total)+'\n\n';
 return text+'Для точного сравнения одинаковых товаров откройте корзину и выберите подходящие позиции. Адреса филиалов и наличие в прайсах не подтверждены.';
}
