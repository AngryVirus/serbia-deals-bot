import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback,source} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {buildRefinement,refinementFilters} from '../tgcloud/lib/refinements.js';
import {addList,cartItems} from '../tgcloud/lib/basket.js';
const keys=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat();
const drink=(id,name,brand,terms)=>offer(id,{name,brand,terms,product:'local:'+String(id).padStart(32,'0')});
const drinks=()=>[drink(1,'Energetski napitak Red Bull 0,25l','Red Bull',['energetski','napitak','red','bull','0','25l']),drink(2,'Energy drink Monster 500ml','Monster',['energy','drink','monster','500ml']),drink(3,'Red Bull 250 ml','Red Bull',['red','bull','250ml']),drink(4,'Red Bull 1,25l','Red Bull',['red','bull','1','25l'])];
async function act(f,prefix){const key=keys(f).find(b=>b.callback_data.includes(prefix));assert(key,prefix);await new Bot(f).handle(callback(5,key.callback_data));}
test('energy refinement allows both dimensions or no selection and all results remain available',async()=>{
 const f=await fixture();await publish(f,drinks());await new Bot(f).handle(message(5,'энергетик'));assert(f.sent.at(-1).text.includes('Уточнить товар'));assert(keys(f).some(b=>b.text.startsWith('Бренд')));assert(keys(f).some(b=>b.text.startsWith('Объём')));await act(f,':apply');assert(keys(f).some(b=>b.callback_data.startsWith('chainsel:')));assert.equal((await f.store.searchChains('энергетик'))[0].offers,4);
});
test('brand and volume combine, keep equivalent packages, and persist through pages and stores',async()=>{
 const f=await fixture();await publish(f,drinks());await new Bot(f).handle(message(5,'энергетик'));await act(f,':brand:open');await act(f,':brand:0');await act(f,':pack:open');const size=keys(f).find(b=>b.text==='250 мл');assert(size);await new Bot(f).handle(callback(5,size.callback_data));await act(f,':apply');const u=await f.store.user(5);assert.equal(u.searchFilters.brand,'Red Bull');assert.equal(u.searchFilters.pack.amount,250);assert.equal((await f.store.searchChains(u.query,Date.now(),u.searchFilters))[0].offers,2);await act(f,'chainsel:');assert(!f.sent.at(-1).text.includes('Monster'));assert(!f.sent.at(-1).text.includes('1,25l'));
});
test('generic meat includes multiple animal types but excludes processed products and pet food',async()=>{
 const f=await fixture();await publish(f,[drink(1,'Pileci file','A',['pileci','file']),drink(2,'Juneci but','B',['juneci','but']),drink(3,'Svinjski vrat','C',['svinjski','vrat']),drink(4,'Pasteta piletina','D',['pasteta','piletina']),drink(5,'Hrana za pse piletina','E',['hrana','za','pse','piletina'])]);assert.equal((await f.store.search('мясо')).length,3);await new Bot(f).handle(message(5,'мясо'));await act(f,':type:open');assert(keys(f).some(b=>b.text==='Говядина'));await act(f,':type:1');await act(f,':apply');const u=await f.store.user(5),rows=await f.store.searchChain('мясо',source,0,Date.now(),u.searchFilters);assert.equal(rows.length,1);assert(JSON.parse(rows[0].payload).name.includes('Juneci'));
});
test('all categories receive available brand and package options; explicit values are not asked twice',()=>{
 const offers=[{name:'Sampon A 250ml',brand:'Alpha'},{name:'Sampon B 500ml',brand:'Beta'}];const d=buildRefinement('шампунь',offers,'a');assert(d.facets.some(f=>f.key==='brand'));assert(d.facets.some(f=>f.key==='pack'));const explicit=buildRefinement('шампунь Alpha 250 мл',offers,'b');assert.equal(explicit,null);assert.equal(buildRefinement('4006381333931',offers,'c'),null);
});
test('weights and volumes match canonical equivalents without a larger-size substring match',async()=>{
 const f=await fixture();await publish(f,[drink(1,'Kafa 500g','A',['kafa','500g']),drink(2,'Kafa 0,5kg','B',['kafa','0','5kg']),drink(3,'Kafa 1500g','C',['kafa','1500g'])]);assert.equal((await f.store.search('кофе 500 г')).length,2);assert.equal((await f.store.search('кофе 0,5 кг')).length,2);
 const g=await fixture();await publish(g,drinks());assert.equal((await g.store.search('энергетик 250 мл')).length,2);assert.equal((await g.store.search('энергетик 0,25 л')).length,2);
});
test('refinement choices are user-scoped, expire, cannot be replayed after apply and retain basket target',async()=>{
 const f=await fixture();await publish(f,drinks());await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'энергетик',900);const item=(await cartItems(f.store,5))[0];await new Bot(f).handle(callback(5,'resolve:'+item.id));const apply=keys(f).find(b=>b.callback_data.endsWith(':apply')).callback_data;await new Bot(f).handle(callback(6,apply));assert(f.sent.at(-1).text.includes('уже изменились'));assert.equal((await f.store.user(5)).cartTarget,item.id);await new Bot(f).handle(callback(5,apply));assert.equal((await f.store.user(5)).cartTarget,item.id);await new Bot(f).handle(callback(5,apply));assert(f.sent.at(-1).text.includes('уже изменились'));await new Bot(f).handle(message(5,'энергетик'));const d=(await f.store.user(5)).refinement;d.expires=0;await f.store.patch(5,{refinement:d});await new Bot(f).handle(callback(5,'ref:'+d.token+':apply'));assert(f.sent.at(-1).text.includes('уже изменились'));
});
test('milk fat and bulb socket choices are bounded and filter actual characteristics',async()=>{
 const f=await fixture();await publish(f,[drink(1,'Mleko 1l 2,8%','A',['mleko','1l','2','8']),drink(2,'Mleko 1l 3,2%','B',['mleko','1l','3','2'])]);const rows=await f.store.refinementSamples('молоко'),d=buildRefinement('молоко',rows.map(r=>JSON.parse(r.payload)),'a');d.selected.fat=0;const matches=await f.store.searchChain('молоко',source,0,Date.now(),refinementFilters(d));assert.equal(matches.length,1);assert(JSON.parse(matches[0].payload).name.includes('2,8%'));
});
test('package choices follow the selected brand and reopening refinements retains chosen values',async()=>{
 const f=await fixture();await publish(f,drinks());await new Bot(f).handle(message(5,'энергетик'));await act(f,':brand:open');const monster=keys(f).find(b=>b.text==='Monster');await new Bot(f).handle(callback(5,monster.callback_data));await act(f,':pack:open');assert(keys(f).some(b=>b.text==='500 мл'));assert(!keys(f).some(b=>b.text==='250 мл'));const volume=keys(f).find(b=>b.text==='500 мл');await new Bot(f).handle(callback(5,volume.callback_data));await act(f,':apply');await new Bot(f).handle(callback(5,'refine:again'));const d=(await f.store.user(5)).refinement;assert.equal(refinementFilters(d).brand,'Monster');assert.equal(refinementFilters(d).pack.amount,500);
});
test('new search invalidates old questions and selecting all discards every optional filter',async()=>{
 const f=await fixture();await publish(f,drinks());await new Bot(f).handle(message(5,'энергетик'));const old=keys(f).find(b=>b.callback_data.endsWith(':apply')).callback_data;await new Bot(f).handle(callback(5,'search'));await new Bot(f).handle(callback(5,old));assert(f.sent.at(-1).text.includes('уже изменились'));await new Bot(f).handle(message(5,'энергетик'));await act(f,':brand:open');await act(f,':brand:0');await act(f,':all');assert.deepEqual((await f.store.user(5)).searchFilters,{});
});
