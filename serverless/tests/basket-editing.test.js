import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback,source} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {addList,addOffer,cartItems,resetProduct,compareBasket,basketParts,expandPendingList} from '../tgcloud/lib/basket.js';

test('replacement keeps query and quantity; concurrent and stale buttons cannot reset or overwrite it',async()=>{
 const f=await fixture(),a=offer(),b=offer(2,{product:'local:'+'2'.repeat(32)});await publish(f,[a,b]);
 await addList(f.store,5,'лампочка × 3',900);await addOffer(f.store,5,a,'900-0');
 assert.equal(await resetProduct(f.store,6,'900-0'),null);
 const results=await Promise.all([resetProduct(f.store,5,'900-0'),resetProduct(f.store,5,'900-0')]);
 assert.equal(results.filter(Boolean).length,1);const next=results.find(Boolean);
 assert.match(next,/^r[a-f0-9]{16}$/);let saved=(await cartItems(f.store,5))[0];
 assert.equal(saved.quantity,3);assert.equal(saved.query,'лампочка');assert.equal(saved.product,null);
 assert.equal(await addOffer(f.store,5,a,'900-0'),false);
 assert.equal(await addOffer(f.store,5,b,next),true);
 assert.equal(await resetProduct(f.store,5,'900-0'),null);
 assert.equal(await addOffer(f.store,5,a,next),false);
 saved=(await cartItems(f.store,5))[0];assert.equal(saved.product,b.product);assert.equal(saved.quantity,3);
});
test('changing a catalogue SKU preserves commas and trailing quantity-like title text as one item',async()=>{
 for(const name of ['LED sijalica E27 9W, 806lm','LED sijalica E27 9W × 2']){
  const f=await fixture(),a=offer(1,{name,terms:['led','sijalica','e27','9w','806lm','2']});await publish(f,[a]);await new Bot(f).handle(message(5,'/start'));await addOffer(f.store,5,a);let item=(await cartItems(f.store,5))[0];await f.db.run('UPDATE sd_basket SET quantity=3 WHERE uid=5');
  await new Bot(f).handle(callback(5,'cartchange:'+item.id));item=(await cartItems(f.store,5))[0];assert.deepEqual(basketParts(item),[{query:name,quantity:1}]);assert.equal(await expandPendingList(f.store,5,item.id),false);
  const report=await compareBasket(f.store,5);assert.equal(report.items.length,1,name);assert.equal(report.items[0].query,name);assert.equal(report.items[0].quantity,3);assert.equal(report.split.total,3*a.regular);assert(!f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.text==='Разделить список на товары'));
  await new Bot(f).handle(callback(5,'resolve:'+item.id));assert.equal((await f.store.user(5)).cartTarget,item.id);assert.equal((await cartItems(f.store,5)).length,1);assert.equal((await cartItems(f.store,5))[0].quantity,3);
 }
});
test('genuine legacy combined rows still split and retain their requested quantities',async()=>{
 const f=await fixture();await cartItems(f.store,5);await f.db.run("INSERT INTO sd_basket(uid,id,query,quantity) VALUES(5,'legacy','огурцы, курица × 2',3)");const legacy=(await cartItems(f.store,5))[0];assert.deepEqual(basketParts(legacy),[{query:'огурцы',quantity:1},{query:'курица',quantity:2}]);assert.equal(await expandPendingList(f.store,5,legacy.id),true);const rows=await cartItems(f.store,5);assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>[x.query,x.quantity]),[['огурцы',3],['курица',6]]);
});
test('a directly added product can be changed through the bot without deleting its basket position',async()=>{
 const f=await fixture(),a=offer();await publish(f,[a]);await new Bot(f).handle(message(5,'/start'));await addOffer(f.store,5,a);
 const id=(await cartItems(f.store,5))[0].id;assert.equal(id.length,33);
 await new Bot(f).handle(callback(5,'cartitem:'+id));
 const change=f.sent.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.callback_data.startsWith('cartchange:'));assert(change);
 await new Bot(f).handle(callback(6,change.callback_data));assert.equal((await cartItems(f.store,5))[0].product,a.product);
 await new Bot(f).handle(callback(5,change.callback_data));
 const saved=(await cartItems(f.store,5))[0];assert.notEqual(saved.id,id);assert.equal(saved.query,a.name);assert.equal(saved.product,null);
 const resolve=f.sent.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.callback_data==='resolve:'+saved.id);assert(resolve);
 await new Bot(f).handle(callback(5,resolve.callback_data));assert.equal((await f.store.user(5)).cartTarget,saved.id);
 await new Bot(f).handle(callback(5,'basketadd:'+a.id+':'+saved.id));assert.equal((await cartItems(f.store,5))[0].product,a.product);
 await new Bot(f).handle(callback(5,change.callback_data));assert.equal((await cartItems(f.store,5))[0].product,a.product);
});
test('partial basket names missing positions and complete estimates use from on the split button',async()=>{
 const f=await fixture();await publish(f,[offer()]);await new Bot(f).handle(message(5,'/start'));
 await addList(f.store,5,'лампочка, <нет товара>',900);
 await new Bot(f).handle(callback(5,'basketshop:'+source+':0'));
 const panel=f.sent.at(-1);assert(panel.text.includes('Рассчитано 1 из 2 товаров'));assert(panel.text.includes('Не найдено или нужно уточнить: &lt;нет товара&gt;'));
 await f.db.run('DELETE FROM sd_basket WHERE uid=5 AND id=:id',{':id':'900-1'});
 await new Bot(f).handle(callback(5,'basketcompare'));
 let split=f.sent.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.callback_data==='basketsplit:0');assert(split.text.includes('· от '));
 await addOffer(f.store,5,offer(),'900-0');await new Bot(f).handle(callback(5,'basketcompare'));
 split=f.sent.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.callback_data==='basketsplit:0');assert(!split.text.includes('от '));
});
