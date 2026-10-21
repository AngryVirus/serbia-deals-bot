import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback,source} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {Store} from '../tgcloud/lib/store.js';
import {addList,addOffer,cartItems,compareBasket,saveBasketFilters} from '../tgcloud/lib/basket.js';
const milk=(id,name,regular,terms)=>offer(id,{name,regular,terms,product:'local:'+String(id).padStart(32,'0')});
const goods=()=>[milk(1,'Mleko 1l',15000,['mleko','1l']),milk(2,'Kiselo mleko 180g',3000,['kiselo','mleko','180g']),milk(3,'Mleko 500ml',8000,['mleko','500ml'])];
const filters={type:['milkplain'],pack:{kind:'volume',amount:1000}};

test('saved basket choices persist through new Store instances and filter offers in every network',async()=>{
 const f=await fixture();await publish(f,goods());const other='c'.repeat(24);await publish(f,[{...goods()[0],id:'f'.repeat(32),source:other,regular:12000}],'d'.repeat(32));await addList(f.store,5,'молоко × 2',900);
 assert.equal(await saveBasketFilters(f.store,6,'900-0',filters),false);assert.equal(await saveBasketFilters(f.store,5,'900-0',filters),true);
 const store=new Store(f.db),report=await compareBasket(store,5);assert.equal(report.stores.length,2);assert(report.stores.every(s=>s.items[0].variant==='молоко · 1 л'));assert.deepEqual(report.stores.map(s=>s.total),[24000,30000]);assert.equal(report.pending.length,1);assert.equal((await cartItems(store,5))[0].quantity,2);
});
test('a changed constraint invalidates an in-flight product confirmation at the final atomic update',async()=>{
 const f=await fixture();await publish(f,goods());await addList(f.store,5,'молоко',900);await saveBasketFilters(f.store,5,'900-0',filters);
 const matches=f.store.matchesOffer.bind(f.store);f.store.matchesOffer=async(...args)=>{const ok=await matches(...args);await saveBasketFilters(f.store,5,'900-0',{pack:{kind:'volume',amount:500}});return ok;};
 assert.equal(await addOffer(f.store,5,goods()[0],'900-0'),false);assert.equal((await cartItems(f.store,5))[0].product,null);
});
test('stale offer buttons cannot bypass saved criteria and confirmed choices cannot be reconfigured',async()=>{
 const f=await fixture();await publish(f,goods());await addList(f.store,5,'молоко',900);await saveBasketFilters(f.store,5,'900-0',filters);
 assert.equal(await addOffer(f.store,5,goods()[1],'900-0'),false);assert.equal(await addOffer(f.store,5,goods()[0],'900-0'),true);assert.equal(await saveBasketFilters(f.store,5,'900-0',{}),false);assert.equal((await cartItems(f.store,5))[0].product,goods()[0].product);
});
test('saving from refinements retains an unresolved row, restores choices, and explicit clearing broadens the estimate',async()=>{
 const f=await fixture();await publish(f,goods());await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'молоко × 3',900);
 await new Bot(f).handle(callback(5,'resolve:900-0'));let d=(await f.store.user(5)).refinement;
 const type=d.facets.find(f=>f.key==='type');d.selected.type=type.values.findIndex(v=>v.value[0]==='milkplain');const pack=d.facets.find(f=>f.key==='pack');d.selected.pack=pack.values.findIndex(v=>v.value.amount===1000);await f.store.patch(5,{refinement:d});
 const save='ref:'+d.token+':save';await new Bot(f).handle(callback(5,save));let item=(await cartItems(f.store,5))[0];assert.deepEqual(item.filters,filters);assert.equal(item.product,null);assert.equal(item.quantity,3);assert(f.sent.at(-1).text.includes('Питьевое · 1 л'));
 await new Bot(f).handle(callback(5,save));assert(f.sent.at(-1).text.includes('уже изменились'));
 await new Bot(f).handle(callback(5,'resolve:900-0'));d=(await f.store.user(5)).refinement;assert.equal(d.facets.find(f=>f.key==='type').values[d.selected.type].value[0],'milkplain');
 await new Bot(f).handle(callback(5,'cartfilters:900-0'));assert.deepEqual((await cartItems(f.store,5))[0].filters,{});assert.equal((await compareBasket(f.store,5)).stores[0].items[0].price,3000);await new Bot(f).handle(callback(5,'ref:'+d.token+':save'));assert(f.sent.at(-1).text.includes('уже изменились'));assert.deepEqual((await cartItems(f.store,5))[0].filters,{});
});
test('removing a position or deleting an account also deletes its saved criteria',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'молоко, молоко',900);await saveBasketFilters(f.store,5,'900-0',filters);await saveBasketFilters(f.store,5,'900-1',filters);
 await new Bot(f).handle(callback(6,'cartfilters:900-0'));assert.deepEqual((await cartItems(f.store,5))[0].filters,filters);
 await new Bot(f).handle(callback(5,'cartremove:900-0'));assert.equal((await f.db.get('SELECT COUNT(*) n FROM sd_basket_filters WHERE uid=5')).n,1);
 await new Bot(f).handle(message(5,'/delete'));await new Bot(f).handle(callback(5,f.sent.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.callback_data.startsWith('delete:confirm:')).callback_data));assert.equal((await f.db.get('SELECT COUNT(*) n FROM sd_basket_filters WHERE uid=5')).n,0);
});

test('an existing basket schema upgrades without rewriting old rows or quantities',async()=>{
 const f=await fixture();await f.db.run('CREATE TABLE sd_basket(uid INTEGER NOT NULL,id TEXT NOT NULL,query TEXT NOT NULL,product TEXT,name TEXT,quantity INTEGER NOT NULL,PRIMARY KEY(uid,id))');
 await f.db.run('INSERT INTO sd_basket(uid,id,query,quantity) VALUES(5,:id,:query,3)',{':id':'old-1',':query':'молоко'});
 const rows=await cartItems(f.store,5);assert.equal(rows.length,1);assert.equal(rows[0].id,'old-1');assert.equal(rows[0].query,'молоко');assert.equal(rows[0].quantity,3);assert.deepEqual(rows[0].filters,{});
 await saveBasketFilters(f.store,5,'old-1',filters);assert.equal((await cartItems(f.store,5))[0].quantity,3);
});
