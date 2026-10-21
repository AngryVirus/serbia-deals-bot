import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,message,callback,offer,publish} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {addList,cartItems} from '../tgcloud/lib/basket.js';
import {renderImage} from '../tgcloud/lib/image-renderer.js';
const buttons=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat();
test('empty cart offers adding items without an unusable compare button',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(callback(5,'basket'));assert(f.sent.at(-1).text.includes('пока пуста'));assert(buttons(f).some(b=>b.callback_data==='basketinput'));assert(!buttons(f).some(b=>b.callback_data==='basketcompare'));
});
test('cart item editor preserves context, isolates users and shows current quantity',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'огурцы, курица × 2',900);const item=(await cartItems(f.store,5))[1];await new Bot(f).handle(callback(5,'basket'));assert.equal(buttons(f).filter(b=>b.callback_data.startsWith('cartitem:')).length,2);assert(!buttons(f).some(b=>b.callback_data.startsWith('quantity:')));
 await new Bot(f).handle(callback(5,'cartitem:'+item.id));assert(f.sent.at(-1).text.includes('Количество:</b> 2'));await new Bot(f).handle(callback(5,'quantity:'+item.id+':1'));assert(f.sent.at(-1).text.includes('Количество:</b> 3'));assert(buttons(f).some(b=>b.callback_data==='basket:0'));
 await new Bot(f).handle(callback(6,'cartitem:'+item.id));assert(f.sent.at(-1).text.includes('пока пуста'));assert.equal((await cartItems(f.store,5))[1].quantity,3);
});
test('cart pagination clamps a deleted last page and keeps five visible items',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'а, б, в, г, д, е',901);await new Bot(f).handle(callback(5,'basket:5'));assert(f.sent.at(-1).text.includes('Страница 2 из 2'));const last=(await cartItems(f.store,5))[5];await new Bot(f).handle(callback(5,'cartremove:'+last.id));await new Bot(f).handle(callback(5,'basket:5'));assert(!f.sent.at(-1).text.includes('Страница 2'));assert.equal(buttons(f).filter(b=>b.callback_data.startsWith('cartitem:')).length,5);
});
test('notifications show one action matching the actual setting and tracked count',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(callback(5,'notifications'));assert.equal(buttons(f).filter(b=>b.callback_data.startsWith('notify:')).length,1);assert(buttons(f).some(b=>b.callback_data==='notify:on'));await new Bot(f).handle(callback(5,'notify:on'));assert(f.sent.at(-1).text.includes('включены'));assert(buttons(f).some(b=>b.callback_data==='notify:off'));
});
test('network overview renders a compact image and retains basket selection navigation',async()=>{
 const f=await fixture();await publish(f,[offer()]);await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'лампочка E27',902);const item=(await cartItems(f.store,5))[0];await new Bot(f).handle(callback(5,'resolve:'+item.id));assert(buttons(f).some(b=>b.callback_data==='basket'));const image=renderImage(f.sent.at(-1).text);assert(image.height<1700);assert(image.bytes.length>1000);
 const chain=buttons(f).find(b=>b.callback_data.startsWith('chainsel:'));await new Bot(f).handle(callback(5,chain.callback_data));assert(buttons(f).some(b=>b.callback_data==='basket'));await new Bot(f).handle(callback(5,'offer:'+offer().id));assert(buttons(f).some(b=>b.text==='✅ Выбрать для корзины'));
});
test('returning to basket cancels text entry so a later search is not added accidentally',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(callback(5,'basketinput'));await new Bot(f).handle(callback(5,'basket'));assert.equal((await f.store.user(5)).pending??null,null);await new Bot(f).handle(message(5,'огурцы'));assert.equal((await cartItems(f.store,5)).length,0);
});

test('novice basket entry has a direct return and never leaves pending input after returning',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));assert.equal(buttons(f).length,4);
 await new Bot(f).handle(callback(5,'basket'));await new Bot(f).handle(callback(5,'basketinput'));
 assert(buttons(f).some(b=>b.callback_data==='basket'));assert(buttons(f).some(b=>b.callback_data==='home'));
 await new Bot(f).handle(message(5,'огурцы, молоко × 2'));assert.equal((await cartItems(f.store,5)).length,2);
 assert(buttons(f).some(b=>b.text.includes('Сравнить цены')));assert(buttons(f).some(b=>b.text.includes('огурцы')));
 await new Bot(f).handle(callback(5,'basketinput'));await new Bot(f).handle(callback(5,'basket'));assert.equal((await f.store.user(5)).pending??null,null);
});
test('results distinguish opening a card from confirming a basket addition and acknowledge success',async()=>{
 const f=await fixture();await publish(f,[offer()]);await new Bot(f).handle(message(5,'/start'));
 const b=new Bot(f);b.uid=5;b.user=await f.store.user(5);b.allowAll=true;await b.search('лампочка E27',0,offer().source);
 const open=buttons(f).find(b=>b.callback_data==='offer:'+offer().id);assert(open.text.endsWith('Открыть'));
 await new Bot(f).handle(callback(5,open.callback_data));assert(f.sent.at(-1).text.startsWith('<b>Карточка товара</b>'));assert(f.sent.at(-1).text.includes(offer().name));
 await new Bot(f).handle(callback(5,'basketadd:'+offer().id+':'));assert(f.sent.at(-1).text.includes('Товар сохранён в корзине'));assert.equal((await cartItems(f.store,5)).length,1);
 await new Bot(f).handle(callback(5,'basket'));assert(!f.sent.at(-1).text.includes('Товар сохранён в корзине'));
});
test('expired product never gives a false confirmation or changes the basket',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(callback(5,'basketadd:'+offer().id+':'));
 assert(f.sent.at(-1).text.includes('Товар не добавлен'));assert(!f.sent.at(-1).text.includes('Товар сохранён'));assert.equal((await cartItems(f.store,5)).length,0);assert(buttons(f).some(b=>b.callback_data==='results'));
});
test('empty notifications guide users to finding a product instead of an empty watch list',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(callback(5,'notifications'));
 assert(!buttons(f).some(b=>b.callback_data==='watches'));assert(buttons(f).some(b=>b.callback_data==='search'));assert(f.sent.at(-1).text.includes('Следить за ценой'));
});
test('working screens preserve readable content with a shorter header; hero and default exports stay unchanged',()=>{
 const text='<b>Выберите магазин</b>\nПоиск: молоко\n\nНайдено сетей: 8',full=renderImage(text),compact=renderImage(text,{compact:true,format:'jpeg'});
 assert.equal(full.title,compact.title);assert.equal(compact.width,960);assert.equal(full.height-compact.height,98);assert(compact.height>=360);assert.deepEqual([...compact.bytes.slice(0,2)],[255,216]);
});
