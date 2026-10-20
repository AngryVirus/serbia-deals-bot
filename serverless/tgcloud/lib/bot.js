import { Store } from './store.js';
import { OWNER_ID,assertBot,positive,safe,money,bulbQuery,currentPrice,day } from './domain.js';
import { renderImage } from './image-renderer.js';
import { cartItems,addList,addOffer,compareBasket,basketReport } from './basket.js';
const button=(text,data)=>({text,callback_data:data});
const BACK=[[button('🏠 Меню','home')]];
export class Bot{
 constructor(deps){Object.assign(this,deps);this.store=new Store(deps.db);}
 async panel(text,rows=BACK,visual=true){
  const markup={inline_keyboard:rows};let message;
  if(visual&&this.InputFile){
   const image=renderImage(text),photo=new this.InputFile(image.bytes,'serbia-deals.png',{type:'image/png'});
   if(this.user.panel)try{message=await this.api.editMessageMedia({chat_id:this.uid,message_id:this.user.panel,media:{type:'photo',media:photo,caption:''},reply_markup:markup});}catch(e){if(/message is not modified/i.test(e.description||e.message||''))return;if((e.code||e.error_code)!==400)throw e;}
   if(!message)message=await this.api.sendPhoto({chat_id:this.uid,photo,reply_markup:markup});
  }else{
   const params={chat_id:this.uid,text,parse_mode:'HTML',reply_markup:markup,link_preview_options:{is_disabled:true}};
   if(this.user.panel&&!this.user.photo)try{message=await this.api.editMessageText({...params,message_id:this.user.panel});}catch(e){if(/message is not modified/i.test(e.description||e.message||''))return;if((e.code||e.error_code)!==400)throw e;}
   if(!message)message=await this.api.sendMessage(params);
  }
  if(!positive(message?.message_id))throw Error('Unconfirmed panel');
  if(this.user.panel&&this.user.panel!==message.message_id)try{await this.api.deleteMessage({chat_id:this.uid,message_id:this.user.panel});}catch{/* Old panels are harmless; all actions are validated again. */}
  await this.store.patch(this.uid,{panel:message.message_id,photo:visual&&Boolean(this.InputFile)});
  this.user={...this.user,panel:message.message_id,photo:visual&&Boolean(this.InputFile)};
 }
 async home(){const rows=[[button('🔎 Найти товар','search'),button('🛒 Моя корзина','basket')],[button('🔔 Уведомления','notifications'),button('❓ Помощь','help')]];if(this.uid===OWNER_ID)rows.push([button('⚙️ Админка','admin')]);return this.panel('<b>Где дешевле? Сербия</b>\n\nНайдите один товар или сравните целую корзину покупок.\n\nНапример: огурцы, энергетик Red Bull, лампочка E27.\n\nЦены из официальных прайсов. Магазин и дата указаны в карточке.',rows);}
 async prompt(){await this.store.patch(this.uid,{pending:'search'});return this.panel('<b>Найти товар</b>\n\nВведите название на русском или сербском либо штрихкод.\n\nДля лампочки можно сразу указать цоколь: лампочка E27.',BACK);}
 async search(query,offset=0){
  const wait=await this.store.rate(this.uid);if(wait)return this.panel(`<b>Небольшая пауза</b>\n\nПовторите поиск через ${wait} сек.`,BACK);
  try{
   if(bulbQuery(query)&&!/(?:e14|e27|gu10|g9|g4|h4|h7)/i.test(query)&&!this.allowAll){
    await this.store.patch(this.uid,{query,pending:null});return this.panel('<b>Какая лампочка нужна?</b>\n\nЦоколь помогает подобрать подходящие варианты. Остальные характеристики будут в названии и карточке.',[[button('E27','socket:E27'),button('E14','socket:E14'),button('GU10','socket:GU10')],[button('Показать все варианты','socket:all')],...BACK]);
   }
   const rows=await this.store.search(query,offset),rev=Math.random().toString(36).slice(2,9);
   await this.store.patch(this.uid,{query,offset,searchRev:rev,pending:null});this.user={...this.user,query,offset,searchRev:rev};
   if(!rows.length)return this.panel('<b>Предложений пока нет</b>\n\nПопробуйте другое название или меньше уточнений. В поиске участвуют только свежие проверенные прайсы.',[[button('🔎 Другой поиск','search')],...BACK]);
   const shown=rows.slice(0,5),buttons=shown.map((row,index)=>{const offer=JSON.parse(row.payload);return [button(`${offset+index+1}. ${money(row.price)} · ${offer.format}`.slice(0,60),'offer:'+offer.id)];});
   if(offset||rows.length>5){const nav=[];if(offset)nav.push(button('⬅️ Назад','page:'+rev+':'+Math.max(0,offset-5)));if(rows.length>5)nav.push(button('Далее ➡️','page:'+rev+':'+(offset+5)));buttons.push(nav);}
   buttons.push([button('🔎 Изменить поиск','search')],...BACK);
   const text=`<b>Поиск: ${safe(query)}</b>\n\nПодходящие варианты по возрастанию цены. Это могут быть разные модели и упаковки.\n\n`+shown.map((row,index)=>{const offer=JSON.parse(row.payload);return `<b>${offset+index+1}. ${safe(offer.name)}</b>\n${safe(offer.format)} · ${money(row.price)}\n`;}).join('\n');
   return this.panel(text,buttons,false);
  }catch(error){if(/Введите название/.test(error.message))return this.panel('<b>Уточните запрос</b>\n\nВведите название короче 120 символов.',BACK);throw error;}
 }
 async card(id){
  const row=await this.store.offer(id);if(!row)return this.panel('<b>Предложение обновилось</b>\n\nПовторите поиск, чтобы увидеть действующие цены.',[[button('🔎 Найти товар','search')],...BACK]);
  const o=JSON.parse(row.payload),best=await this.store.cheapest(o.product),traits=o.traits||{};
  const specs=[traits.socket&&'Цоколь: '+traits.socket,traits.lumens&&'Яркость: '+traits.lumens+' лм',traits.kelvin&&'Цвет света: '+traits.kelvin+' K',traits.pack&&'В упаковке: '+traits.pack+' шт.'].filter(Boolean).join('\n');
  const text=`<b>${safe(o.name)}</b>\n\n🏪 ${safe(o.format)}\n💰 <b>${money(row.price)}</b>\n`+(row.price<o.regular?`Обычная цена: ${money(o.regular)}\nСкидка до: ${safe(o.end||'дата не указана')}\n`:'')+(specs?'\n'+specs+'\n':'')+`\nПрайс: ${o.date}\nНаличие не подтверждено. Цена конкретного филиала может отличаться.\n`+(o.product.startsWith('gtin:')&&best?`\nЛучшее найденное предложение этого товара: ${money(best.price)} · ${safe(JSON.parse(best.payload).format)}\n`:'\nСопоставление с другими магазинами по штрихкоду не подтверждено.\n');
  return this.panel(text+`\nПолучено: ${day(row.downloaded)}`,[[button('🛒 В корзину','basketadd:'+o.id+':'+(this.user.cartTarget||''))],[button('🔔 Следить за ценой','watch:'+o.id)],[button('🔎 К результатам','results')],...BACK],false);
 }
 async basket(offset=0){const items=await cartItems(this.store,this.uid);const rows=items.slice(offset,offset+10).flatMap(item=>{const controls=[];if(!item.product)controls.push(button('Выбрать: '+item.query.slice(0,35),'resolve:'+item.id));controls.push(button('−','quantity:'+item.id+':-1'),button('＋','quantity:'+item.id+':1'),button('✖','cartremove:'+item.id));return [controls];});if(offset)rows.push([button('⬅️ Назад','basket:'+Math.max(0,offset-10))]);if(items.length>offset+10)rows.push([button('Далее ➡️','basket:'+(offset+10))]);rows.push([button('➕ Добавить список','basketinput')],[button('💰 Сравнить корзину','basketcompare')],...BACK);const text='<b>Моя корзина</b>\n\n'+(items.length?items.slice(offset,offset+10).map((x,i)=>`${offset+i+1}. ${safe((x.name||x.query).slice(0,65))} × ${x.quantity}${x.product?'':' — выберите товар'}`).join('\n'):'Отправьте список или добавьте товары из поиска.')+'\n\nКоличество указывается в упаковках или штуках. До 30 позиций.';return this.panel(text,rows);}
 async watches(offset=0){const rows=await this.store.watches(this.uid),shown=rows.slice(offset,offset+10);const buttons=shown.map((r,i)=>[button('Убрать '+(offset+i+1),'remove:'+r.product)]);if(offset)buttons.push([button('⬅️ Назад','watches:'+Math.max(0,offset-10))]);if(rows.length>offset+10)buttons.push([button('Далее ➡️','watches:'+(offset+10))]);return this.panel('<b>Мой список</b>\n\n'+(shown.length?shown.map((r,i)=>`${offset+i+1}. ${safe(r.name)}`).join('\n'):'Добавьте товар из его карточки кнопкой «Следить за ценой».'),[...buttons,...BACK]);}
 async notifications(){return this.panel('<b>Уведомления</b>\n\n'+(this.user.enabled?'Включены.':'Выключены.')+'\n\nСообщим, когда снизится цена товара из вашего списка. Первое добавление товара не рассылает старые предложения. Обновление зависит от публикации прайса магазином.',[[button('Включить','notify:on'),button('Выключить','notify:off')],[button('Мои отслеживаемые товары','watches')],...BACK]);}
 async help(){
  const sources=(await this.store.sources()).filter(s=>s.active);
  const credits=sources.map(s=>`<a href="${safe(s.url)}">${safe(s.name)}</a>`).join(', ');
  return this.panel('<b>Помощь</b>\n\nНапишите название товара: «огурцы», «энергетик Red Bull», «лампочка E27». Можно искать на русском, сербском или по штрихкоду.\n\nДля корзины отправьте список: один товар на строку. Затем выберите подходящую упаковку для каждой позиции.\n\nРазные упаковки и модели сравниваются отдельно. Цены конкретного филиала и наличие могут отличаться.\n\nДанные: официальные прайсы '+credits+'. Дата указана в карточке.\n\n/delete — удалить свои данные.',[[{text:'💬 Поддержка',url:'https://t.me/AngryVirus'}],...BACK],false);
 }
 async handle(update){
  await assertBot(this.api);
  const cb=update.callback_query,msg=cb?.message||update.message,uid=(cb?.from||msg?.from)?.id;
  if(!positive(uid)||!positive(msg?.message_id)||msg?.chat?.type!=='private'||msg.chat.id!==uid||(cb&&(typeof cb.id!=='string'||cb.id.length>128||cb.from.is_bot)))return;
  await this.store.init();if(await this.store.meta('active')!==true)return;
  if(cb)try{await this.api.answerCallbackQuery({callback_query_id:cb.id});}catch{/* No mutation depends on acknowledgement. */}
  const key=uid+':'+(cb?'c'+cb.id:'m'+msg.message_id),now=Date.now();
  const lock=await this.db.run(`INSERT INTO sd_locks(id,owner,expires) VALUES(:uid,:key,:expires) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE sd_locks.expires<=:now`,{':uid':uid,':key':key,':expires':now+60000,':now':now});
  if(lock.rowsAffected!==1)return;
  try{
   const claimed=await this.db.run('INSERT INTO sd_updates(id,expires) VALUES(:key,:expires) ON CONFLICT DO NOTHING',{':key':key,':expires':now+172800000});if(claimed.rowsAffected!==1)return;
   this.uid=uid;this.user=await this.store.ensure(uid);
   return await this.dispatch(update);
  }finally{await this.db.run('DELETE FROM sd_locks WHERE id=:uid AND owner=:key',{':uid':uid,':key':key});await this.db.run('DELETE FROM sd_updates WHERE expires<:now',{':now':now});}
 }
 async dispatch(update){
  const cb=update.callback_query,msg=cb?.message||update.message,uid=this.uid;
  const action=cb?.data||'',text=update.message?.text?.trim();
  if(action.startsWith('admin')&&uid!==OWNER_ID)return this.home();
  if(action==='admin'){const sources=await this.store.sources();return this.panel('<b>Состояние магазинов</b>\n\n'+(sources.map(s=>`${safe(s.name)}: ${safe(s.status)} · ${safe(s.date||'прайса нет')}`).join('\n')||'Сбор ещё не выполнен.'),[[button('🔄 Перечитать состояние','admin')],...BACK]);}
  if(action==='home'||text==='/start'||text==='/menu'){await this.store.patch(uid,{pending:null,cartTarget:null});return this.home();}
  if(action==='search'){await this.store.patch(uid,{cartTarget:null});return this.prompt();}
  if(action==='basket')return this.basket();
  if(/^basket:(0|10|20)$/.test(action))return this.basket(Number(action.slice(7)));
  if(action==='basketinput'){await this.store.patch(uid,{pending:'basket',cartTarget:null});return this.panel('<b>Добавьте список покупок</b>\n\nКаждый товар с новой строки. Количество — после ×.\n\nМолоко 1 л × 2\nЛампочка E27 × 3\nКофе × 1\n\nЗатем выберите конкретные товары для сравнения. За раз можно добавить до 20 позиций, в корзине — до 30.',BACK);}
  if(action==='basketcompare')return this.panel(basketReport(await compareBasket(this.store,uid)),[[button('🛒 К корзине','basket')],...BACK],false);
  if(/^resolve:[a-z0-9-]{1,20}$/.test(action)){const item=(await cartItems(this.store,uid)).find(x=>x.id===action.slice(8)&&!x.product);if(item){await this.store.patch(uid,{cartTarget:item.id});this.user.cartTarget=item.id;return this.search(item.query);}return this.basket();}
  if(/^basketadd:[a-f0-9]{32}:[a-z0-9-]{0,20}$/.test(action)){const [,id,target]=action.split(':'),found=await this.store.offer(id);if(found){try{await addOffer(this.store,uid,JSON.parse(found.payload),target||null);}catch(error){return this.panel(safe(error.message),[[button('🛒 Корзина','basket')],...BACK]);}}await this.store.patch(uid,{cartTarget:null});return this.basket();}
  if(/^cartremove:[a-z0-9-]{1,40}$/.test(action)){await cartItems(this.store,uid);await this.db.run('DELETE FROM sd_basket WHERE uid=:uid AND id=:id',{':uid':uid,':id':action.slice(11)});return this.basket();}
  if(/^quantity:[a-z0-9-]{1,40}:-?1$/.test(action)){const [,id,delta]=action.split(':');await this.db.run('UPDATE sd_basket SET quantity=MIN(99,MAX(1,quantity+:delta)) WHERE uid=:uid AND id=:id',{':uid':uid,':id':id,':delta':Number(delta)});return this.basket();}
  if(action==='help'||text==='/help')return this.help();
  if(text==='/delete')return this.panel('<b>Удалить данные?</b>\n\nУдалим ваш список и настройки, отключим уведомления.',[[button('Удалить мои данные','delete:confirm')],...BACK]);
  if(action==='delete:confirm'){await cartItems(this.store,uid);await this.db.run('DELETE FROM sd_basket WHERE uid=:uid',{':uid':uid});await this.store.deleteUser(uid);return this.api.sendMessage({chat_id:uid,text:'Ваши данные удалены. /start — начать заново.'});}
  if(action==='watches')return this.watches();
  if(/^watches:\d{1,2}$/.test(action))return this.watches(Math.min(90,Number(action.slice(8))));
  if(action==='notifications')return this.notifications();
  if(/^notify:(on|off)$/.test(action)){await this.db.run('UPDATE sd_users SET enabled=:on,blocked=0 WHERE id=:uid',{':on':action==='notify:on'?1:0,':uid':uid});this.user=await this.store.user(uid);return this.notifications();}
  if(/^socket:(E27|E14|GU10|all)$/.test(action)&&this.user.query){const socket=action.split(':')[1];this.allowAll=true;return this.search(this.user.query+(socket==='all'?'':' '+socket));}
  if(/^page:[a-z0-9]{7}:\d{1,4}$/.test(action)){const [,rev,offset]=action.split(':');if(rev===this.user.searchRev&&Number(offset)<=1000){this.allowAll=true;return this.search(this.user.query,Number(offset));}return this.panel('<b>Поиск уже изменился</b>\n\nОткройте текущие результаты.',[[button('К результатам','results')],...BACK]);}
  if(action==='results'&&this.user.query){this.allowAll=true;return this.search(this.user.query,this.user.offset||0);}
  if(/^offer:[a-f0-9]{32}$/.test(action))return this.card(action.slice(6));
  if(/^watch:[a-f0-9]{32}$/.test(action)){const added=await this.store.watch(uid,action.slice(6));return this.panel(added?'<b>Товар в вашем списке</b>\n\nУведомления можно включить отдельно.':'<b>Предложение обновилось</b>\n\nПовторите поиск.',[[button('🔔 Уведомления','notifications')],...BACK]);}
  if(/^remove:(?:gtin:\d{14}|local:[a-f0-9]{32})$/.test(action)){await this.store.removeWatch(uid,action.slice(7));return this.watches();}
  if(text&&!text.startsWith('/')){if(this.user.pending==='basket'){try{await addList(this.store,uid,text,msg.message_id);}catch(error){return this.panel(safe(error.message),[[button('🛒 Корзина','basket')],...BACK]);}await this.store.patch(uid,{pending:null});try{await this.api.deleteMessage({chat_id:uid,message_id:msg.message_id});}catch{}return this.basket();}await this.store.patch(uid,{pending:null});const result=await this.search(text);try{await this.api.deleteMessage({chat_id:uid,message_id:msg.message_id});}catch{}return result;}
  return this.home();
 }
}
