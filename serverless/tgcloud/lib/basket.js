import { requireValue,currentPrice,money,safe,cutoff,day } from './domain.js';

export async function initBasket(db){await db.run(`CREATE TABLE IF NOT EXISTS sd_basket(uid INTEGER NOT NULL,id TEXT NOT NULL,query TEXT NOT NULL,product TEXT,name TEXT,quantity INTEGER NOT NULL,PRIMARY KEY(uid,id))`);}

export function parseList(text){
 const lines=String(text).split(/\n|;/).map(x=>x.replace(/^\s*[-•]\s*/,'').trim()).filter(Boolean);
 requireValue(lines.length>0&&lines.length<=20,'Укажите до 20 товаров, каждый с новой строки.');
 return lines.map(line=>{const match=line.match(/^(.*?)\s+(?:[xх×*]|—|–)\s*(\d{1,2})\s*$/i);const query=(match?match[1]:line).trim(),quantity=match?Number(match[2]):1;requireValue(query.length>0&&query.length<=120&&quantity>0&&quantity<=99,'Проверьте название и количество.');return {query,quantity};});
}

export async function addList(store,uid,text,event){
 const items=parseList(text);await initBasket(store.db);
 const old=await store.db.get('SELECT COUNT(*) AS n FROM sd_basket WHERE uid=:uid',{':uid':uid});requireValue(old.n+items.length<=30,'В корзине может быть до 30 позиций.');
 // Stable Telegram message ID makes a retried bulk input idempotent.
 await store.db.run(`INSERT INTO sd_basket(uid,id,query,quantity) SELECT :uid,:event||'-'||key,json_extract(value,'$.query'),json_extract(value,'$.quantity') FROM json_each(:items) WHERE 1 ON CONFLICT DO NOTHING`,{':uid':uid,':event':String(event),':items':JSON.stringify(items)});
}

export async function addOffer(store,uid,offer,target=null){
 await initBasket(store.db);
 if(target){await store.db.run('UPDATE sd_basket SET product=:product,name=:name WHERE uid=:uid AND id=:id',{':uid':uid,':id':target,':product':offer.product,':name':offer.name});return;}
 const count=await store.db.get('SELECT COUNT(*) AS n FROM sd_basket WHERE uid=:uid',{':uid':uid});requireValue(count.n<30,'В корзине может быть до 30 позиций.');
 await store.db.run(`INSERT INTO sd_basket(uid,id,query,product,name,quantity) VALUES(:uid,:id,:name,:product,:name,1) ON CONFLICT(uid,id) DO NOTHING`,{':uid':uid,':id':'p'+offer.id,':name':offer.name,':product':offer.product});
}

export async function cartItems(store,uid){await initBasket(store.db);return store.db.all('SELECT * FROM sd_basket WHERE uid=:uid ORDER BY id LIMIT 30',{':uid':uid});}

export async function compareBasket(store,uid){
 const items=await cartItems(store,uid),pending=items.filter(x=>!x.product);
 if(!items.length||pending.length)return {items,pending,stores:[],split:null};
 const matrices=new Map(),cheapest=[],missing=[];
 // Resolve every item against one SQLite statement snapshot. A concurrent
 // source publication cannot mix old and new generations inside this basket.
 const allRows=await store.db.all(`SELECT o.payload,s.name AS source_name,b.id AS cart_id FROM sd_basket b JOIN sd_offers o ON o.product=b.product JOIN sd_sources s ON s.id=o.source AND s.current_gen=o.gen WHERE b.uid=:uid AND o.date>=:cutoff AND o.date<=:today LIMIT 6001`,{':uid':uid,':cutoff':cutoff(Date.now()),':today':day()});
 requireValue(allRows.length<=6000,'Слишком много предложений для одной корзины. Уточните товары.');
 for(const item of items){
  const rows=allRows.filter(row=>row.cart_id===item.id);
  let best=null;
  for(const row of rows){
   const offer=JSON.parse(row.payload),price=currentPrice(offer),key=offer.source+'|'+offer.format;
   if(!matrices.has(key))matrices.set(key,{name:offer.format,items:new Map()});
   const found=matrices.get(key).items.get(item.id);
   if(!found||price<found.price)matrices.get(key).items.set(item.id,{id:item.id,name:item.name,quantity:item.quantity,price,total:price*item.quantity});
   if(!best||price<best.price)best={id:item.id,name:item.name,quantity:item.quantity,price,total:price*item.quantity,store:offer.format,date:offer.date};
  }
  if(best)cheapest.push(best);else missing.push(item.name);
 }
 const stores=[...matrices.values()].map(s=>({name:s.name,found:s.items.size,total:[...s.items.values()].reduce((n,x)=>n+x.total,0),missing:items.filter(x=>!s.items.has(x.id)).map(x=>x.name),items:[...s.items.values()]}));
 stores.sort((a,b)=>(b.found===items.length)-(a.found===items.length)||b.found-a.found||a.total-b.total);
 return {items,pending:[],stores,split:{complete:missing.length===0,total:cheapest.reduce((n,x)=>n+x.total,0),items:cheapest,missing}};
}

export function basketReport(result){
 if(!result.items.length)return '<b>Корзина пока пустая</b>\n\nДобавьте товары из поиска или отправьте список.';
 if(result.pending.length)return '<b>Подтвердите товары</b>\n\nДля '+result.pending.length+' позиций нужно выбрать конкретный товар и упаковку. После этого сравним одинаковую корзину между магазинами.';
 const complete=result.stores.filter(s=>s.found===result.items.length);
 let text='<b>Сравнение корзины</b>\n\nКоличество — упаковки или штуки выбранного товара.\n\n';
 text+=complete.length?'<b>Вся корзина в одной сети</b>\n'+complete.slice(0,4).map(s=>`${safe(s.name.slice(0,60))} — ${money(s.total)}`).join('\n'):'<b>Полная корзина в одной сети не найдена.</b>';
 const partial=result.stores.filter(s=>s.found!==result.items.length).slice(0,3);
 if(partial.length)text+='\n\n<b>Неполные корзины</b>\n'+partial.map(s=>`${safe(s.name.slice(0,60))}: найдено ${s.found} из ${result.items.length}; сумма найденного ${money(s.total)}. Не найдено: ${s.missing.slice(0,3).map(x=>safe(x.slice(0,45))).join(', ')}${s.missing.length>3?' и ещё '+(s.missing.length-3):''}`).join('\n');
 if(result.split?.complete)text+='\n\n<b>Покупки в разных сетях</b>\n'+result.split.items.slice(0,8).map(i=>`${safe(i.name.slice(0,55))} × ${i.quantity}: ${money(i.total)} · ${safe(i.store.slice(0,40))}`).join('\n')+(result.split.items.length>8?'\nИ ещё '+(result.split.items.length-8)+' позиций.':'')+'\nИтого за всю корзину: '+money(result.split.total)+'\nДоставка и поездки не включены.';
 else if(result.split)text+='\n\nБез свежей цены: '+result.split.missing.slice(0,4).map(x=>safe(x.slice(0,50))).join(', ');
 return text+'\n\nРасчёт по опубликованным прайсам сетей. Наличие и цены конкретного филиала не подтверждены.';
}
