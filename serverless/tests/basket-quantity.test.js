import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback} from './fixtures.js';
import {addList,addOffer,compareBasket,basketDemand,basketQuery,basketVariant,comparisonClass,saveBasketFilters,cartItems} from '../tgcloud/lib/basket.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {basketSummary} from '../tgcloud/lib/shopping-ui.js';
const goods=(id,name,price,source='a'.repeat(24))=>offer(id,{source,name,regular:price,terms:name.toLowerCase().replace(',','.').split(/\s+/),product:'local:'+String(id).padStart(32,'0')});

test('two liters compare complete packs and choose total cost instead of the cheapest individual pack',async()=>{
 const f=await fixture();await publish(f,[goods(1,'Mleko 500ml',8000),goods(2,'Mleko 1l',14000)]);await addList(f.store,5,'молоко 2 л',900);
 const r=await compareBasket(f.store,5),row=r.stores[0].items[0];assert.equal(row.quantity,2);assert.equal(row.total,28000);assert.equal(row.pack,'1 л');assert.equal(row.demand,'2 л');assert.equal(row.supplied,'2 л');assert.equal(row.ambiguous,false);assert.equal((await cartItems(f.store,5))[0].product,null);
 assert(basketSummary(r).includes('нужно 2 л / 2 уп.'));
});
test('weight, decimal commas, repeated requested amounts, multipacks and surplus are calculated explicitly',async()=>{
 const f=await fixture();await publish(f,[goods(1,'Kafa 400g',9000),goods(2,'Kafa 250g',6000)]);await addList(f.store,5,'кофе 0,5 кг × 2',900);
 const row=(await compareBasket(f.store,5)).stores[0].items[0];assert.equal(row.quantity,4);assert.equal(row.pack,'250 г');assert.equal(row.total,24000);assert.equal(row.demand,'1 кг');
 await f.db.run('UPDATE sd_basket SET quantity=1');const next=(await compareBasket(f.store,5)).stores[0].items[0];assert.equal(next.quantity,2);assert.equal(next.total,12000);
 const g=await fixture();await publish(g,[goods(1,'Voda 6x250ml',10000)]);await addList(g.store,5,'вода 2 л',901);const multi=(await compareBasket(g.store,5)).stores[0].items[0];assert.equal(multi.quantity,2);assert.equal(multi.supplied,'3 л');assert.equal(multi.total,20000);
});
test('unknown or contradictory package dimensions are not invented or treated as complete',async()=>{
 const f=await fixture();await publish(f,[goods(1,'Mleko',5000),goods(2,'Mleko 500ml 1l',3000)]);await addList(f.store,5,'молоко 2 л',900);const r=await compareBasket(f.store,5);assert.equal(r.split.complete,false);assert.equal(r.stores.length,0);assert.equal(r.unresolved[0].reason,'Нет проверенного размера упаковки');assert(basketSummary(r).includes('Нет проверенного размера упаковки'));
 assert.equal(basketDemand({query:'Пончик 75 л',quantity:1}),null);assert.equal(basketDemand({query:'Лампочка E27 9W',quantity:1}),null);
});
test('confirmed SKU is exact, retains requested total, and a direct catalogue addition still counts packages',async()=>{
 const f=await fixture(),o=goods(1,'Mleko 500ml',8000);await publish(f,[o]);await addList(f.store,5,'молоко 2 л',900);await addOffer(f.store,5,o,'900-0');let r=await compareBasket(f.store,5);assert.equal(r.estimated,false);assert.equal(r.stores[0].items[0].match,'exact');assert.equal(r.stores[0].items[0].quantity,4);
 await addOffer(f.store,6,o);r=await compareBasket(f.store,6);assert.equal(r.stores[0].items[0].quantity,1);assert.equal(r.stores[0].items[0].demand,undefined);
});
test('milk, chicken and coffee variants do not become a misleading complete or cheapest basket',async()=>{
 const f=await fixture();await publish(f,[goods(1,'Mleko 1l',14000),goods(2,'Cokoladno mleko 1l',1000),goods(3,'Pileci file 500g',40000),goods(4,'Pileca jetra 500g',1000),goods(5,'Kafa instant 200g',6000),goods(6,'Kafa mlevena 200g',5000)]);await addList(f.store,5,'молоко 2 л, курица, кофе',900);
 let r=await compareBasket(f.store,5);assert.equal(r.unresolved.length,3);assert.equal(r.stores[0].total,0);assert.equal(r.stores[0].complete,false);assert.equal(r.savings,null);assert(!basketSummary(r).includes('Экономия на'));
 await saveBasketFilters(f.store,5,'900-0',{type:['milkplain']});r=await compareBasket(f.store,5);assert.equal(r.stores[0].ready,1);assert.equal(r.stores[0].total,28000);
});
test('summary distinguishes whole, partial and split baskets; savings require confirmed products',async()=>{
 const f=await fixture(),a=goods(1,'Kafa 200g',10000),b=goods(2,'Mleko 1l',20000),s2='b'.repeat(24);await publish(f,[a,b]);await publish(f,[{...a,id:'f'.repeat(32),source:s2,format:'Second',regular:5000}],'c'.repeat(32));await addOffer(f.store,5,a);await addOffer(f.store,5,b);
 const r=await compareBasket(f.store,5);assert.equal(r.bestSingle.total,30000);assert.equal(r.split.total,25000);assert.equal(r.split.networks,2);assert.equal(r.savings,5000);const text=basketSummary(r);assert(text.includes('В одной сети:'));assert(text.includes('Экономия на выбранных товарах: 50,00 RSD'));assert(text.includes('Только 1 из 2'));
});
test('basket refinement searches base name while retaining the requested amount and selected package',async()=>{
 const f=await fixture();await publish(f,[goods(1,'Mleko 500ml',8000),goods(2,'Mleko 1l',14000)]);await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'молоко 2 л',900);await new Bot(f).handle(callback(5,'resolve:900-0'));
 const user=await f.store.user(5);assert.equal(user.query,'молоко');assert.equal(user.cartTarget,'900-0');assert.equal((await cartItems(f.store,5))[0].query,'молоко 2 л');assert.equal(basketQuery((await cartItems(f.store,5))[0]),'молоко');await new Bot(f).handle(callback(6,'resolve:900-0'));assert.equal((await cartItems(f.store,5))[0].quantity,1);
});

