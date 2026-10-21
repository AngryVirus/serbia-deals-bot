import { requireValue,currentPrice,cutoff,day,normalize,unitPrice,packageMeasure,volumeQuery,weightQuery,milkQuery,relatedChickenQuery,queryGroups,measurementIssue } from './domain.js';

// Describe the public offer behind an estimate without confirming it as the
// user's choice or sending private basket input to a translation service.
export function basketVariant(offer){
 const name=String(offer.name||''),text=normalize(name),pack=packageMeasure(name),parts=[];
 if(/(?:^| )(?:mleko|mlijeko)(?: |$)/.test(text)){
  const kind=comparisonClass(offer);parts.push(kind==='питьевое молоко'?'молоко':kind==='шоколадное молоко'?'шоколадное':kind);
 }
 else if(/(?:^| )sljiv[a-z]*(?: |$)/.test(text))parts.push(/(?:^| )(?:suv[a-z]*|susen[a-z]*)(?: |$)/.test(text)?'чернослив':'сливы');
 else if(/(?:^| )pile[a-z]*(?: |$)/.test(text)){const choices=[[/jetr|src/,'субпродукты'],[/kobasic|salam|virsl/,'колбаса'],[/cips|flips|kokic|popcorn|noodl/,'со вкусом курицы'],[/file/,'филе'],[/kril/,'крылья'],[/batak|karabatak/,'бёдра'],[/grud|prs|belo/,'грудка']];const type=choices.find(([pattern])=>pattern.test(text));if(type)parts.push(type[1]);}
 if(pack)parts.push(pack.amount>=1000?(pack.amount/1000)+(pack.kind==='volume'?' л':' кг'):pack.amount+(pack.kind==='volume'?' мл':' г'));
 return parts.join(' · ');
}

export function amountLabel(amount,kind){return amount>=1000?(amount/1000)+(kind==='volume'?' л':' кг'):amount+(kind==='volume'?' мл':' г');}
// In a shopping list an explicit amount is the requested total. A directly
// selected catalogue SKU continues to mean packs, never its title's volume.
export function basketDemand(item){
 if(item.product&&item.query===item.name)return null;
 const pack=packageMeasure(item.query),m=volumeQuery(item.query)||weightQuery(item.query);
 if(!pack||!m||pack.amount!==(m.ml||m.grams)||!unitPrice({name:item.query},100))return null;
 const query=item.query.replace(m.text,' ').replace(/\s+/g,' ').trim();if(!query)return null;
 const amount=pack.amount*(item.quantity||1);if(!Number.isSafeInteger(amount)||amount>10000000)return null;
 return {kind:pack.kind,amount,query,label:amountLabel(amount,pack.kind)};
}
export const basketQuery=item=>basketDemand(item)?.query||item.query;
export function comparisonClass(offer){
 const t=normalize(offer.name);
 if(/(?:^| )(?:mleko|mlijeko)(?: |$)/.test(t))return /kisel|(?:^| )kis(?: |$)/.test(t)?'кисломолочное':/cokolad|(?:^| )(?:cok|coko|choco|kakao)[a-z]*(?: |$)/.test(t)?'шоколадное молоко':/(?:^| )(?:badem|kokos|soj|ovsen|pirinc)[a-z]*(?: |$)/.test(t)?'растительный напиток':/prah|suvo|susen|kondenz|formul|pocet/.test(t)?'специальное молоко':'питьевое молоко';
 if(/(?:^| )pile[a-z]*(?: |$)/.test(t))return /cips|flips|kokic|popcorn|noodl|kubet|smok/.test(t)?'снеки со вкусом курицы':/pastet/.test(t)?'паштет':/kobasic|salam|virsl|sunk|parizer/.test(t)?'колбаса':/jetr|src|bubac|bubreg|zelud/.test(t)?'субпродукты':/file|grud|prs|belo/.test(t)?'филе и грудка':/kril/.test(t)?'крылья':/batak|karabatak/.test(t)?'бёдра':'курица, другие части';
 if(/(?:^| )(?:kafa|coffee)(?: |$)/.test(t))return /kapsul/.test(t)?'кофе в капсулах':/instant|rastvor/.test(t)?'растворимый кофе':/mleven|mljeven/.test(t)?'молотый кофе':/zrno|zrn/.test(t)?'кофе в зёрнах':'кофе, другой вид';
 if(/(?:^| )(?:goved[a-z]*|junec[a-z]*|junet[a-z]*)(?: |$)/.test(t))return 'говядина';
 if(/(?:^| )svinj[a-z]*(?: |$)/.test(t))return 'свинина';
 if(/(?:^| )curet[a-z]*(?: |$)/.test(t))return 'индейка';
 return 'товар';
}
const detailedQuery=query=>milkQuery(query)||relatedChickenQuery(query)||queryGroups(query).some(g=>g.some(t=>/^(kafa|coffee|meso|goved|junec|svinj|curet)/.test(t)));

