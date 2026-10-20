import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback} from './fixtures.js';
import {addList,addOffer,cartItems} from '../tgcloud/lib/basket.js';
import {Bot} from '../tgcloud/lib/bot.js';
async function fill(f,count){for(let i=0;i<count;i++)await addList(f.store,5,'Товар '+i,1000+i);}

test('stale selection cannot overwrite a confirmed product or another user basket',async()=>{
 const f=await fixture();await addList(f.store,5,'молоко × 3',123);const id=(await cartItems(f.store,5))[0].id,first=offer(),other=offer(2,{product:'gtin:00000000000002',name:'Different product'});
 assert.equal(await addOffer(f.store,6,other,id),false);assert.equal(await addOffer(f.store,5,first,id),true);assert.equal(await addOffer(f.store,5,other,id),false);const saved=(await cartItems(f.store,5))[0];assert.equal(saved.product,first.product);assert.equal(saved.quantity,3);assert.equal(saved.name,first.name);
});
test('stale Telegram selection displays a useful message and preserves the confirmed product',async()=>{
 const f=await fixture(),a=offer(),b=offer(2,{product:'gtin:00000000000002'});await publish(f,[a,b]);await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'лампочка E27',321);const id=(await cartItems(f.store,5))[0].id;await new Bot(f).handle(callback(5,'basketadd:'+a.id+':'+id));await new Bot(f).handle(callback(5,'basketadd:'+b.id+':'+id));assert.equal((await cartItems(f.store,5))[0].product,a.product);assert(f.sent.at(-1).text.includes('устарела'));assert(f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='basket'));
});
test('a deleted basket position is never recreated by its old selection button',async()=>{
 const f=await fixture();await addList(f.store,5,'молоко',123);const id=(await cartItems(f.store,5))[0].id;await f.db.run('DELETE FROM sd_basket WHERE uid=5');assert.equal(await addOffer(f.store,5,offer(),id),false);assert.equal((await cartItems(f.store,5)).length,0);
});
test('replayed list at capacity remains idempotent and a new list fails atomically',async()=>{
 const f=await fixture();await fill(f,28);await addList(f.store,5,'огурцы, курица × 2',999);await addList(f.store,5,'огурцы, курица × 2',999);assert.equal((await cartItems(f.store,5)).length,30);await assert.rejects(addList(f.store,5,'сыр, кофе',998),/до 30/);assert.equal((await cartItems(f.store,5)).length,30);assert.equal((await f.db.get('SELECT COUNT(*) n FROM sd_basket WHERE id LIKE :prefix',{':prefix':'998-%'})).n,0);
});
test('parallel bulk additions cannot exceed basket capacity or insert a partial list',async()=>{
 const f=await fixture();await fill(f,28);const results=await Promise.allSettled([addList(f.store,5,'огурцы, курица',900),addList(f.store,5,'сыр, кофе',901)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.db.get('SELECT COUNT(*) n FROM sd_basket WHERE uid=5')).n,30);const inserted=await f.db.all("SELECT substr(id,1,3) event,COUNT(*) n FROM sd_basket WHERE id LIKE '900-%' OR id LIKE '901-%' GROUP BY event");assert.equal(inserted.length,1);assert.equal(inserted[0].n,2);
});
test('parallel individual and bulk additions obey a shared capacity; duplicate offer remains harmless',async()=>{
 const f=await fixture();await fill(f,29);const a=offer(),b=offer(2);const results=await Promise.allSettled([addOffer(f.store,5,a),addList(f.store,5,'сыр',901),addOffer(f.store,5,b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.db.get('SELECT COUNT(*) n FROM sd_basket WHERE uid=5')).n,30);
 const g=await fixture();await fill(g,29);await addOffer(g.store,5,a);assert.equal(await addOffer(g.store,5,a),true);await assert.rejects(addOffer(g.store,5,b),/до 30/);assert.equal((await cartItems(g.store,5)).length,30);
});
test('search distinguishes unavailable fresh prices from an unmatched query',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'огурцы'));assert(f.sent.at(-1).text.includes('Свежие цены пока недоступны'));assert(!f.sent.at(-1).text.includes('Попробуйте другое название'));
 await publish(f,[offer()]);await new Bot(f).handle(message(5,'огурцы'));assert(f.sent.at(-1).text.includes('Предложений пока нет'));assert(f.sent.at(-1).text.includes('1 сетей'));
});
test('basket and help explain comma input and immediate estimated comparison without adding menu choices',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));assert.equal(f.sent.at(-1).reply_markup.inline_keyboard.flat().length,4);await new Bot(f).handle(callback(5,'basket'));assert(f.sent.at(-1).text.includes('Сразу нажмите'));assert(f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.text.includes('Найти выгодную корзину')));await new Bot(f).handle(callback(5,'help'));assert(f.sent.at(-1).text.includes('через запятую'));
});
test('common Russian shopping phrases translate as product types and keep packaging constraints',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Maslac 200g',terms:['maslac','200g']}),offer(2,{name:'Ulje maslinovo 1l',terms:['ulje','maslinovo','1l']}),offer(3,{name:'Ulje suncokretovo 1l',terms:['ulje','suncokretovo','1l']}),offer(4,{name:'Motorno ulje',terms:['motorno','ulje'],regular:1}),offer(5,{name:'Pasta za zube',terms:['pasta','za','zube']}),offer(6,{name:'Hrana za macke',terms:['hrana','za','macke']}),offer(7,{name:'Mineralna voda gazirana',terms:['mineralna','voda','gazirana']}),offer(8,{name:'Vlazne maramice',terms:['vlazne','maramice']})]);
 for(const q of ['сливочное масло','масло сливочное','сливочное масло 200g','оливковое масло','масло оливковое','подсолнечное масло','зубная паста','корм для кошек','минеральная вода','влажные салфетки']){const rows=await f.store.search(q);assert.equal(rows.length,1,q);assert(!JSON.parse(rows[0].payload).name.includes('Motorno'));}assert.equal((await f.store.search('сливочное масло 500g')).length,0);
});
test('Serbian fresh produce and meat queries apply the same exclusions as Russian while preserving explicit processed intent',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Krastavac',terms:['krastavac']}),offer(2,{name:'Pavlaka krastavac',terms:['pavlaka','krastavac'],regular:1}),offer(3,{name:'Kiseli krastavac',terms:['kiseli','krastavac'],regular:1}),offer(4,{name:'Piletina file',terms:['piletina','file']}),offer(5,{name:'Pasteta piletina',terms:['pasteta','piletina'],regular:1})]);
 for(const q of ['krastavac','краставац','piletina','пилетина'])assert.equal((await f.store.search(q)).length,1,q);assert.equal((await f.store.search('kiseli krastavac')).length,1);assert.equal((await f.store.search('pasteta piletina')).length,1);
});
test('olive oil search excludes crackers, canned fish and cosmetics; chicken excludes pet and baby food',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Ulje maslinovo 1l',terms:['ulje','maslinovo','1l'],regular:10000}),offer(2,{name:'Grisini sa maslinovim uljem',terms:['grisini','sa','maslinovim','uljem'],regular:1}),offer(3,{name:'Tuna masline ulje',terms:['tuna','masline','ulje'],regular:1}),offer(4,{name:'Sapun maslinovo ulje',terms:['sapun','maslinovo','ulje'],regular:1}),offer(5,{name:'Moksi vl.hra.za mac.piletina 400g',terms:['moksi','vl','hra','za','mac','piletina','400g'],regular:1}),offer(6,{name:'Nutrino povrce piletina',terms:['nutrino','povrce','piletina'],regular:1}),offer(7,{name:'Kasica Hipp piletina pirinac',terms:['kasica','hipp','piletina','pirinac'],regular:1}),offer(8,{name:'Piletina file 500g',terms:['piletina','file','500g'],regular:10000})]);
 for(const q of ['оливковое масло','ulje maslinovo']){const rows=await f.store.search(q);assert.equal(rows.length,1,q);assert.equal(JSON.parse(rows[0].payload).name,'Ulje maslinovo 1l');}for(const q of ['курица','piletina']){const rows=await f.store.search(q);assert.equal(rows.length,1,q);assert.equal(JSON.parse(rows[0].payload).name,'Piletina file 500g');}
});
test('Serbian chicken inflections find the same raw cuts as Russian without suggesting cooked snack packs',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Pileci file 500g',terms:['pileci','file','500g']}),offer(2,{name:'Pileca krila',terms:['pileca','krila']}),offer(3,{name:'Grill piletina 80g',terms:['grill','piletina','80g'],regular:1})]);
 for(const q of ['курица','piletina','пилетина','pilece']){const rows=await f.store.search(q);assert.equal(rows.length,2,q);assert(!rows.some(r=>JSON.parse(r.payload).name.includes('Grill')));}assert.equal((await f.store.search('grill piletina')).length,1);
});
