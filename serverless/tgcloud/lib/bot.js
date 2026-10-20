import {buildRefinement,refinementFilters,filterLabels} from './refinements.js';
import {basketSummary,basketNetworks} from './shopping-ui.js';
import {productNames,bilingual,briefName} from './product-names.js';
import {adminRoute} from './admin.js';
import {roleOf,banned,snapshot,trackUser,lockUser,unlockUser} from './moderation-state.js';
import {deliverNotice} from './moderation-notices.js';
import { Store } from './store.js';
import { OWNER_ID,assertBot,positive,safe,money,bulbQuery } from './domain.js';
import { renderImage } from './image-renderer.js';
import { cartItems,addList,addOffer,compareBasket,parseList,expandPendingList } from './basket.js';
const button=(text,data)=>({text,callback_data:data});
const BACK=[[button('🏠 Меню','home')]];
export class Bot{
 constructor(deps){Object.assign(this,deps);this.store=new Store(deps.db);}
 async panel(text,rows=BACK,visual=true){
  const markup={inline_keyboard:rows},target=this.freshPanel?null:this.user.panel;let message,photo,isPhoto=false;
  if(visual&&this.InputFile)try{const image=renderImage(text);photo=new this.InputFile(image.bytes,'serbia-deals.png',{type:'image/png'});}catch{/* A failed visual must leave a usable text menu. */}
  if(photo){
   if(target)try{message=await this.api.editMessageMedia({chat_id:this.uid,message_id:target,media:{type:'photo',media:photo,caption:''},reply_markup:markup});}catch(e){if(/message is not modified/i.test(e.description||e.message||''))return;if((e.code||e.error_code)!==400)throw e;}
   if(!message)try{message=await this.api.sendPhoto({chat_id:this.uid,photo,reply_markup:markup});}catch(e){if(![400,413].includes(e.code||e.error_code))throw e;}
   isPhoto=Boolean(message);
  }
  if(!message){
   const params={chat_id:this.uid,text,parse_mode:'HTML',reply_markup:markup,link_preview_options:{is_disabled:true}};
   if(target&&!this.user.photo)try{message=await this.api.editMessageText({...params,message_id:target});}catch(e){if(/message is not modified/i.test(e.description||e.message||''))return;if((e.code||e.error_code)!==400)throw e;}
   if(!message)message=await this.api.sendMessage(params);
  }
  if(!positive(message?.message_id))throw Error('Unconfirmed panel');
  if(this.user.panel&&this.user.panel!==message.message_id)try{await this.api.deleteMessage({chat_id:this.uid,message_id:this.user.panel});}catch{}
  await this.store.patch(this.uid,{panel:message.message_id,photo:isPhoto});
  this.user={...this.user,panel:message.message_id,photo:isPhoto};this.freshPanel=false;
 }
 async names(offers){return productNames(this.store,this.fetch,offers);}
 async home(){const rows=[[button('🔎 Найти товар','search'),button('🛒 Моя корзина','basket')],[button('🔔 Уведомления','notifications'),button('❓ Помощь','help')]];if((this.uid===OWNER_ID?'owner':await roleOf(this.store,this.uid))!=='user')rows.push([button('⚙️ Админка','admin')]);return this.panel('<b>Где дешевле? Сербия</b>\n\n<b>Поиск:</b> один товар\n<b>Корзина:</b> весь список покупок\n\nВыберите, что сравнить.',rows);}
 async prompt(){await this.store.patch(this.uid,{pending:'search'});return this.panel('<b>Найти товар</b>\n\nНазвание или штрихкод.\nНапример: огурцы · Red Bull · лампочка E27',BACK);}
 async refine(draft,key=null,page=0){
  const facet=draft.facets.find(f=>f.key===key),rows=[];
  if(facet){
   for(let i=page*6;i<Math.min(facet.values.length,page*6+6);i++)rows.push([button((draft.selected[key]===i?'✓ ':'')+facet.values[i].label,`ref:${draft.token}:${key}:${i}`)]);
   rows.push([button('Любой вариант',`ref:${draft.token}:${key}:any`)]);const nav=[];if(page)nav.push(button('⬅️',`ref:${draft.token}:${key}:page${page-1}`));if(facet.values.length>(page+1)*6)nav.push(button('➡️',`ref:${draft.token}:${key}:page${page+1}`));if(nav.length)rows.push(nav);
   return this.panel(`<b>${safe(facet.label)}</b>\n\n${safe(draft.query)}\n\n${facet.values.length?'Выберите вариант или оставьте любой.':'С этими уточнениями вариантов нет. Оставьте любой вариант.'}`,[...rows,[button('⬅️ К уточнениям',`ref:${draft.token}:back`)]]);
  }
  const selected=Object.keys(draft.selected).length;
  const text='<b>Уточнить товар?</b>\n\n'+safe(draft.query)+'\n\n'+draft.facets.map(f=>`${safe(f.label)}: ${safe(f.values[draft.selected[f.key]]?.label||'любой вариант')}`).join('\n')+'\n\nНеобязательно: без выбора покажем все варианты.';
  for(const f of draft.facets)rows.push([button(f.label+': '+(f.values[draft.selected[f.key]]?.label||'любой'),`ref:${draft.token}:${f.key}:open`)]);
  rows.push([button(selected?'🔎 Найти варианты':'🔎 Показать все',`ref:${draft.token}:apply`)]);if(selected)rows.push([button('Показать всё без уточнений',`ref:${draft.token}:all`)]);
  return this.panel(text,[...rows,...(this.user.cartTarget?[[button('🛒 Корзина','basket')]]:BACK)]);
 }
 async search(query,offset=0,source=null){
  const wait=await this.store.rate(this.uid);if(wait)return this.panel(`<b>Небольшая пауза</b>\n\nПовторите поиск через ${wait} сек.`,BACK);
  try{
   if(!this.allowAll&&!source&&!offset){
    await this.store.patch(this.uid,{query,searchFilters:this.reuseFilters||{},refinement:null,searchRev:null});this.user={...this.user,query,searchFilters:this.reuseFilters||{},refinement:null,searchRev:null};
    try{const samples=await this.store.refinementSamples(query),draft=buildRefinement(query,samples.map(r=>JSON.parse(r.payload)),Math.random().toString(36).slice(2,10));if(samples.length&&draft){if(this.reuseFilters)for(const facet of draft.facets){const index=facet.values.findIndex(v=>JSON.stringify(v.value)===JSON.stringify(this.reuseFilters[facet.key]));if(index>=0)draft.selected[facet.key]=index;}await this.store.patch(this.uid,{refinement:draft,pending:null});this.user.refinement=draft;return this.refine(draft);}}catch{/* Ordinary search retains its own useful error response. */}
   }
   if(bulbQuery(query)&&!/(?:e14|e27|gu10|g9|g4|h4|h7)/i.test(query)&&!this.allowAll){
    await this.store.patch(this.uid,{query,pending:null});return this.panel('<b>Какая лампочка нужна?</b>\n\nЦоколь помогает подобрать подходящие варианты. Остальные характеристики будут в названии и карточке.',[[button('E27','socket:E27'),button('E14','socket:E14'),button('GU10','socket:GU10')],[button('Показать все варианты','socket:all')],...BACK]);
   }
   const rev=Math.random().toString(36).slice(2,9);let rows;
   try{rows=source?await this.store.searchChain(query,source,offset,Date.now(),this.user.searchFilters||{}):await this.store.searchChains(query,Date.now(),this.user.searchFilters||{});}
   catch(error){if(/Введите название/.test(error.message))throw error;return this.panel('<b>Поиск временно недоступен</b>\n\nНе удалось получить цены. Попробуйте ещё раз немного позже. Ваша корзина сохранена.',[[button('🔎 Повторить поиск','search')],[button('🛒 Моя корзина','basket')],...BACK]);}
   await this.store.patch(this.uid,{query,offset,searchSource:source,searchRev:rev,pending:null});this.user={...this.user,query,offset,searchSource:source,searchRev:rev};
   const selected=filterLabels(this.user.searchFilters),selection=selected.length?'\n<b>Выбрано:</b> '+safe(selected.join(' · ')):'';
   if(!rows.length){
    const health=await this.store.catalogHealth(),filtered=selected.length>0&&health.fresh;
    const text=filtered?`<b>С этими уточнениями не нашли</b>\n\n${safe(query)}${selection}\n\nУберите уточнения или измените выбранные варианты.`:health.fresh?'<b>Предложений пока нет</b>\n\nПопробуйте другое название или меньше уточнений. Поиск проверяет свежие прайсы '+health.fresh+' сетей.':'<b>Свежие цены пока недоступны</b>\n\nПопробуйте позже. Ваша корзина сохранена.';
    const buttons=filtered?[[button('🔎 Показать без уточнений',`relax:${rev}`)],[button('⚙️ Изменить уточнения','refine:again')]]:[[button('🔎 Другой поиск','search')]];
    return this.panel(text,[...buttons,[button('🛒 Моя корзина','basket')],...BACK]);
   }
   if(!source){
    const shown=rows.slice(offset,offset+8),buttons=shown.map(row=>[button(`${row.source_name} · ${money(row.min_price)}${row.min_price===row.max_price?'':' – '+money(row.max_price)}`.slice(0,90),`chainsel:${rev}:${row.source_id}:0`)]);
    const nav=[];if(offset)nav.push(button('⬅️ Назад',`chains:${rev}:${Math.max(0,offset-8)}`));if(rows.length>offset+8)nav.push(button('Далее ➡️',`chains:${rev}:${offset+8}`));if(nav.length)buttons.push(nav);
    buttons.push([button('⚙️ Уточнить','refine:again'),button('🔎 Поиск','search')],...(this.user.cartTarget?[[button('🛒 К корзине','basket')]]:[]),...BACK);
    return this.panel(`<b>Где купить: ${safe(query)}</b>${selection}\n\n<b>Магазины:</b> ${rows.length}\nВыберите сеть ниже.\n\nДиапазон цен включает разные упаковки.`,buttons);
   }
   const shown=rows.slice(0,3),offers=shown.map(row=>JSON.parse(row.payload)),names=await this.names(offers),buttons=shown.map((row,index)=>[button(`${offset+index+1} · ${money(row.min_price)} · Выбрать`,'offer:'+offers[index].id)]);
   const nav=[];if(offset)nav.push(button('⬅️',`chainsel:${rev}:${source}:${Math.max(0,offset-3)}`));if(rows.length>3)nav.push(button('➡️',`chainsel:${rev}:${source}:${offset+3}`));if(nav.length)buttons.push(nav);
   buttons.push([button('⬅️ Магазины','chains'),button('🔎 Поиск','search')],...(this.user.cartTarget?[[button('🛒 Корзина','basket')]]:[]));
   const text=`<b>${safe(rows[0].source_name)}</b>\nПоиск: ${safe(query)}${selection}\n\n`+shown.map((row,index)=>`<b>${offset+index+1}. ${safe(briefName(names.get(offers[index].name)||bilingual(null,offers[index].name)))}</b>\nЦена: ${money(row.min_price)}${row.min_price===row.max_price?'':' — '+money(row.max_price)}`).join('\n\n');
   return this.panel(text,buttons);

  }catch(error){if(/Введите название/.test(error.message))return this.panel('<b>Уточните запрос</b>\n\nВведите название короче 120 символов.',BACK);throw error;}
 }
 async card(id){
  const row=await this.store.offer(id);if(!row)return this.panel('<b>Предложение обновилось</b>\n\nПовторите поиск, чтобы увидеть действующие цены.',[[button('🔎 Найти товар','search')],...BACK]);
  const o=JSON.parse(row.payload),best=await this.store.cheapest(o.product),traits=o.traits||{};
  const specs=[traits.socket&&'Цоколь: '+traits.socket,traits.lumens&&'Яркость: '+traits.lumens+' лм',traits.kelvin&&'Цвет света: '+traits.kelvin+' K',traits.pack&&'В упаковке: '+traits.pack+' шт.'].filter(Boolean).join('\n');
  const names=await this.names([o]),name=names.get(o.name)||bilingual(null,o.name);
  const locations=await this.store.productLocations(o.product,o.source);
  const text=`<b>${safe(name)}</b>\n\n<b>Цена:</b> ${money(row.price)}\n<b>Магазин:</b> ${safe(o.format)}\n<b>Прайс:</b> ${o.date}`+(row.price<o.regular?`\nСкидка до: ${safe(o.end||'не указано')}`:'')+(specs?'\n\n'+specs:'')+(o.product.startsWith('gtin:')&&best&&best.price<row.price?`\n\nВыгоднее: ${money(best.price)} · ${safe(JSON.parse(best.payload).format)}`:'')+'\n\nНаличие и цена филиала могут отличаться.';
  const rows=[[button(this.user.cartTarget?'✅ Выбрать для корзины':'🛒 В корзину','basketadd:'+o.id+':'+(this.user.cartTarget||'')),button('🔔 Следить','watch:'+o.id)]];
  if(locations.length>1)rows.push([button('🏪 Цены внутри сети','locations:'+o.id)]);
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
  if(items.length)rows.push([button('💰 Найти выгодную корзину','basketcompare')]);
  rows.push([button('➕ Добавить товары','basketinput')]);
  for(const [i,item] of shown.entries())rows.push([button(`${page*5+i+1} · Изменить × ${item.quantity}`,'cartitem:'+item.id)]);
  const nav=[];if(page)nav.push(button('⬅️ Назад','basket:'+((page-1)*5)));if(items.length>(page+1)*5)nav.push(button('Далее ➡️','basket:'+((page+1)*5)));if(nav.length)rows.push(nav);
  const text=items.length?`<b>Моя корзина · ${items.length} из 30</b>\n\n`+shown.map((x,i)=>`${page*5+i+1}. ${safe(briefName(x.product?names.get(x.name)||bilingual(null,x.name):x.query))} × ${x.quantity}`).join('\n')+(items.length>5?`\n\nСтраница ${page+1} из ${Math.ceil(items.length/5)}`:'')+'\n\nСравнение по названию. Уточните упаковки для точности.':'<b>Ваша корзина пока пуста</b>\n\nДобавьте список:\nогурцы, курица, молоко × 2';
  return this.panel(text,[...rows,...BACK]);
 }
 async basketItem(id){
  const items=await cartItems(this.store,this.uid),index=items.findIndex(x=>x.id===id),item=items[index];if(!item)return this.basket();
  const names=item.product?await this.names([item]):new Map();
  const rows=[];if(!item.product)rows.push([button(parseList(item.query).length>1?'Разделить список на товары':'🔎 Уточнить товар и упаковку','resolve:'+id)]);
  rows.push([button('− 1','quantity:'+id+':-1'),button('＋ 1','quantity:'+id+':1')],[button('🗑 Удалить из корзины','cartremove:'+id)],[button('⬅️ К корзине','basket:'+(Math.floor(index/5)*5))]);
  return this.panel(`<b>Товар в корзине</b>\n\n${safe(item.product?names.get(item.name)||bilingual(null,item.name):item.query)}\n\n<b>Количество:</b> ${item.quantity}\n`+(item.product?'Выбрана конкретная упаковка.':'Подбор по названию. Упаковка ещё не выбрана.')+'\nКоличество — упаковки или штуки.',rows);
 }
 async comparison(source=null,offset=0){
  const wait=await this.store.rate(this.uid);if(wait)return this.panel(`<b>Небольшая пауза</b>\nПовторите через ${wait} сек.`,[[button('🛒 Корзина','basket')]]);
  let report;try{report=await compareBasket(this.store,this.uid);}catch{return this.panel('<b>Не удалось сравнить</b>\nПовторите чуть позже. Корзина сохранена.',[[button('🛒 Корзина','basket')]]);}
  const networks=basketNetworks(report),rows=[];
  if(!source){
   for(const store of networks.slice(0,4))rows.push([button('🏪 '+(store.chain||store.name).slice(0,45),'basketshop:'+store.source+':0')]);
   if(report.split?.complete&&report.split.items.length)rows.push([button('🛍 В разных магазинах · '+money(report.split.total),'basketsplit:0')]);
   return this.panel(basketSummary(report),[...rows,[button('🛒 Изменить корзину','basket')],...BACK]);
  }
  const shop=source==='split'?report.split:networks.find(x=>x.source===source);if(!shop?.items?.length)return this.comparison();
  const start=Math.min(offset,Math.floor((shop.items.length-1)/5)*5),shown=shop.items.slice(start,start+5),names=await this.names(shown);
  const title=source==='split'?'Покупки в разных магазинах':shop.chain||shop.name;
  const text=`<b>${safe(title)}</b>\n\n`+shown.map(i=>`${safe(briefName(names.get(i.name)||bilingual(null,i.name)))}\n× ${i.quantity} · ${money(i.total)}${source==='split'?' · '+safe(i.store):''}`).join('\n\n')+`\n\n<b>Итого:</b> ${money(shop.total)}`+(shop.found&&shop.found<report.items.length?`\nТолько ${shop.found} из ${report.items.length} товаров`:'')+(shop.items.length>5?`\nСтраница ${Math.floor(start/5)+1} из ${Math.ceil(shop.items.length/5)}`:'')+(report.estimated?'\n\nПроверьте вид товара и упаковку.':'')+(source==='split'?'\nСтоимость поездок не включена.':'');
  const prefix=source==='split'?'basketsplit:':'basketshop:'+source+':',nav=[];if(start)nav.push(button('⬅️',prefix+(start-5)));if(shop.items.length>start+5)nav.push(button('➡️',prefix+(start+5)));if(nav.length)rows.push(nav);
  return this.panel(text,[...rows,[button('⬅️ Сравнение','basketcompare'),button('🛒 Корзина','basket')]]);
 }
 async watches(offset=0){
  const all=await this.store.watches(this.uid),start=Math.min(offset,Math.floor(Math.max(0,all.length-1)/5)*5),shown=all.slice(start,start+5),names=await this.names(shown),buttons=shown.map((r,i)=>[button('✖ Убрать '+(start+i+1),'remove:'+r.product)]),nav=[];
  if(start)nav.push(button('⬅️','watches:'+(start-5)));if(all.length>start+5)nav.push(button('➡️','watches:'+(start+5)));if(nav.length)buttons.push(nav);
  return this.panel('<b>Отслеживаемые товары</b>\n\n'+(shown.length?shown.map((r,i)=>`${start+i+1}. ${safe(briefName(names.get(r.name)||bilingual(null,r.name)))}`).join('\n\n'):'Откройте товар → «Следить».'),[...buttons,[button('⬅️ Уведомления','notifications')]]);
 }
 async notifications(){const rows=await this.store.watches(this.uid);return this.panel('<b>Снижение цены</b>\n\n'+(this.user.enabled?'<b>Статус:</b> включены':'<b>Статус:</b> выключены')+`\n<b>Товары:</b> ${rows.length}\n\n`+(rows.length?'Сообщим о снижении цены.':'Откройте товар → «Следить».'),[[button(this.user.enabled?'🔕 Выключить уведомления':'🔔 Включить уведомления',this.user.enabled?'notify:off':'notify:on')],[button('📋 Отслеживаемые товары','watches')],...BACK]);}
 async help(){
  return this.panel('<b>Как пользоваться</b>\n\n<b>Поиск:</b> название → магазин → товар\n<b>Корзина:</b> список → сравнение цен\n<b>Уведомления:</b> снижение цены выбранного товара\n\nСписок — через запятую или с новой строки.',[[{text:'💬 Поддержка',url:'https://t.me/AngryVirus'}],[button('ℹ️ О ценах и данных','help:data')],...BACK]);
 }
 async dataHelp(){const sources=(await this.store.sources()).filter(s=>s.active);return this.panel('<b>О ценах и данных</b>\n\nПрайсы магазинов: '+sources.map(s=>`<a href="${safe(s.url)}">${safe(s.name)}</a>`).join(', ')+'.\n\nДата цен — в карточке. Наличие и цены филиалов могут отличаться.\n\nРусские названия переведены автоматически. Сербский оригинал сохранён. Для перевода передаётся только публичное название товара.\n\n/delete — удалить свою корзину и настройки.',[[button('⬅️ Помощь','help')]],false);}
 async handle(update){
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
   this.user=await this.store.ensure(uid);await trackUser(this.store,cb?.from||msg.from);this.user=await this.store.user(uid);
   await deliverNotice(this.store,this.api,this.InputFile,'ban',uid,true,key);await deliverNotice(this.store,this.api,this.InputFile,'role',uid,true,key);
   this.freshPanel=!cb;
   if(cb){this.user.panel=msg.message_id;if(Array.isArray(msg.photo))this.user.photo=true;else if(typeof msg.text==='string')this.user.photo=false;}
   return await this.dispatch(update);
  }finally{await unlockUser(this.store,uid,key);await this.db.run('DELETE FROM sd_updates WHERE expires<:now',{':now':now});}
 }
 async dispatch(update){
  const cb=update.callback_query,msg=cb?.message||update.message,uid=this.uid;
  const action=cb?.data||'',text=update.message?.text?.trim();
  if(action==='home'||['/start','/menu','/cancel'].includes(text)){await this.store.patch(uid,{pending:null,cartTarget:null,adminInput:null,adminDraft:null,refinement:null});return this.home();}
  if(await adminRoute(this,action,text))return;
  if(action&&!action.startsWith('admin'))await this.store.patch(uid,{adminInput:null,adminDraft:null,pending:null});
  if(action.startsWith('ref:')){
   const draft=this.user.refinement,parts=action.split(':'),token=parts[1];
   if(!draft||draft.token!==token||draft.expires<Date.now())return this.panel('<b>Уточнения уже изменились</b>\nОткройте поиск заново.',[[button('🔎 Поиск','search')]]);
   if(parts.length===3&&['apply','all'].includes(parts[2])){const filters=parts[2]==='all'?{}:refinementFilters(draft);await this.store.patch(uid,{refinement:null,searchFilters:filters});this.user={...this.user,refinement:null,searchFilters:filters};this.allowAll=true;return this.search(draft.query);}
   if(parts.length===3&&parts[2]==='back')return this.refine(draft);
   const facet=draft.facets.find(f=>f.key===parts[2]),value=parts[3];if(!facet||parts.length!==4)return this.refine(draft);
   if(value==='open'){
    const wait=await this.store.rate(uid);if(wait)return this.panel(`<b>Небольшая пауза</b>\nПовторите через ${wait} сек.`,[[button('⬅️ К уточнениям',`ref:${draft.token}:back`)]]);
    try{const filters=refinementFilters(draft);delete filters[facet.key];const samples=await this.store.refinementSamples(draft.query,Date.now(),filters),available=buildRefinement(draft.query,samples.map(r=>JSON.parse(r.payload)),draft.token,Date.now(),true),next=available?.facets.find(f=>f.key===facet.key),previous=facet.values[draft.selected[facet.key]]?.value;facet.values=next?.values||[];const index=facet.values.findIndex(v=>JSON.stringify(v.value)===JSON.stringify(previous));if(index<0)delete draft.selected[facet.key];else draft.selected[facet.key]=index;draft.token=Math.random().toString(36).slice(2,10);await this.store.patch(uid,{refinement:draft});}catch{/* Existing validated choices remain usable if a refresh fails. */}
    return this.refine(draft,facet.key);
   }
   if(/^page[0-3]$/.test(value))return this.refine(draft,facet.key,Number(value.slice(4)));
   if(value==='any')delete draft.selected[facet.key];else if(/^\d{1,2}$/.test(value)&&facet.values[Number(value)])draft.selected[facet.key]=Number(value);else return this.refine(draft);
   if(['brand','type'].includes(facet.key)){delete draft.selected.pack;delete draft.selected.fat;delete draft.selected.socket;}await this.store.patch(uid,{refinement:draft});return this.refine(draft);
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
  if(action==='basketinput'){await this.store.patch(uid,{pending:'basket',cartTarget:null});return this.panel('<b>Добавьте список покупок</b>\n\nТовары — с новой строки или через запятую. Количество — после ×.\n\nМолоко 1 л × 2\nКофе\nОгурцы\n\nДо 20 товаров за раз, 30 в корзине.',BACK);}
  if(action==='basketcompare')return this.comparison();
  if(/^basketshop:[a-f0-9]{24}:(0|5|10|15|20|25)$/.test(action)){const [,source,offset]=action.split(':');return this.comparison(source,Number(offset));}
  if(/^basketsplit:(0|5|10|15|20|25)$/.test(action))return this.comparison('split',Number(action.split(':')[1]));
  if(/^resolve:[a-z0-9-]{1,20}$/.test(action)){const item=(await cartItems(this.store,uid)).find(x=>x.id===action.slice(8)&&!x.product);if(item){if(await expandPendingList(this.store,uid,item.id))return this.basket();await this.store.patch(uid,{cartTarget:item.id});this.user.cartTarget=item.id;return this.search(item.query);}return this.basket();}
  if(/^basketadd:[a-f0-9]{32}:[a-z0-9-]{0,20}$/.test(action)){const [,id,target]=action.split(':'),found=await this.store.offer(id);if(found){try{const added=await addOffer(this.store,uid,JSON.parse(found.payload),target||null);if(!added){await this.store.patch(uid,{cartTarget:null});return this.panel('<b>Позиция корзины уже изменилась</b>\n\nЭта кнопка выбора устарела. Откройте корзину и выберите актуальную позицию.',[[button('🛒 Открыть корзину','basket')],...BACK]);}}catch(error){return this.panel(safe(error.message),[[button('🛒 Корзина','basket')],...BACK]);}}await this.store.patch(uid,{cartTarget:null});return this.basket();}
  if(/^cartremove:[a-z0-9-]{1,40}$/.test(action)){await cartItems(this.store,uid);await this.db.run('DELETE FROM sd_basket WHERE uid=:uid AND id=:id',{':uid':uid,':id':action.slice(11)});return this.basket();}
  if(/^quantity:[a-z0-9-]{1,40}:-?1$/.test(action)){const [,id,delta]=action.split(':');await this.db.run('UPDATE sd_basket SET quantity=MIN(99,MAX(1,quantity+:delta)) WHERE uid=:uid AND id=:id',{':uid':uid,':id':id,':delta':Number(delta)});return this.basketItem(id);}
  if(action==='help:data')return this.dataHelp();
  if(action==='help'||text==='/help')return this.help();
  if(text==='/delete')return this.panel('<b>Удалить данные?</b>\n\nУдалим ваш список и настройки, отключим уведомления.',[[button('Удалить мои данные','delete:confirm')],...BACK]);
  if(action==='delete:confirm'){await cartItems(this.store,uid);await this.db.run('DELETE FROM sd_basket WHERE uid=:uid',{':uid':uid});await this.store.deleteUser(uid);return this.api.sendMessage({chat_id:uid,text:'Ваши данные удалены. /start — начать заново.'});}
  if(action==='watches')return this.watches();
  if(/^watches:\d{1,2}$/.test(action))return this.watches(Math.min(90,Number(action.slice(8))));
  if(action==='notifications')return this.notifications();
  if(/^notify:(on|off)$/.test(action)){await this.db.run('UPDATE sd_users SET enabled=:on,blocked=0 WHERE id=:uid',{':on':action==='notify:on'?1:0,':uid':uid});this.user=await this.store.user(uid);return this.notifications();}
  if(/^socket:(E27|E14|GU10|all)$/.test(action)&&this.user.query){const socket=action.split(':')[1];this.allowAll=true;return this.search(this.user.query+(socket==='all'?'':' '+socket));}
  if(/^page:[a-z0-9]{7}:\d{1,4}$/.test(action)){const [,rev,offset]=action.split(':');if(rev===this.user.searchRev&&Number(offset)<=1000){this.allowAll=true;return this.search(this.user.query,Number(offset),this.user.searchSource||null);}return this.panel('<b>Поиск уже изменился</b>\n\nОткройте текущие результаты.',[[button('К результатам','results')],...BACK]);}
  if((action==='chains'||/^chains:[a-z0-9]{7}:\d{1,3}$/.test(action))&&this.user.query){const [,rev,offset]=action.split(':');if(!rev||rev===this.user.searchRev){this.allowAll=true;return this.search(this.user.query,Number(offset)||0,null);}return this.panel('<b>Поиск уже изменился</b>',[[button('К результатам','results')],...BACK]);}
  if(/^chainsel:[a-z0-9]{7}:[a-f0-9]{24}:\d{1,4}$/.test(action)&&this.user.query){const [,rev,source,offset]=action.split(':');if(rev===this.user.searchRev&&Number(offset)<=1000){this.allowAll=true;return this.search(this.user.query,Number(offset),source);}return this.panel('<b>Поиск уже изменился</b>',[[button('К результатам','results')],...BACK]);}
  if(action==='results'&&this.user.query){this.allowAll=true;return this.search(this.user.query,this.user.offset||0,this.user.searchSource||null);}
  if(/^locations:[a-f0-9]{32}$/.test(action))return this.locations(action.slice(10));
  if(/^offer:[a-f0-9]{32}$/.test(action))return this.card(action.slice(6));
  if(/^watch:[a-f0-9]{32}$/.test(action)){const added=await this.store.watch(uid,action.slice(6));return this.panel(added?'<b>Товар отслеживается</b>\n\n'+(this.user.enabled?'Сообщим о снижении цены.':'Включите уведомления, чтобы получать сообщения.'):'<b>Предложение обновилось</b>\n\nПовторите поиск.',[[button(this.user.enabled?'🔔 Уведомления':'🔔 Включить уведомления',this.user.enabled?'notifications':'notify:on')],[button('⬅️ К товару','offer:'+action.slice(6))],...BACK]);}
  if(/^remove:(?:gtin:\d{14}|local:[a-f0-9]{32})$/.test(action)){await this.store.removeWatch(uid,action.slice(7));return this.watches();}
  if(text&&!text.startsWith('/')){if(this.user.pending==='basket'){try{await addList(this.store,uid,text,msg.message_id);}catch(error){return this.panel(safe(error.message),[[button('🛒 Корзина','basket')],...BACK]);}await this.store.patch(uid,{pending:null});try{await this.api.deleteMessage({chat_id:uid,message_id:msg.message_id});}catch{}return this.basket();}await this.store.patch(uid,{pending:null});const result=await this.search(text);try{await this.api.deleteMessage({chat_id:uid,message_id:msg.message_id});}catch{}return result;}
  return this.home();
 }
}