const basketSchemas=new WeakMap();
export async function initBasket(db){
 if(basketSchemas.has(db))return basketSchemas.get(db);
 const task=(async()=>{await db.run(`CREATE TABLE IF NOT EXISTS sd_basket(uid INTEGER NOT NULL,id TEXT NOT NULL,query TEXT NOT NULL,product TEXT,name TEXT,quantity INTEGER NOT NULL,PRIMARY KEY(uid,id))`);await db.run(`CREATE TABLE IF NOT EXISTS sd_basket_filters(uid INTEGER NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(uid,id))`);})();
 basketSchemas.set(db,task);try{await task;}catch(error){basketSchemas.delete(db);throw error;}
}
export async function saveBasketFilters(store,uid,id,filters){
 await initBasket(store.db);
 const clean={};
 if(typeof filters.brand==='string'&&filters.brand.length<=80)clean.brand=filters.brand;
 if(Array.isArray(filters.type)&&filters.type.length>0&&filters.type.length<=4&&filters.type.every(t=>/^[a-z]{2,20}$/.test(t)))clean.type=filters.type;
 if(filters.pack&&['volume','weight'].includes(filters.pack.kind)&&Number.isInteger(filters.pack.amount)&&filters.pack.amount>0&&filters.pack.amount<=100000)clean.pack={kind:filters.pack.kind,amount:filters.pack.amount};
 if(typeof filters.fat==='string'&&/^\d+(?:\.\d+)?$/.test(filters.fat))clean.fat=filters.fat;
 if(typeof filters.socket==='string'&&/^(E14|E27|GU10|G9|G4|H4|H7)$/.test(filters.socket))clean.socket=filters.socket;
 const result=await store.db.run(`INSERT INTO sd_basket_filters(uid,id,payload) SELECT :uid,:id,:payload WHERE EXISTS(SELECT 1 FROM sd_basket WHERE uid=:uid AND id=:id AND product IS NULL) ON CONFLICT(uid,id) DO UPDATE SET payload=excluded.payload WHERE EXISTS(SELECT 1 FROM sd_basket WHERE uid=:uid AND id=:id AND product IS NULL)`,{':uid':uid,':id':id,':payload':JSON.stringify(clean)});
 return result.rowsAffected===1;
}


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
 if(target){
  const item=await store.db.get(`SELECT b.query,COALESCE(f.payload,'{}') AS filters FROM sd_basket b LEFT JOIN sd_basket_filters f ON f.uid=b.uid AND f.id=b.id WHERE b.uid=:uid AND b.id=:id AND b.product IS NULL`,{':uid':uid,':id':target});if(!item)return false;
  const filters=JSON.parse(item.filters),need=basketDemand(item);if(need&&packageMeasure(offer.name)?.kind!==need.kind)return false;if(Object.keys(filters).length&&!await store.matchesOffer(basketQuery(item),offer.id,filters))return false;
  const result=await store.db.run(`UPDATE sd_basket SET product=:product,name=:name WHERE uid=:uid AND id=:id AND product IS NULL AND COALESCE((SELECT payload FROM sd_basket_filters WHERE uid=:uid AND id=:id),'{}')=:filters`,{':uid':uid,':id':target,':product':offer.product,':name':offer.name,':filters':item.filters});return result.rowsAffected===1;
 }
 const id='p'+offer.id;
 const result=await store.db.run(`INSERT INTO sd_basket(uid,id,query,product,name,quantity) SELECT :uid,:id,:name,:product,:name,1 WHERE (SELECT COUNT(*) FROM sd_basket WHERE uid=:uid)<30 ON CONFLICT(uid,id) DO NOTHING`,{':uid':uid,':id':id,':name':offer.name,':product':offer.product});
 requireValue(result.rowsAffected===1||await store.db.get('SELECT 1 AS present FROM sd_basket WHERE uid=:uid AND id=:id',{':uid':uid,':id':id}),'В корзине может быть до 30 позиций.');return true;
}

