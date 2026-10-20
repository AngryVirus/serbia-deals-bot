import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback,source} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {addList,cartItems,compareBasket,basketVariant} from '../tgcloud/lib/basket.js';
const milk=(id,name,terms)=>offer(id,{name,terms,brand:'Example',product:'local:'+String(id).padStart(32,'0')});
const milks=()=>[
 milk(1,'Mleko UHT 2,8% 1l',['mleko','uht','2','8','1l']),
 milk(2,'Kiselo mleko 2,8% 180g',['kiselo','mleko','2','8','180g']),
 milk(3,'Cokoladno mleko 250ml',['cokoladno','mleko','250ml']),
 milk(4,'Kokos mleko 1l',['kokos','mleko','1l']),
 milk(5,'Mleko u prahu 400g',['mleko','u','prahu','400g']),
 milk(6,'Mleko bez laktoze 1l',['mleko','bez','laktoze','1l']),
 milk(7,'Mlijeko UHT 1l',['mlijeko','uht','1l'])
];
const buttons=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat();

test('milk types narrow search without changing the unfiltered set or conflating sour milk and drinking milk',async()=>{
 const f=await fixture();await publish(f,milks());assert.equal((await f.store.searchChains('молоко'))[0].offers,7);
 for(const query of ['питьевое молоко','обычное молоко','молоко питьевое']){
  const rows=await f.store.search(query);assert.equal(rows.length,3,query);assert(rows.every(r=>!JSON.parse(r.payload).name.includes('Kiselo')));
 }
 const rows=await f.store.searchChain('молоко',source,0,Date.now(),{type:['milkplain'],pack:{kind:'volume',amount:1000}});assert.equal(rows.length,3);
 assert.equal((await f.store.search('кисломолочное молоко')).length,1);assert.equal((await f.store.search('шоколадное молоко')).length,1);
});
test('milk refinement applies to basket selection, retains quantity and offers a real no-filter path',async()=>{
 const f=await fixture();await publish(f,milks());await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'молоко × 3',900);
 await new Bot(f).handle(callback(5,'resolve:900-0'));let d=(await f.store.user(5)).refinement;assert(d.facets.some(f=>f.key==='type'));
 await new Bot(f).handle(callback(5,'ref:'+d.token+':type:open'));const plain=buttons(f).find(b=>b.text==='Питьевое');assert(plain);await new Bot(f).handle(callback(5,plain.callback_data));
 d=(await f.store.user(5)).refinement;await new Bot(f).handle(callback(5,'ref:'+d.token+':apply'));let u=await f.store.user(5);assert.deepEqual(u.searchFilters.type,['milkplain']);assert.equal(u.cartTarget,'900-0');assert(f.sent.at(-1).text.includes('Питьевое'));
 await new Bot(f).handle(callback(5,'refine:again'));d=(await f.store.user(5)).refinement;await new Bot(f).handle(callback(5,'ref:'+d.token+':all'));u=await f.store.user(5);assert.deepEqual(u.searchFilters,{});assert.equal(u.cartTarget,'900-0');assert.equal((await cartItems(f.store,5))[0].quantity,3);
});
test('estimate records the actual package behind its price without confirming a product or translating private input',async()=>{
 const f=await fixture();const rows=milks();rows[1].regular=100;await publish(f,rows);await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'молоко',900);
 let requests=0;f.fetch=async()=>{requests++;throw Error('No external test requests');};
 const report=await compareBasket(f.store,5);assert.equal(report.stores[0].items[0].variant,'кисломолочное · 180 г');assert.equal(report.stores[0].items[0].name,'молоко');assert.equal(report.stores[0].items[0].ambiguous,true);assert.equal(report.stores[0].total,0);
 await new Bot(f).handle(callback(5,'basketcompare'));assert(f.sent.at(-1).text.includes('выберите вид или упаковку'));
 await new Bot(f).handle(callback(5,'basketshop:'+source+':0'));assert(f.sent.at(-1).text.includes('кисломолочное'));assert.equal(requests,0);assert.equal((await cartItems(f.store,5))[0].product,null);
});
test('package hints preserve stock-code boundaries and never invent a missing size',()=>{
 assert.equal(basketVariant({name:'Energy drink SK24 250 ml'}),'250 мл');
 assert.equal(basketVariant({name:'Kafa 0,5kg'}),'500 г');
 assert.equal(basketVariant({name:'Cokoladno mleko 0,25l'}),'шоколадное · 250 мл');
 assert.equal(basketVariant({name:'Product without packaging'}),'');
});

test('plums stay fruit even when spirits omit the word rakija and pastries mention plums',async()=>{
 const f=await fixture();await publish(f,[
  milk(1,'METRO SLJIVA ZUTA',['metro','sljiva','zuta']),
  milk(2,'0.03L NASLEDJE SLJIVA',['0','03l','nasledje','sljiva']),
  milk(3,'Strudla sljiva 190g',['strudla','sljiva','190g']),
  milk(4,'Kolac sa sljivama 1250g',['kolac','sa','sljivama','1250g']),
  milk(5,'Suva sljiva 200g',['suva','sljiva','200g']),
  milk(6,'PECIVO PP PUZ SLJIVA 190G',['pecivo','pp','puz','sljiva','190g'])
 ]);
 assert.equal((await f.store.search('сливы')).length,2);
 assert.equal((await f.store.search('strudla sljiva')).length,1);
 assert.equal((await f.store.search('сливы 0,03 л')).length,1);
});
