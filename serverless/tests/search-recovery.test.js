import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {buildRefinement} from '../tgcloud/lib/refinements.js';
const product=(id,name,terms,brand='Example')=>offer(id,{name,terms,brand,product:'local:'+String(id).padStart(32,'0')});
const buttons=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat();
test('typed coffee, tea and meat characteristics work without selecting them again',async()=>{
 const f=await fixture(),rows=[product(1,'Kafa mlevena 500g',['kafa','mlevena','500g']),product(2,'Kafa u zrnu 500g',['kafa','u','zrnu','500g']),product(3,'Kafa instant 200g',['kafa','instant','200g']),product(4,'Crni caj',['crni','caj']),product(5,'Zeleni caj',['zeleni','caj']),product(6,'Pileci file 500g',['pileci','file','500g'])];await publish(f,rows);
 for(const [query,name] of [['молотый кофе','Kafa mlevena'],['кофе молотый','Kafa mlevena'],['кофе в зёрнах','Kafa u zrnu'],['кофе в зернах','Kafa u zrnu'],['растворимый кофе','Kafa instant'],['чёрный чай','Crni caj'],['черный чай','Crni caj'],['зелёный чай','Zeleni caj'],['куриное филе','Pileci file']]){const matches=await f.store.search(query);assert.equal(matches.length,1,query);assert(JSON.parse(matches[0].payload).name.startsWith(name),query);const draft=buildRefinement(query,matches.map(r=>JSON.parse(r.payload)),'a');assert(!draft?.facets.some(f=>f.key==='type'),query);}
});
test('category names do not match substrings of unrelated product words',()=>{
 for(const query of ['чайник','рисунок','маслостойкий шланг','провод']){const draft=buildRefinement(query,[{name:'One',brand:'A'},{name:'Two',brand:'B'}],'a');assert(!draft?.facets.some(f=>f.key==='type'),query);}
});
test('empty filtered search offers one-button recovery while preserving query and basket target',async()=>{
 const f=await fixture();await publish(f,[product(1,'Energy drink Monster 500ml',['energy','drink','monster','500ml'],'Monster')]);await new Bot(f).handle(message(5,'/start'));await f.store.patch(5,{query:'энергетик',searchFilters:{brand:'Missing'},cartTarget:'900-0'});await new Bot(f).handle(callback(5,'results'));assert(f.sent.at(-1).text.includes('С этими уточнениями не нашли'));const relax=buttons(f).find(b=>b.callback_data.startsWith('relax:'));assert(relax);await new Bot(f).handle(callback(5,relax.callback_data));const u=await f.store.user(5);assert.equal(u.query,'энергетик');assert.equal(u.cartTarget,'900-0');assert.deepEqual(u.searchFilters,{});assert(buttons(f).some(b=>b.callback_data.startsWith('chainsel:')));
 await f.store.patch(5,{searchFilters:{brand:'Monster'}});await new Bot(f).handle(callback(5,relax.callback_data));assert(f.sent.at(-1).text.includes('Поиск уже изменился'));assert.equal((await f.store.user(5)).searchFilters.brand,'Monster');
});
test('opening and cancelling refinement edits does not silently remove active search filters',async()=>{
 const f=await fixture();await publish(f,[product(1,'Energy drink Monster 500ml',['energy','drink','monster','500ml'],'Monster'),product(2,'Red Bull 250ml',['red','bull','250ml'],'Red Bull')]);await new Bot(f).handle(message(5,'/start'));await f.store.patch(5,{query:'энергетик',searchFilters:{brand:'Monster'}});await new Bot(f).handle(callback(5,'refine:again'));assert.equal((await f.store.user(5)).searchFilters.brand,'Monster');await new Bot(f).handle(callback(5,'home'));await new Bot(f).handle(callback(5,'results'));assert.equal((await f.store.user(5)).searchFilters.brand,'Monster');assert(f.sent.at(-1).text.includes('Выбрано:</b> Monster'));
});
test('profile patches replace nested selections atomically and preserve unrelated concurrent changes',async()=>{
 const f=await fixture();await f.store.ensure(5);await f.store.patch(5,{query:'энергетик',searchFilters:{brand:'Monster',pack:{kind:'volume',amount:500}},refinement:{token:'a',selected:{brand:1,pack:2}}});await Promise.all([f.store.patch(5,{searchFilters:{},refinement:{token:'b',selected:{}}}),f.store.patch(5,{panel:123})]);const u=await f.store.user(5);assert.deepEqual(u.searchFilters,{});assert.deepEqual(u.refinement,{token:'b',selected:{}});assert.equal(u.query,'энергетик');assert.equal(u.panel,123);await f.store.patch(5,{refinement:null});assert.equal((await f.store.user(5)).refinement,undefined);
});
