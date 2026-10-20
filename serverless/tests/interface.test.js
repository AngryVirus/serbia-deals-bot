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