test('catalogue brand substrings and ground-coffee descriptions do not create false incompatible types',()=>{
 assert.equal(comparisonClass({name:'MLEKO SVEZE KESA 2.8% ZAPIS TARE 1L MLEKARA SPASOJEVIC'}),'питьевое молоко');
 assert.equal(comparisonClass({name:'Kafa mlevena od zrna arabike 200g'}),'молотый кофе');
 assert.equal(comparisonClass({name:'Coko mleko 1l'}),'шоколадное молоко');assert.equal(basketVariant({name:'Coko mleko 1l'}),'шоколадное · 1 л');
});

test('candidate overflow and publication during calculation fail explicitly instead of caching a partial total',async()=>{
 const f=await fixture();await addList(f.store,5,'молоко 2 л',900);f.store.basketCandidates=async()=>Array.from({length:1001},()=>({payload:JSON.stringify(goods(1,'Mleko 1l',10000)),source_name:'Example'}));await assert.rejects(compareBasket(f.store,5),/Слишком много вариантов/);assert.equal((await f.db.get('SELECT COUNT(*) n FROM sd_basket_reports')).n,0);
 const g=await fixture();await publish(g,[goods(1,'Mleko 1l',10000)]);await addList(g.store,5,'молоко 2 л',900);const candidates=g.store.basketCandidates.bind(g.store);g.store.basketCandidates=async(...args)=>{const rows=await candidates(...args);await g.db.run('UPDATE sd_sources SET current_gen=:gen',{':gen':'f'.repeat(32)});return rows;};await assert.rejects(compareBasket(g.store,5),/Прайсы обновились/);assert.equal((await g.db.get('SELECT COUNT(*) n FROM sd_basket_reports')).n,0);
});
test('choosing a wrong dimension cannot confirm a measured shopping-list requirement',async()=>{
 const f=await fixture();await addList(f.store,5,'молоко 2 л',900);assert.equal(await addOffer(f.store,5,goods(1,'Kiselo mleko 180g',1000),'900-0'),false);assert.equal(await addOffer(f.store,5,goods(2,'Mleko',1000),'900-0'),false);assert.equal((await cartItems(f.store,5))[0].product,null);
});

test('owner diagnostics count only calculated complete baskets, not all found but incompatible items',async()=>{
 const {manage}=await import('../tgcloud/lib/manage.js');const f=await fixture();await publish(f,[goods(1,'Mleko 1l',10000),goods(2,'Kiselo mleko 180g',1000)]);await addList(f.store,340780041,'молоко',900);const status=await manage({operation:'basket_check'},{ownerRun:true},f);assert.equal(status.complete_stores,0);assert.equal(status.needs_choice,1);
});
