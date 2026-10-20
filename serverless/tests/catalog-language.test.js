import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish} from './fixtures.js';
import {productNames,bilingual,validTranslation} from '../tgcloud/lib/product-names.js';
import {basketVariant} from '../tgcloud/lib/basket.js';
import {restoreRefinement,refinementFilters} from '../tgcloud/lib/refinements.js';

test('Russian and English donut searches find pastries, not Donat water, mugs, molds or lamps',async()=>{
 const f=await fixture();await publish(f,[
  offer(1,{name:'KEKS JAFFA KOLAC DONAT CHOCO CREAM 75G',terms:['keks','jaffa','kolac','donat','choco','cream','75g']}),
  offer(2,{name:'Krofna sa vocnim punjenjem 75g',terms:['krofna','sa','vocnim','punjenjem','75g']}),
  offer(3,{name:'Voda Donat Mg PET 1l',terms:['voda','donat','mg','pet','1l']}),
  offer(4,{name:'Solja Donut worry 440ml',terms:['solja','donut','worry','440ml']}),
  offer(5,{name:'Plafonjerka Donut LED',terms:['plafonjerka','donut','led']}),
  offer(6,{name:'Kalup za krofne',terms:['kalup','za','krofne']})
 ]);
 for(const q of ['пончик','пончики','пончиков','донат','Donut','doughnut'])assert.equal((await f.store.search(q)).length,2,q);
 assert.equal((await f.store.search('Donat Mg')).length,1);
 assert.equal((await f.store.search('solja donut')).length,1);
});
test('parsley vocabulary covers Russian forms and Serbian Cyrillic without choosing cheese with parsley',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Persun list 7gr',terms:['persun','list','7gr']}),offer(2,{name:'Sir persun 380g',terms:['sir','persun','380g']}),offer(3,{name:'Mirodjija 10g',terms:['mirodjija','10g']})]);
 for(const q of ['петрушка','петрушку','петрушкой','першун','parsley'])assert.equal((await f.store.search(q)).length,1,q);
 assert.equal((await f.store.search('петрушка 7 г')).length,1);assert.equal((await f.store.search('укроп')).length,1);
});
test('dictionary fallback translates the reported public title during an external outage and retains original size',async()=>{
 const f=await fixture(),name='KEKS JAFFA KOLAČ DONAT CHOCO CREAM 75G';let calls=0;
 const names=await productNames(f.store,async()=>{calls++;throw Error('Unavailable');},[{name}]);
 assert.equal(names.get(name),'Пончик JAFFA с шоколадным кремом 75 г / '+name);assert.equal(calls,2);
 assert.equal(bilingual(null,'Peršun 500g'),'Петрушка 500 г / Peršun 500g');
});
test('translations cannot swap grams and liters, including an old cached invalid translation',async()=>{
 assert.equal(validTranslation('Пончик 75 л','Donut 75g'),false);assert.equal(validTranslation('Пончик 75 г','Donut 75g'),true);
 const f=await fixture(),name='Donut 75g';await productNames(f.store,null,[{name}]);await f.db.run('INSERT INTO sd_product_names(name,ru,expires) VALUES(:name,:ru,:expires)',{':name':name,':ru':'Пончик 75 л',':expires':Date.now()+86400000});
 const names=await productNames(f.store,async()=>{throw Error('Unavailable');},[{name}]);assert(!names.get(name).includes('75 л'));assert(names.get(name).includes('75 г'));
});
test('variant labels distinguish fresh and dried plums, chicken cuts, offal and flavored snacks',()=>{
 assert.equal(basketVariant({name:'Suva sljiva 200g'}),'чернослив · 200 г');assert.equal(basketVariant({name:'Sljiva 1kg'}),'сливы · 1 кг');
 assert.equal(basketVariant({name:'Pileca jetra 400g'}),'субпродукты · 400 г');assert.equal(basketVariant({name:'Pileci file 500g'}),'филе · 500 г');assert.equal(basketVariant({name:'Cips piletina 50g'}),'со вкусом курицы · 50 г');
});
test('saved choices outside a sampled catalogue page are restored instead of silently dropped',()=>{
 const draft={facets:[{key:'brand',label:'Бренд',values:[{label:'A',value:'A'}]}],selected:{}};
 const filters={brand:'B',pack:{kind:'volume',amount:1000},type:['milkplain']};restoreRefinement(draft,filters);assert.deepEqual(refinementFilters(draft),filters);
});

test('ordinary milk is not a milk-flavored cookie, chocolate bar or chocolate drink; ambiguous fruit spirit metadata is rejected',async()=>{
 const f=await fixture();await publish(f,[
  offer(1,{name:'Mleko 1l',terms:['mleko','1l']}),
  offer(2,{name:'BAR MLEKO PAPITA 33G',terms:['bar','mleko','papita','33g']}),
  offer(3,{name:'Keks mleko 35g',terms:['keks','mleko','35g']}),
  offer(4,{name:'COKO MLEKO 230ML',terms:['coko','mleko','230ml']}),
  offer(5,{name:'0.03 ZARIC MEDENA SLJIVA',terms:['0','03','zaric','medena','sljiva'],unit:'L'}),
  offer(6,{name:'Sljiva 500g',terms:['sljiva','500g'],unit:'L'})
 ]);
 assert.equal((await f.store.search('питьевое молоко')).length,1);assert.equal((await f.store.search('молоко')).length,2);assert.equal((await f.store.search('сливы')).length,1);
 assert.equal(validTranslation('Петрушка 500 г','Persun'),false);
});