// Rotate the row ID atomically: buttons from the previous selection must never
// change the replacement. Keep the original query and quantity for a new search.
export async function resetProduct(store,uid,id){
 await initBasket(store.db);
 const next='r'+(await store.db.get('SELECT lower(hex(randomblob(8))) AS id')).id;
 const result=await store.db.run('UPDATE sd_basket SET id=:next,product=NULL,name=NULL WHERE uid=:uid AND id=:id AND product IS NOT NULL',{':uid':uid,':id':id,':next':next});
 if(result.rowsAffected===1)await store.db.run('DELETE FROM sd_basket_filters WHERE uid=:uid AND id=:id',{':uid':uid,':id':id});
 return result.rowsAffected===1?next:null;
}

export async function cartItems(store,uid){await initBasket(store.db);return (await store.db.all("SELECT b.*,COALESCE(f.payload,'{}') AS filters FROM sd_basket b LEFT JOIN sd_basket_filters f ON f.uid=b.uid AND f.id=b.id WHERE b.uid=:uid ORDER BY b.id LIMIT 30",{':uid':uid})).map(row=>({...row,filters:JSON.parse(row.filters)}));}

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

export async function compareBasket(store,uid,now=Date.now()){
 const items=(await cartItems(store,uid)).flatMap(item=>item.product?[item]:parseList(item.query).map((parsed,index)=>({...item,id:index?item.id+'s'+index:item.id,query:parsed.query,quantity:Math.min(99,item.quantity*parsed.quantity)}))),pending=items.filter(x=>!x.product);
 requireValue(items.length<=30,'Слишком много товаров в списке. Разделите его на корзины до 30 позиций.');
 if(!items.length)return {items,pending,stores:[],split:null,unresolved:[]};
 const versions=JSON.stringify((await store.sources()).map(s=>[s.id,s.current_gen,s.name]));
 const fingerprint=JSON.stringify(['comparable-v3',day(now),items,versions]);
 try{const cached=await store.db.get('SELECT payload FROM sd_basket_reports WHERE uid=:uid AND fingerprint=:fingerprint AND expires>:now',{':uid':uid,':fingerprint':fingerprint,':now':now});if(cached)return JSON.parse(cached.payload);}catch{}
 const matrices=new Map(),cheapest=[],missing=[],unresolved=[];
 const allRows=items.some(i=>i.product)?await store.db.all(`SELECT o.payload,s.name AS source_name,b.id AS cart_id FROM sd_basket b JOIN sd_offers o ON o.product=b.product JOIN sd_sources s ON s.id=o.source AND s.current_gen=o.gen WHERE b.uid=:uid AND o.date>=:cutoff AND o.date<=:today LIMIT 6001`,{':uid':uid,':cutoff':cutoff(now),':today':day(now)}):[];
 requireValue(allRows.length<=6000,'Слишком много предложений для одной корзины. Уточните товары.');
 for(const item of items){
  const need=basketDemand(item),query=basketQuery(item),detailed=!item.product&&(!!need||detailedQuery(query));
  const rows=item.product?allRows.filter(row=>row.cart_id===item.id):await store.basketCandidates(query,now,item.filters||{},detailed);
  requireValue(rows.length<=(detailed?1000:100),'Слишком много вариантов. Уточните товары в списке.');
  const parsed=rows.map(row=>({...row,offer:JSON.parse(row.payload)})),offers=item.product?parsed:parsed.filter(r=>measurementIssue(r.offer.name)!=='wrong_dimension');
  const eligible=need?offers.filter(r=>packageMeasure(r.offer.name)?.kind===need.kind):offers;
  const classes=new Set(eligible.map(r=>comparisonClass(r.offer))),packs=new Set(eligible.map(r=>{const m=packageMeasure(r.offer.name);return m?m.kind+':'+m.amount:'unknown';}));
  const ambiguous=!item.product&&(classes.size>1||!need&&!item.filters?.pack&&packs.size>1);
  const choices=classes.size>1?[...classes]:[...packs].filter(p=>p!=='unknown').map(p=>{const [kind,n]=p.split(':');return amountLabel(Number(n),kind);});
  let best=null,quoted=0;
  for(const {offer,source_name} of offers){
   const price=currentPrice(offer,day(now)),pack=packageMeasure(offer.name),key=offer.source+'|'+offer.format;
   const quantity=need?(pack?.kind===need.kind?Math.ceil(need.amount/pack.amount):0):item.quantity;
   if(!quantity||quantity>10000||!Number.isSafeInteger(quantity*price))continue;
   quoted++;
   if(!matrices.has(key))matrices.set(key,{source:offer.source,chain:source_name,name:offer.format,items:new Map()});
   const candidate={id:item.id,name:item.product?item.name||offer.name:item.query,offerName:offer.name,product:offer.product,estimated:!item.product,match:item.product?'exact':'alternative',ambiguous,choices:ambiguous?choices.slice(0,8):[],variant:basketVariant(offer),unitPrice:unitPrice(offer,price)?.label||null,source:offer.source,quantity,price,total:price*quantity,...(need?{demand:need.label,pack:amountLabel(pack.amount,pack.kind),supplied:amountLabel(pack.amount*quantity,pack.kind)}:{})};
   const found=matrices.get(key).items.get(item.id);
   if(!found||candidate.total<found.total||candidate.total===found.total&&offer.id<found.offerId)matrices.get(key).items.set(item.id,{...candidate,offerId:offer.id});
   if(!best||candidate.total<best.total)best={...candidate,store:offer.format,date:offer.date};
  }
  if(best&&!ambiguous)cheapest.push(best);else missing.push(item.name||item.query);
  if(ambiguous||need&&!quoted||parsed.length&&!offers.length)unresolved.push({id:item.id,query:item.query,reason:ambiguous?'Выберите вид или упаковку':'Нет проверенного размера упаковки',choices:choices.slice(0,8)});
 }
 const stores=[...matrices.values()].map(s=>{const rows=[...s.items.values()],ready=rows.filter(i=>!i.ambiguous);return {source:s.source,chain:s.chain,name:s.name,found:rows.length,ready:ready.length,complete:ready.length===items.length,total:ready.reduce((n,x)=>n+x.total,0),missing:items.filter(x=>!s.items.has(x.id)||s.items.get(x.id).ambiguous).map(x=>x.name||x.query),items:rows};});
 stores.sort((a,b)=>Number(b.complete)-Number(a.complete)||b.ready-a.ready||a.total-b.total||a.name.localeCompare(b.name));
 requireValue(versions===JSON.stringify((await store.sources()).map(s=>[s.id,s.current_gen,s.name])),'Прайсы обновились во время расчёта. Повторите сравнение.');
 const split={complete:missing.length===0,total:cheapest.reduce((n,x)=>n+x.total,0),items:cheapest,missing,networks:new Set(cheapest.map(i=>i.source)).size};
 const bestSingle=stores.find(s=>s.complete)||null,savings=!pending.length&&split.complete&&bestSingle?Math.max(0,bestSingle.total-split.total):null;
 const report={items,pending,estimated:pending.length>0,stores,split,unresolved,bestSingle:bestSingle?{source:bestSingle.source,name:bestSingle.chain,total:bestSingle.total}:null,savings};
 const payload=JSON.stringify(report);
 if(payload.length<=60000)try{await store.db.run('INSERT INTO sd_basket_reports(uid,fingerprint,payload,expires) SELECT :uid,:fingerprint,:payload,:expires WHERE EXISTS(SELECT 1 FROM sd_basket_reports WHERE uid=:uid) OR (SELECT COUNT(*) FROM sd_basket_reports)<200 ON CONFLICT(uid) DO UPDATE SET fingerprint=excluded.fingerprint,payload=excluded.payload,expires=excluded.expires',{':uid':uid,':fingerprint':fingerprint,':payload':payload,':expires':now+60000});}catch{}
 return report;
}
