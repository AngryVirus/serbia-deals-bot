import {buildRefinement,refinementFilters,filterLabels,restoreRefinement} from './refinements.js';
import {basketSummary,basketNetworks,storeLabel,storePriceLabel,productIcon} from './shopping-ui.js';
import {productNames,bilingual,briefName} from './product-names.js';
import {adminRoute} from './admin.js';
import {adInput,adRoute} from './ads.js';
import {roleOf,banned,snapshot,trackUser,lockUser,unlockUser} from './moderation-state.js';
import {deliverNotice} from './moderation-notices.js';
import { Store } from './store.js';
import { OWNER_ID,assertBot,positive,safe,money,bulbQuery,unitPrice,measurementIssue,measurePolicy,milkQuery,plainMilkQuery } from './domain.js';
import { renderImage,IMAGE_VERSION,imageHash } from './image-renderer.js';
import { cartItems,addList,addOffer,compareBasket,basketParts,expandPendingList,resetProduct,saveBasketFilters,basketDemand,basketQuery } from './basket.js';
const button=(text,data)=>({text,callback_data:data});
const BACK=[[button('🏠 Меню','home')]];
async function deleteSnapshot(bot){
 const user=await bot.store.user(bot.uid),basket=await cartItems(bot.store,bot.uid),watches=await bot.store.watches(bot.uid);
 // UI positions, activity timestamps and changing price baselines are not settings.
 return imageHash(JSON.stringify({basket:basket.sort((a,b)=>a.id.localeCompare(b.id)),watches:watches.map(({product,name})=>({product,name})).sort((a,b)=>a.product.localeCompare(b.product)),settings:{enabled:user?.enabled||0,query:user?.query||null,searchFilters:user?.searchFilters||{}}}));
}
export class Bot{
 constructor(deps){Object.assign(this,deps);this.store=new Store(deps.db);this.metrics={screen:'other',lookup_ms:0,render_ms:0,telegram_ms:0};}
 async panel(text,rows=BACK,visual=true,cacheKey=null){
  const markup={inline_keyboard:rows},target=this.freshPanel?null:this.user.panel;let message,photo,isPhoto=false;
  // Only explicitly named, immutable public screens share Telegram media IDs.
  // Buttons/permissions are rebuilt for each request; private panels never enter it.
  const mediaKey=cacheKey?IMAGE_VERSION+':'+cacheKey+':'+text:null;
  let cachedId=null;
  if(visual&&this.InputFile&&mediaKey)try{cachedId=(await this.db.get('SELECT file_id FROM sd_panel_media WHERE key=:key',{':key':mediaKey}))?.file_id||null;}catch{}
  const imageFile=()=>{const started=Date.now();try{const image=renderImage(text,{format:'jpeg',compact:cacheKey!=='home'});return new this.InputFile(image.bytes,'serbia-deals.jpg',{type:'image/jpeg'});}catch{return null;}finally{this.metrics.render_ms+=Date.now()-started;}};
  if(visual&&this.InputFile)photo=cachedId||imageFile();
  const sendImage=async media=>{
   const started=Date.now();let result;
   try{
   if(target)try{result=await this.api.editMessageMedia({chat_id:this.uid,message_id:target,media:{type:'photo',media,caption:''},reply_markup:markup});}catch(e){if(/message is not modified/i.test(e.description||e.message||''))return {unchanged:true};if((e.code||e.error_code)!==400)throw e;if(cachedId)throw e;}
   if(!result)result=await this.api.sendPhoto({chat_id:this.uid,photo:media,reply_markup:markup});
   return result;
   }finally{this.metrics.telegram_ms+=Date.now()-started;this.metrics.panel=true;}
  };
  if(photo){
   try{message=await sendImage(photo);}catch(e){
    if(![400,413].includes(e.code||e.error_code))throw e;
    if(cachedId){cachedId=null;try{await this.db.run('DELETE FROM sd_panel_media WHERE key=:key',{':key':mediaKey});}catch{}photo=imageFile();if(photo)try{message=await sendImage(photo);}catch(retry){if(![400,413].includes(retry.code||retry.error_code))throw retry;}}
   }
   if(message?.unchanged)return;
   isPhoto=Boolean(message);
   const fileId=message?.photo?.at(-1)?.file_id;
   if(isPhoto&&mediaKey&&!cachedId&&typeof fileId==='string'&&fileId.length<=512)try{await this.db.run('INSERT INTO sd_panel_media(key,file_id) VALUES(:key,:id) ON CONFLICT(key) DO UPDATE SET file_id=excluded.file_id',{':key':mediaKey,':id':fileId});}catch{}
  }
  if(!message){
   const started=Date.now();try{
   const params={chat_id:this.uid,text,parse_mode:'HTML',reply_markup:markup,link_preview_options:{is_disabled:true}};
   if(target&&!this.user.photo)try{message=await this.api.editMessageText({...params,message_id:target});}catch(e){if(/message is not modified/i.test(e.description||e.message||''))return;if((e.code||e.error_code)!==400)throw e;}
   if(!message)message=await this.api.sendMessage(params);
   }finally{this.metrics.telegram_ms+=Date.now()-started;this.metrics.panel=true;}
  }
  if(!positive(message?.message_id))throw Error('Unconfirmed panel');
  if(this.user.panel&&this.user.panel!==message.message_id)try{await this.api.deleteMessage({chat_id:this.uid,message_id:this.user.panel});}catch{}
  await this.store.patch(this.uid,{panel:message.message_id,photo:isPhoto});
  this.user={...this.user,panel:message.message_id,photo:isPhoto};this.freshPanel=false;
 }
 async names(offers){return this.translationRequested?productNames(this.store,this.fetch,offers):new Map(offers.map(o=>[o.name,o.name]));}
 async home(){const rows=[[button('🔎 Найти товар','search'),button('🛒 Моя корзина','basket')],[button('🔔 Уведомления','notifications'),button('❓ Помощь','help')]];if((this.uid===OWNER_ID?'owner':await roleOf(this.store,this.uid))!=='user')rows.push([button('⚙️ Админка','admin')]);return this.panel('<b>Где дешевле? Сербия</b>\n\nСравните цены перед покупкой.\n\n<b>Найти товар:</b> один продукт или вещь\n<b>Моя корзина:</b> весь список покупок',rows,true,'home');}
 async prompt(){await this.store.patch(this.uid,{pending:'search'});return this.panel('<b>Найти товар</b>\n\nНапишите название или штрихкод.\n\nНапример: огурцы, Red Bull 500 мл или лампочка E27.\n\nДля списка покупок откройте «Моя корзина».',BACK,true,'search-prompt');}
 async refine(draft,key=null,page=0){
  const facet=draft.facets.find(f=>f.key===key),rows=[];
  if(facet){
   for(let i=page*6;i<Math.min(facet.values.length,page*6+6);i++)rows.push([button((draft.selected[key]===i?'✓ ':'')+facet.values[i].label,`ref:${draft.token}:${key}:${i}`)]);
   rows.push([button('Любой вариант',`ref:${draft.token}:${key}:any`)]);const nav=[];if(page)nav.push(button('⬅️ Варианты',`ref:${draft.token}:${key}:page${page-1}`));if(facet.values.length>(page+1)*6)nav.push(button('Варианты ➡️',`ref:${draft.token}:${key}:page${page+1}`));if(nav.length)rows.push(nav);
   return this.panel(`<b>${safe(facet.label)}</b>\n\n${productIcon(draft.query)} ${safe(draft.query)}\n\n${facet.values.length?'Выберите вариант или оставьте любой.':'С этими уточнениями вариантов нет. Оставьте любой вариант.'}`,[...rows,[button('⬅️ К уточнениям',`ref:${draft.token}:back`)]]);
  }
  const selected=Object.keys(draft.selected).length;
  const text='<b>Уточнить товар?</b>\n\n'+productIcon(draft.query)+' '+safe(draft.query)+'\n\n'+draft.facets.map(f=>`${safe(f.label)}: ${safe(f.values[draft.selected[f.key]]?.label||'любой вариант')}`).join('\n')+'\n\nНеобязательно: без выбора покажем все варианты.';
  for(const f of draft.facets)rows.push([button(f.label+': '+(f.values[draft.selected[f.key]]?.label||'любой'),`ref:${draft.token}:${f.key}:open`)]);
  rows.push([button(selected?'🔎 Показать цены':'🔎 Показать все',`ref:${draft.token}:apply`)]);if(selected)rows.push([button('Показать всё без уточнений',`ref:${draft.token}:all`)]);
  if(this.user.cartTarget)rows.push([button('✅ Сохранить в корзину',`ref:${draft.token}:save`)]);
  return this.panel(text,[...rows,...(this.user.cartTarget?[[button('🛒 Корзина','basket')]]:BACK)]);
 }
 async search(query,offset=0,source=null){
  if(measurementIssue(query)==='wrong_dimension'&&(!milkQuery(query)||plainMilkQuery(query)))return this.panel('<b>Проверьте единицу измерения</b>\n\n'+(measurePolicy(query)==='volume'?'Для этого напитка укажите объём в мл или л.':'Для этого товара укажите вес в г или кг.')+' Мы не пересчитываем граммы в литры.',[[button('🔎 Изменить запрос','search')],...(this.user.cartTarget?[[button('🛒 Корзина','basket')]]:[]),...BACK]);
  const wait=await this.store.rate(this.uid);if(wait)return this.panel(`<b>Небольшая пауза</b>\n\nПовторите поиск через ${wait} сек.`,BACK);
  try{
   if(!this.allowAll&&!source&&!offset){
    await this.store.patch(this.uid,{query,searchFilters:this.reuseFilters||{},refinement:null,searchRev:null});this.user={...this.user,query,searchFilters:this.reuseFilters||{},refinement:null,searchRev:null};
    try{const samples=await this.store.refinementSamples(query),draft=buildRefinement(query,samples.map(r=>JSON.parse(r.payload)),Math.random().toString(36).slice(2,10));if(samples.length&&draft){if(this.reuseFilters)restoreRefinement(draft,this.reuseFilters);await this.store.patch(this.uid,{refinement:draft,pending:null});this.user.refinement=draft;return this.refine(draft);}}catch{/* Ordinary search retains its own useful error response. */}
   }
   if(bulbQuery(query)&&!/(?:e14|e27|gu10|g9|g4|h4|h7)/i.test(query)&&!this.allowAll){
    await this.store.patch(this.uid,{query,pending:null});return this.panel('<b>Какая лампочка нужна?</b>\n\nЦоколь помогает подобрать подходящие варианты. Остальные характеристики будут в названии и карточке.',[[button('E27','socket:E27'),button('E14','socket:E14'),button('GU10','socket:GU10')],[button('Показать все варианты','socket:all')],...BACK]);
   }
   this.metrics.screen=source?'products':'networks';const lookupStart=Date.now();
   const rev=Math.random().toString(36).slice(2,9);let rows;
   try{rows=source?await this.store.searchChain(query,source,offset,Date.now(),this.user.searchFilters||{}):await this.store.searchChains(query,Date.now(),this.user.searchFilters||{});}
   catch(error){if(/Введите название/.test(error.message))throw error;return this.panel('<b>Поиск временно недоступен</b>\n\nНе удалось получить цены. Попробуйте ещё раз немного позже. Ваша корзина сохранена.',[[button('🔎 Повторить поиск','search')],[button('🛒 Моя корзина','basket')],...BACK]);}
   this.metrics.lookup_ms=Date.now()-lookupStart;
   await this.store.patch(this.uid,{query,offset,searchSource:source,searchRev:rev,pending:null});this.user={...this.user,query,offset,searchSource:source,searchRev:rev};
   const selected=filterLabels(this.user.searchFilters),selection=selected.length?'\n<b>Выбрано:</b> '+safe(selected.join(' · ')):'';
   if(!rows.length){
    const health=await this.store.catalogHealth(),filtered=selected.length>0&&health.fresh;
    const text=filtered?`<b>С этими уточнениями не нашли</b>\n\n${safe(query)}${selection}\n\nУберите уточнения или измените выбранные варианты.`:health.fresh?'<b>Предложений пока нет</b>\n\nПопробуйте другое название или меньше уточнений. Поиск проверяет свежие прайсы '+health.fresh+' сетей.':'<b>Свежие цены пока недоступны</b>\n\nПопробуйте позже. Ваша корзина сохранена.';
    const buttons=filtered?[[button('🔎 Показать без уточнений',`relax:${rev}`)],[button('⚙️ Изменить уточнения','refine:again')]]:[[button('🔎 Другой поиск','search')]];
    return this.panel(text,[...buttons,[button('🛒 Моя корзина','basket')],...BACK]);
   }
   if(!source){
    const shown=rows.slice(offset,offset+8),buttons=shown.map(row=>[button(storePriceLabel(row.source_name,row.min_price,row.max_price),`chainsel:${rev}:${row.source_id}:0`)]);
    const nav=[];if(offset)nav.push(button('⬅️ Назад',`chains:${rev}:${Math.max(0,offset-8)}`));if(rows.length>offset+8)nav.push(button('Далее ➡️',`chains:${rev}:${offset+8}`));if(nav.length)buttons.push(nav);
    buttons.push([button('⚙️ Фильтры','refine:again'),button('🔎 Другой товар','search')],...(this.user.cartTarget?[[button('🛒 К корзине','basket')]]:[]),...BACK);
    return this.panel(`<b>${productIcon(query)} ${safe([query,...selected].join(' · '))}</b>\n<b>Выберите магазин</b>\nДиапазон цен разных вариантов.`,buttons);
   }
   const shown=rows.slice(0,3),offers=shown.map(row=>JSON.parse(row.payload)),names=await this.names(offers),buttons=shown.map((row,index)=>[button(`${offset+index+1} · ${money(row.min_price)} · Открыть`,'offer:'+offers[index].id)]);
   const nav=[];if(offset)nav.push(button('⬅️ Товары',`chainsel:${rev}:${source}:${Math.max(0,offset-3)}`));if(rows.length>3)nav.push(button('Товары ➡️',`chainsel:${rev}:${source}:${offset+3}`));if(nav.length)buttons.push(nav);
   buttons.push([button(this.translationRequested?'🇷🇸 Оригинал':'🇷🇺 Перевести названия',this.translationRequested?'results':`translate:results:${rev}:${offset}`)]);
   buttons.push([button('⬅️ Магазины','chains'),button('🔎 Другой товар','search')],...(this.user.cartTarget?[[button('🛒 Корзина','basket')]]:[]));
   const text=`<b>${safe(storeLabel(rows[0].source_name))}</b>\n${productIcon(query)} ${safe(query)}${selection}\n\n`+shown.map((row,index)=>`<b>${productIcon(offers[index].name)} ${offset+index+1}. ${safe(briefName(names.get(offers[index].name)||bilingual(null,offers[index].name)))}</b>\nЦена: ${money(row.min_price)}${row.min_price===row.max_price?'':' — '+money(row.max_price)}${unitPrice(offers[index],row.min_price)?' · '+unitPrice(offers[index],row.min_price).label:''}`).join('\n\n');
   return this.panel(text,buttons);

  }catch(error){if(/Введите название/.test(error.message))return this.panel('<b>Уточните запрос</b>\n\nВведите название короче 120 символов.',BACK);throw error;}
 }
 async card(id){
  this.metrics.screen='card';const lookupStart=Date.now();
  const row=await this.store.offer(id);if(!row)return this.panel('<b>Предложение обновилось</b>\n\nПовторите поиск, чтобы увидеть действующие цены.',[[button('🔎 Найти товар','search')],...BACK]);
  const o=JSON.parse(row.payload),best=await this.store.cheapest(o.product),traits=o.traits||{};
  const specs=[traits.socket&&'Цоколь: '+traits.socket,traits.lumens&&'Яркость: '+traits.lumens+' лм',traits.kelvin&&'Цвет света: '+traits.kelvin+' K',traits.pack&&'В упаковке: '+traits.pack+' шт.'].filter(Boolean).join('\n');
  const names=await this.names([o]),name=names.get(o.name)||bilingual(null,o.name);
  const locations=await this.store.productLocations(o.product,o.source);this.metrics.lookup_ms=Date.now()-lookupStart;
  const text=`<b>Карточка товара</b>\n\n${productIcon(o.name)} ${safe(name)}\n\n<b>Цена:</b> ${money(row.price)}${unitPrice(o,row.price)?'\nЗа кг/литр: '+unitPrice(o,row.price).label:''}\n<b>Магазин:</b> ${safe(o.format)}\n<b>Прайс:</b> ${o.date}`+(measurementIssue(o.name)==='wrong_dimension'?'\n<b>Упаковка:</b> размер в прайсе требует проверки':'')+(row.price<o.regular?`\nСкидка до: ${safe(o.end||'не указано')}`:'')+(specs?'\n\n'+specs:'')+(o.product.startsWith('gtin:')&&best&&best.price<row.price?`\n\nВыгоднее: ${money(best.price)} · ${safe(JSON.parse(best.payload).format)}`:'')+'\n\nНаличие и цена филиала могут отличаться.';
  const rows=[[button(this.user.cartTarget?'✅ Выбрать для корзины':'🛒 Добавить в корзину','basketadd:'+o.id+':'+(this.user.cartTarget||''))],[button('🔔 Следить за ценой','watch:'+o.id)]];
  if(locations.length>1)rows.push([button('🏪 Цены внутри сети','locations:'+o.id)]);
  rows.push([button(this.translationRequested?'🇷🇸 Оригинал':'🇷🇺 Перевести название',(this.translationRequested?'offer:':'translate:offer:')+id)]);
  rows.push([button('⬅️ Товары','results'),button('🏠 Меню','home')]);
  return this.panel(text,rows);
 }
 async locations(id){
  const row=await this.store.offer(id);if(!row)return this.search(this.user.query||'');const o=JSON.parse(row.payload),locations=await this.store.productLocations(o.product,o.source);
  return this.panel('<b>Цены внутри сети</b>\n\n'+locations.slice(0,8).map(x=>`${safe(x.name)} — ${money(x.price)}`).join('\n')+'\n\nЭто форматы сети, а не адреса филиалов.',[[button('⬅️ К товару','offer:'+id)]]);

 }
 async basket(offset=0){
  await this.store.patch(this.uid,{pending:null,cartTarget:null,refinement:null});this.user={...this.user,pending:null,cartTarget:null,refinement:null};
  const items=await cartItems(this.store,this.uid),page=Math.min(Math.floor(Math.max(0,items.length-1)/5),Math.floor(offset/5)),shown=items.slice(page*5,page*5+5),rows=[],names=await this.names(shown.filter(x=>x.product));
  if(items.length)rows.push([button('💰 Сравнить цены','basketcompare')]);
  rows.push([button('➕ Добавить товары','basketinput')]);
  for(const [i,item] of shown.entries())rows.push([button(`${productIcon(item.product?item.name:item.query)} ${page*5+i+1} · ${briefName(item.query,32)} · × ${item.quantity}`,'cartitem:'+item.id)]);
  const nav=[];if(page)nav.push(button('⬅️ Назад','basket:'+((page-1)*5)));if(items.length>(page+1)*5)nav.push(button('Далее ➡️','basket:'+((page+1)*5)));if(nav.length)rows.push(nav);
  const text=items.length?`<b>Моя корзина</b>\nТоваров: ${items.length} из 30\n${this.basketFeedback?'\n'+this.basketFeedback+'\n':''}\n`+shown.map((x,i)=>`${productIcon(x.product?x.name:x.query)} ${page*5+i+1}. ${safe(briefName(x.product?names.get(x.name)||bilingual(null,x.name):x.query))} × ${x.quantity}${!x.product&&filterLabels(x.filters).length?' · '+safe(filterLabels(x.filters).join(' · ')):''}`).join('\n')+(items.length>5?`\n\nСтраница ${page+1} из ${Math.ceil(items.length/5)}`:'')+'\n\nНажмите товар, чтобы изменить его.\nСравнение по названию — предварительное.':'<b>Моя корзина</b>\n\nКорзина пока пуста.\nДобавьте товары одним сообщением:\nогурцы, курица, молоко × 2';
  return this.panel(text,[...rows,...BACK]);
 }
 async basketItem(id){
  const items=await cartItems(this.store,this.uid),index=items.findIndex(x=>x.id===id),item=items[index];if(!item)return this.basket();
  const names=item.product?await this.names([item]):new Map(),need=basketDemand(item);
  const rows=[];if(!item.product)rows.push([button(basketParts(item).length>1?'Разделить список на товары':'🔎 Уточнить товар и упаковку','resolve:'+id)]);
  if(item.product)rows.push([button('🔄 Выбрать другой товар','cartchange:'+id)]);
  if(!item.product&&Object.keys(item.filters||{}).length)rows.push([button('Сбросить уточнения','cartfilters:'+id)]);
  rows.push([button('− 1','quantity:'+id+':-1'),button('＋ 1','quantity:'+id+':1')],[button('🗑 Удалить из корзины','cartremove:'+id)],[button('⬅️ К корзине','basket:'+(Math.floor(index/5)*5))]);
  return this.panel(`<b>Товар в корзине</b>\n\n${productIcon(item.product?item.name:item.query)} ${safe(item.product?names.get(item.name)||bilingual(null,item.name):item.query)}\n\n<b>Количество:</b> ${item.quantity}\n`+(item.product?'Выбрана конкретная упаковка.':'Подбор по названию. Упаковка ещё не выбрана.')+(filterLabels(item.filters).length?'\n<b>Уточнения:</b> '+safe(filterLabels(item.filters).join(' · ')):'')+(need?'\nНужно всего: '+need.label+'; считаем полные упаковки. Кнопки меняют количество таких порций.':'\nКоличество — упаковки или штуки.'),rows);
 }
 async comparison(source=null,offset=0,itemOffset=0){
  const wait=await this.store.rate(this.uid);if(wait)return this.panel(`<b>Небольшая пауза</b>\nПовторите через ${wait} сек.`,[[button('🛒 Корзина','basket')]]);
  let report;try{report=await compareBasket(this.store,this.uid);}catch(error){if(/^(Слишком много вариантов|Прайсы обновились)/.test(error.message))return this.panel('<b>Уточните корзину</b>\n'+safe(error.message),[[button('🛒 Корзина','basket')]]);return this.panel('<b>Не удалось сравнить</b>\nПовторите чуть позже. Корзина сохранена.',[[button('🛒 Корзина','basket')]]);}
  const networks=basketNetworks(report),rows=[];
  for(const item of (report.unresolved||[]).slice(0,3))if(/^[a-z0-9-]{1,20}$/.test(item.id))rows.push([button('⚙️ Уточнить: '+item.query.slice(0,35),(report.items.find(i=>i.id===item.id)?.product?'cartitem:':'resolve:')+item.id)]);
  if(!source){
   const start=Math.min(Math.floor(offset/2)*2,Math.floor(Math.max(0,networks.length-1)/2)*2),itemStart=Math.min(Math.floor(itemOffset/5)*5,Math.floor(Math.max(0,report.items.length-1)/5)*5),names=await this.names(report.items.slice(itemStart,itemStart+5).filter(i=>i.product));
   for(const store of networks.slice(start,start+2))rows.push([button('🏪 Товары: '+storeLabel(store.chain||store.name).slice(0,25),'basketshop:'+store.source+':0')]);
   const nav=[];if(start)nav.push(button('⬅️ Магазины',`basketoverview:${start-2}:${itemStart}`));if(networks.length>start+2)nav.push(button('Магазины ➡️',`basketoverview:${start+2}:${itemStart}`));if(nav.length)rows.push(nav);
   const products=[];if(itemStart)products.push(button('⬅️ Товары',`basketoverview:${start}:${itemStart-5}`));if(report.items.length>itemStart+5)products.push(button('Товары ➡️',`basketoverview:${start}:${itemStart+5}`));if(products.length)rows.push(products);
   if(report.split?.complete&&report.split.items.length)rows.push([button('🛍 В разных магазинах · '+(report.estimated?'от ':'')+money(report.split.total),'basketsplit:0')]);
   return this.panel(basketSummary(report,{offset:start,itemOffset:itemStart,names}),[...rows,[button('🛒 Изменить корзину','basket')],...BACK]);
  }
  const shop=source==='split'?report.split:networks.find(x=>x.source===source);if(!shop?.items?.length)return this.comparison();
  const start=Math.min(offset,Math.floor((shop.items.length-1)/5)*5),shown=shop.items.slice(start,start+5),names=await this.names(shown.filter(i=>!i.estimated));
  const title=source==='split'?'Покупки в разных магазинах':storeLabel(shop.chain||shop.name);
  const missing=shop.missing||[],missingText=missing.length?'\nНе найдено или нужно уточнить: '+missing.slice(0,3).map(q=>safe(q.slice(0,60))).join(', ')+(missing.length>3?' и ещё '+(missing.length-3):''):'';
  const text=`<b>${safe(title)}</b>\n\n`+shown.map(i=>`${productIcon(i.name)} ${safe(i.estimated?i.name:briefName(names.get(i.name)||bilingual(null,i.name)))}${i.ambiguous?' — выберите вид или упаковку':i.estimated?' — выберите товар':' · точное совпадение'}\n${i.ambiguous?'Варианты: '+safe(i.choices.join(', ')):i.demand?'Нужно '+safe(i.demand)+' · '+i.quantity+' × '+safe(i.pack)+' = '+safe(i.supplied)+' · '+(i.estimated?'от ':'')+money(i.total):'× '+i.quantity+' · '+(i.estimated?'от ':'')+money(i.total)}${!i.ambiguous&&i.variant?' · '+safe(i.variant):''}${!i.ambiguous&&i.unitPrice?' · '+safe(i.unitPrice):''}${source==='split'?' · '+safe(i.store):''}`).join('\n\n')+((shop.ready??shop.items.length)===0?'\n\nИтог после выбора вида или упаковки':`\n\n<b>${shop.complete===false?'Рассчитанная часть:':report.estimated?'Предварительно от:':'Итого:'}</b> ${money(shop.total)}`)+((shop.ready??shop.found)<report.items.length&&shop.found?`\nРассчитано ${shop.ready??shop.found} из ${report.items.length} товаров`+missingText:'')+(shop.items.length>5?`\nСтраница ${Math.floor(start/5)+1} из ${Math.ceil(shop.items.length/5)}`:'')+(report.estimated?'\n\nПроверьте вид товара и упаковку.':'')+(source==='split'?'\nСтоимость поездок не включена.':'');
  for(const item of shown)if(item.estimated&&/^[a-z0-9-]{1,20}$/.test(item.id)&&/^[a-f0-9]{24}$/.test(item.source))rows.push([button((item.ambiguous?'⚙️ Уточнить: ':'🔎 Выбрать: ')+item.name.slice(0,35),item.ambiguous?'resolve:'+item.id:`basketpick:${item.id}:${item.source}`)]);
  const prefix=source==='split'?'basketsplit:':'basketshop:'+source+':',nav=[];if(start)nav.push(button('⬅️ Товары',prefix+(start-5)));if(shop.items.length>start+5)nav.push(button('Товары ➡️',prefix+(start+5)));if(nav.length)rows.push(nav);
  return this.panel(text,[...rows,[button('⬅️ Сравнение','basketcompare'),button('🛒 Корзина','basket')]]);
 }
 async watches(offset=0){
  const all=await this.store.watches(this.uid),start=Math.min(offset,Math.floor(Math.max(0,all.length-1)/5)*5),shown=all.slice(start,start+5),names=await this.names(shown),buttons=shown.map((r,i)=>[button('✖ Убрать '+(start+i+1),'remove:'+r.product)]),nav=[];
  if(start)nav.push(button('⬅️ Товары','watches:'+(start-5)));if(all.length>start+5)nav.push(button('Товары ➡️','watches:'+(start+5)));if(nav.length)buttons.push(nav);
  return this.panel('<b>Отслеживаемые товары</b>\n\n'+(shown.length?shown.map((r,i)=>`${start+i+1}. ${safe(briefName(names.get(r.name)||bilingual(null,r.name)))}`).join('\n\n'):'Найдите товар и нажмите «Следить за ценой».'),[...buttons,[button('⬅️ Уведомления','notifications')]]);
 }
 async notifications(){const rows=await this.store.watches(this.uid);return this.panel('<b>Уведомления о ценах</b>\n\n'+(this.user.enabled?'<b>Статус:</b> включены':'<b>Статус:</b> выключены')+`\n<b>Товары:</b> ${rows.length}\n\n`+(rows.length?'Сообщим о снижении цены.':'Найдите товар и нажмите «Следить за ценой».'),[[button(this.user.enabled?'🔕 Выключить уведомления':'🔔 Включить уведомления',this.user.enabled?'notify:off':'notify:on')],...(rows.length?[[button('📋 Мои отслеживания','watches')]]:[[button('🔎 Найти товар','search')]]),...BACK]);}
 async help(){
  return this.panel('<b>Как пользоваться</b>\n\n<b>Поиск:</b> название → магазин → товар\n<b>Корзина:</b> список → сравнение цен\n<b>Уведомления:</b> снижение цены выбранного товара\n\nСписок — через запятую или с новой строки.',[[{text:'💬 Поддержка',url:'https://t.me/AngryVirus'}],[button('ℹ️ О ценах и данных','help:data')],...BACK],true,'help');
 }
 async dataHelp(){const sources=(await this.store.sources()).filter(s=>s.active);return this.panel('<b>О ценах и данных</b>\n\nПрайсы магазинов: '+sources.map(s=>`<a href="${safe(s.url)}">${safe(s.name)}</a>`).join(', ')+'.\n\nДата цен — в карточке. Наличие и цены филиалов могут отличаться.\n\nНазвания показаны как в прайсе. Перевод на русский доступен по кнопке в списке товаров и карточке. Сербский оригинал сохранён. Для перевода передаётся только публичное название товара.\n\n/delete — удалить свою корзину и настройки.',[[button('⬅️ Помощь','help')]],false);}
 async handle(update){
  const requestStart=Date.now();
  await assertBot(this.api);
  const cb=update.callback_query,msg=cb?.message||update.message,uid=(cb?.from||msg?.from)?.id;
  if(!positive(uid)||!positive(msg?.message_id)||msg?.chat?.type!=='private'||msg.chat.id!==uid||(cb&&(typeof cb.id!=='string'||cb.id.length>128||cb.from.is_bot)))return;
  await this.store.init();if(await this.store.meta('active')!==true)return;
  const key=uid+':'+(cb?'c'+cb.id:'m'+msg.message_id),now=Date.now();
  if(!await lockUser(this.store,uid,key,now))return;
  try{
   const claimed=await this.db.run('INSERT INTO sd_updates(id,expires) VALUES(:key,:expires) ON CONFLICT DO NOTHING',{':key':key,':expires':now+172800000});if(claimed.rowsAffected!==1)return;
   this.uid=uid;this.requestLock=key;this.actor=snapshot(cb?.from||msg.from);this.inputMessageId=update.message?.message_id;
   if(await banned(this.store,uid)){await deliverNotice(this.store,this.api,this.InputFile,'ban',uid,true,key);return;}
   if(cb)try{await this.api.answerCallbackQuery({callback_query_id:cb.id});}catch{}
   this.user=await this.store.ensure(uid);this.user={...this.user,...await trackUser(this.store,cb?.from||msg.from),blocked:0};
   await deliverNotice(this.store,this.api,this.InputFile,'ban',uid,true,key);await deliverNotice(this.store,this.api,this.InputFile,'role',uid,true,key);
   this.freshPanel=!cb;
   if(cb){this.user.panel=msg.message_id;if(Array.isArray(msg.photo))this.user.photo=true;else if(typeof msg.text==='string')this.user.photo=false;}
   return await this.dispatch(update);
  }finally{if(this.metrics.panel)try{const {panel,screen,...timing}=this.metrics;await this.store.setMeta('ui_latency:'+screen,{at:Date.now(),request_ms:Date.now()-requestStart,...timing});}catch{}await unlockUser(this.store,uid,key);await this.db.run('DELETE FROM sd_updates WHERE expires<:now',{':now':now});}
 }
 async dispatch(update){
  const cb=update.callback_query,msg=cb?.message||update.message,uid=this.uid;
  const action=cb?.data||'',text=update.message?.text?.trim();
  if(action==='home'||['/start','/menu','/cancel'].includes(text)){await this.store.patch(uid,{pending:null,cartTarget:null,adminInput:null,adminDraft:null,refinement:null,deleteDraft:null});return this.home();}
  if(this.user.deleteDraft&&((action&&!action.startsWith('delete:confirm'))||(text&&text!=='/delete'))){await this.store.patch(uid,{deleteDraft:null});this.user.deleteDraft=null;}
  if(action==='ads'||action.startsWith('ads:')){
   if(uid===OWNER_ID){await this.store.patch(uid,{adminInput:null,adminDraft:null,pending:null,cartTarget:null});this.user={...this.user,adminInput:null,adminDraft:null,pending:null,cartTarget:null};}
   return adRoute(this,action);
  }
  if(update.message&&await adInput(this,update.message))return;
  if(['ad_post','ad_link'].includes(this.user.pending)&&(action||text?.startsWith('/'))){await this.store.patch(uid,{pending:null});this.user.pending=null;}
  if(await adminRoute(this,action,text))return;
  if(action&&!action.startsWith('admin'))await this.store.patch(uid,{adminInput:null,adminDraft:null,pending:null});
  if(action.startsWith('ref:')){
   const draft=this.user.refinement,parts=action.split(':'),token=parts[1];
   if(!draft||draft.token!==token||draft.expires<Date.now())return this.panel('<b>Уточнения уже изменились</b>\nОткройте поиск заново.',[[button('🔎 Поиск','search')]]);
   if(parts.length===3&&parts[2]==='save'&&this.user.cartTarget){const id=this.user.cartTarget,filters=refinementFilters(draft);if(!await saveBasketFilters(this.store,uid,id,filters))return this.basket();await this.store.patch(uid,{refinement:null,cartTarget:null});return this.basketItem(id);}
   if(parts.length===3&&['apply','all'].includes(parts[2])){const filters=parts[2]==='all'?{}:refinementFilters(draft);await this.store.patch(uid,{refinement:null,searchFilters:filters});this.user={...this.user,refinement:null,searchFilters:filters};this.allowAll=true;return this.search(draft.query);}
   if(parts.length===3&&parts[2]==='back')return this.refine(draft);
   const facet=draft.facets.find(f=>f.key===parts[2]),value=parts[3];if(!facet||parts.length!==4)return this.refine(draft);
   if(value==='open'){
    const wait=await this.store.rate(uid);if(wait)return this.panel(`<b>Небольшая пауза</b>\nПовторите через ${wait} сек.`,[[button('⬅️ К уточнениям',`ref:${draft.token}:back`)]]);
    try{const filters=refinementFilters(draft);delete filters[facet.key];if(['brand','type'].includes(facet.key))for(const key of ['pack','fat','socket'])delete filters[key];const samples=await this.store.refinementSamples(draft.query,Date.now(),filters),available=buildRefinement(draft.query,samples.map(r=>JSON.parse(r.payload)),draft.token,Date.now(),true),next=available?.facets.find(f=>f.key===facet.key),previous=facet.values[draft.selected[facet.key]]?.value;facet.values=next?.values||[];const index=facet.values.findIndex(v=>JSON.stringify(v.value)===JSON.stringify(previous));if(index<0)delete draft.selected[facet.key];else draft.selected[facet.key]=index;draft.token=Math.random().toString(36).slice(2,10);await this.store.patch(uid,{refinement:draft});}catch{/* Existing validated choices remain usable if a refresh fails. */}
    return this.refine(draft,facet.key);
   }
   if(/^page[0-3]$/.test(value))return this.refine(draft,facet.key,Number(value.slice(4)));
   if(value==='any')delete draft.selected[facet.key];else if(/^\d{1,2}$/.test(value)&&facet.values[Number(value)])draft.selected[facet.key]=Number(value);else return this.refine(draft);
   if(['brand','type'].includes(facet.key)){
    delete draft.selected.pack;delete draft.selected.fat;delete draft.selected.socket;
    try{
     const filters=refinementFilters(draft),samples=await this.store.refinementSamples(draft.query,Date.now(),filters),next=buildRefinement(draft.query,samples.map(r=>JSON.parse(r.payload)),Math.random().toString(36).slice(2,10),Date.now(),true);
     if(next){restoreRefinement(next,filters);await this.store.patch(uid,{refinement:next});this.user.refinement=next;return this.refine(next);}
    }catch{/* Keep existing choices if the optional refresh fails. */}
   }
   await this.store.patch(uid,{refinement:draft});return this.refine(draft);
  }
  if(/^relax:[a-z0-9]{7}$/.test(action)){
   if(action.slice(6)!==this.user.searchRev||!this.user.query)return this.panel('<b>Поиск уже изменился</b>',[[button('🔎 Поиск','search')]]);
   await this.store.patch(uid,{searchFilters:{},refinement:null});this.user={...this.user,searchFilters:{},refinement:null};this.allowAll=true;return this.search(this.user.query);
  }
  if(action==='refine:again'&&this.user.query){this.reuseFilters=this.user.searchFilters||{};return this.search(this.user.query);}
  if(action==='search'){await this.store.patch(uid,{cartTarget:null,refinement:null});return this.prompt();}
  if(action==='basket')return this.basket();
  if(/^basket:(0|5|10|15|20|25)$/.test(action))return this.basket(Number(action.slice(7)));
  if(/^cartitem:[a-z0-9-]{1,40}$/.test(action))return this.basketItem(action.slice(9));
  if(/^cartchange:[a-z0-9-]{1,40}$/.test(action)){const next=await resetProduct(this.store,uid,action.slice(11));if(!next)return this.basket();await this.store.patch(uid,{cartTarget:null,refinement:null,searchFilters:{}});this.user={...this.user,cartTarget:null,refinement:null,searchFilters:{}};return this.basketItem(next);}
  if(/^cartfilters:[a-z0-9-]{1,40}$/.test(action)){const id=action.slice(12);await saveBasketFilters(this.store,uid,id,{});await this.store.patch(uid,{refinement:null,cartTarget:null});this.user={...this.user,refinement:null,cartTarget:null};return this.basketItem(id);}
  if(action==='basketinput'){await this.store.patch(uid,{pending:'basket',cartTarget:null});return this.panel('<b>Добавить товары</b>\n\nНапишите список через запятую или с новой строки.\n\nМолоко 2 л, кофе 500 г, огурцы\n\n2 л или 500 г — сколько нужно всего.\nДля повторения добавьте × 2.\nДо 30 позиций в корзине.',[[button('⬅️ К корзине','basket')],...BACK],true,'basket-input');}
  if(action==='basketcompare')return this.comparison();
  if(/^basketoverview:(0|[1-9][0-9]?):(0|5|10|15|20|25)$/.test(action)){const [,offset,itemOffset]=action.split(':');return this.comparison(null,Number(offset),Number(itemOffset));}
  if(/^basketshop:[a-f0-9]{24}:(0|5|10|15|20|25)$/.test(action)){const [,source,offset]=action.split(':');return this.comparison(source,Number(offset));}
  if(/^basketsplit:(0|5|10|15|20|25)$/.test(action))return this.comparison('split',Number(action.split(':')[1]));
  if(/^basketpick:[a-z0-9-]{1,20}:[a-f0-9]{24}$/.test(action)){const [,id,source]=action.split(':'),item=(await cartItems(this.store,uid)).find(x=>x.id===id&&!x.product);if(!item)return this.basket();await this.store.patch(uid,{cartTarget:id,searchFilters:item.filters||{},refinement:null});this.user={...this.user,cartTarget:id,searchFilters:item.filters||{},refinement:null};this.allowAll=true;return this.search(basketQuery(item),0,source);}
  if(/^resolve:[a-z0-9-]{1,20}$/.test(action)){const item=(await cartItems(this.store,uid)).find(x=>x.id===action.slice(8)&&!x.product);if(item){if(await expandPendingList(this.store,uid,item.id))return this.basket();await this.store.patch(uid,{cartTarget:item.id});this.user.cartTarget=item.id;this.reuseFilters=item.filters||{};return this.search(basketQuery(item));}return this.basket();}
  if(/^basketadd:[a-f0-9]{32}:[a-z0-9-]{0,20}$/.test(action)){const [,id,target]=action.split(':'),found=await this.store.offer(id);if(!found)return this.panel('<b>Предложение обновилось</b>\n\nТовар не добавлен. Откройте актуальные предложения.',[[button('⬅️ К товарам','results')],[button('🛒 Корзина','basket')],...BACK]);if(found){try{const added=await addOffer(this.store,uid,JSON.parse(found.payload),target||null);if(!added){await this.store.patch(uid,{cartTarget:null});return this.panel('<b>Позиция корзины уже изменилась</b>\n\nЭта кнопка выбора устарела или товар не соответствует сохранённым уточнениям. Откройте корзину и выберите актуальную позицию.',[[button('🛒 Открыть корзину','basket')],...BACK]);}}catch(error){return this.panel(safe(error.message),[[button('🛒 Корзина','basket')],...BACK]);}}await this.store.patch(uid,{cartTarget:null});this.basketFeedback='✓ Товар сохранён в корзине';return this.basket();}
  if(/^cartremove:[a-z0-9-]{1,40}$/.test(action)){await cartItems(this.store,uid);await this.db.run('DELETE FROM sd_basket WHERE uid=:uid AND id=:id',{':uid':uid,':id':action.slice(11)});await this.db.run('DELETE FROM sd_basket_filters WHERE uid=:uid AND id=:id',{':uid':uid,':id':action.slice(11)});return this.basket();}
  if(/^quantity:[a-z0-9-]{1,40}:-?1$/.test(action)){const [,id,delta]=action.split(':');await this.db.run('UPDATE sd_basket SET quantity=MIN(99,MAX(1,quantity+:delta)) WHERE uid=:uid AND id=:id',{':uid':uid,':id':id,':delta':Number(delta)});return this.basketItem(id);}
  if(action==='help:data')return this.dataHelp();
  if(action==='help'||text==='/help')return this.help();
  if(text==='/delete'){
   const draft={token:Date.now().toString(36)+Math.random().toString(36).slice(2,12),expires:Date.now()+10*60000,snapshot:await deleteSnapshot(this)};
   await this.store.patch(uid,{deleteDraft:draft});this.user.deleteDraft=draft;
   return this.panel('<b>Удалить данные?</b>\n\nУдалим ваш список и настройки, отключим уведомления.\nПодтверждение действует 10 минут, пока вы не изменили данные или не перешли в другой раздел.',[[button('Удалить мои данные','delete:confirm:'+draft.token)],...BACK]);
  }
  if(action==='delete:confirm'||action.startsWith('delete:confirm:')){
   const draft=this.user.deleteDraft;
   if(!draft||!/^delete:confirm:[a-z0-9]{10,30}$/.test(action)||draft.token!==action.slice(15)||draft.expires<=Date.now()||draft.snapshot!==await deleteSnapshot(this)){
    await this.store.patch(uid,{deleteDraft:null});return this.panel('<b>Подтверждение устарело</b>\n\nДанные сохранены. Для удаления ещё раз отправьте /delete.',BACK);
   }
   await this.store.patch(uid,{deleteDraft:null});await this.db.run('DELETE FROM sd_basket WHERE uid=:uid',{':uid':uid});await this.db.run('DELETE FROM sd_basket_filters WHERE uid=:uid',{':uid':uid});await this.store.deleteUser(uid);return this.api.sendMessage({chat_id:uid,text:'Ваши данные удалены. /start — начать заново.'});
  }
  if(action==='watches')return this.watches();
  if(/^watches:\d{1,2}$/.test(action))return this.watches(Math.min(95,Number(action.slice(8))));
  if(action==='notifications')return this.notifications();
  if(/^notify:(on|off)$/.test(action)){await this.db.run('UPDATE sd_users SET enabled=:on,blocked=0 WHERE id=:uid',{':on':action==='notify:on'?1:0,':uid':uid});if(action==='notify:off')await this.db.run("UPDATE sd_queue SET state='cancelled' WHERE uid=:uid AND state='pending'",{':uid':uid});this.user=await this.store.user(uid);return this.notifications();}
  if(/^socket:(E27|E14|GU10|all)$/.test(action)&&this.user.query){const socket=action.split(':')[1];this.allowAll=true;return this.search(this.user.query+(socket==='all'?'':' '+socket));}
  if(/^page:[a-z0-9]{7}:\d{1,4}$/.test(action)){const [,rev,offset]=action.split(':');if(rev===this.user.searchRev&&Number(offset)<=1000){this.allowAll=true;return this.search(this.user.query,Number(offset),this.user.searchSource||null);}return this.panel('<b>Поиск уже изменился</b>\n\nОткройте текущие результаты.',[[button('К результатам','results')],...BACK]);}
  if((action==='chains'||/^chains:[a-z0-9]{7}:\d{1,3}$/.test(action))&&this.user.query){const [,rev,offset]=action.split(':');if(!rev||rev===this.user.searchRev){this.allowAll=true;return this.search(this.user.query,Number(offset)||0,null);}return this.panel('<b>Поиск уже изменился</b>',[[button('К результатам','results')],...BACK]);}
  if(/^chainsel:[a-z0-9]{7}:[a-f0-9]{24}:\d{1,4}$/.test(action)&&this.user.query){const [,rev,source,offset]=action.split(':');if(rev===this.user.searchRev&&Number(offset)<=1000){this.allowAll=true;return this.search(this.user.query,Number(offset),source);}return this.panel('<b>Поиск уже изменился</b>',[[button('К результатам','results')],...BACK]);}
  if(action==='results'&&this.user.query){this.allowAll=true;return this.search(this.user.query,this.user.offset||0,this.user.searchSource||null);}
  if(/^locations:[a-f0-9]{32}$/.test(action))return this.locations(action.slice(10));
  if(/^translate:offer:[a-f0-9]{32}$/.test(action)){
   const wait=await this.store.rate(uid);if(wait)return this.panel(`<b>Небольшая пауза</b>\nПеревод будет доступен через ${wait} сек.`,[[button('⬅️ К товару','offer:'+action.slice(16))]]);
   this.translationRequested=true;return this.card(action.slice(16));
  }
  if(/^translate:results:[a-z0-9]{7}:\d{1,4}$/.test(action)){
   const [, ,rev,offset]=action.split(':');if(rev!==this.user.searchRev||Number(offset)!==(this.user.offset||0)||!this.user.query||!this.user.searchSource)return this.panel('<b>Поиск уже изменился</b>',[[button('К результатам','results')],...BACK]);
   this.translationRequested=true;this.allowAll=true;return this.search(this.user.query,Number(offset),this.user.searchSource);
  }
  if(/^offer:[a-f0-9]{32}$/.test(action))return this.card(action.slice(6));
  if(/^watch:[a-f0-9]{32}$/.test(action)){
   let added;try{added=await this.store.watch(uid,action.slice(6));}catch(error){if(error.message!=='Можно отслеживать до 100 товаров.')throw error;return this.panel('<b>Лимит отслеживаний</b>\n\nМожно отслеживать до 100 товаров. Уберите ненужный товар из списка, чтобы добавить новый.',[[button('📋 Мои отслеживания','watches')],[button('⬅️ К товару','offer:'+action.slice(6))],...BACK]);}
   return this.panel(added?'<b>Товар отслеживается</b>\n\n'+(this.user.enabled?'Сообщим о снижении цены.':'Включите уведомления, чтобы получать сообщения.'):'<b>Предложение обновилось</b>\n\nПовторите поиск.',[[button(this.user.enabled?'🔔 Уведомления':'🔔 Включить уведомления',this.user.enabled?'notifications':'notify:on')],[button('⬅️ К товару','offer:'+action.slice(6))],...BACK]);
  }
  if(/^remove:(?:gtin:\d{14}|local:[a-f0-9]{32})$/.test(action)){await this.store.removeWatch(uid,action.slice(7));return this.watches();}
  if(text&&!text.startsWith('/')){if(this.user.pending==='basket'){try{await addList(this.store,uid,text,msg.message_id);}catch(error){return this.panel(safe(error.message),[[button('🛒 Корзина','basket')],...BACK]);}await this.store.patch(uid,{pending:null});try{await this.api.deleteMessage({chat_id:uid,message_id:msg.message_id});}catch{}return this.basket();}await this.store.patch(uid,{pending:null});const result=await this.search(text);try{await this.api.deleteMessage({chat_id:uid,message_id:msg.message_id});}catch{}return result;}
  return this.home();
 }
}
