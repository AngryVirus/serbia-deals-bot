import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback,source} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {measure,buildRefinement} from '../tgcloud/lib/refinements.js';
import {packageMeasure,unitPrice,measurementIssue,rawPackageMeasure,queryGroups,emptyQuality,auditOffer,OWNER_ID} from '../tgcloud/lib/domain.js';
import {manage} from '../tgcloud/lib/manage.js';
import {addList,compareBasket} from '../tgcloud/lib/basket.js';
import {basketSummary} from '../tgcloud/lib/shopping-ui.js';
const keys=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat();
const run=(f,input)=>manage(input,{ownerRun:true},f);

test('packaging and unit prices share dimension checks without converting or treating specifications as contents',()=>{
 for(const name of ['Donut 1l','Пончик 75 л','Energetski napitak 200g','Энергетик 200 г','Sijalica E27 200g','Posuda 2l','Laptop 16g']){assert.equal(packageMeasure(name),null,name);assert.equal(measure(name),null,name);assert.equal(unitPrice({name},10000),null,name);}
 for(const [name,kind,amount]of [['Donut 75g','weight',75],['Red Bull 0.5l','volume',500],['Cedevita napitak 200g','weight',200],['Sladoled 500ml','volume',500],['Mleko u prahu 400g','weight',400],['Kiselo mleko 180g','weight',180],['Voda Donat Mg 1l','volume',1000],['Kukuruz 3x212ml','volume',636],['Kafa iced coffee 230ml','volume',230]]){assert.deepEqual(packageMeasure(name),{kind,amount},name);assert.equal(measure(name).amount,amount,name);}
 assert.equal(rawPackageMeasure('Donut 1l').kind,'volume');assert.equal(measurementIssue('Donut 1l'),'wrong_dimension');assert.equal(measurementIssue('Posuda 2l'),'capacity_or_specification');
});
test('refinements exclude wrong and conflicting packages and show only observed product types',()=>{
 const d=buildRefinement('пончик',[{name:'Donut 1l',brand:'A'},{name:'Donut 75g',brand:'B'},{name:'Donut 100g 200g',brand:'C'},{name:'Donut 100g',brand:'D'}],'a');
 assert.deepEqual(d.facets.find(f=>f.key==='pack').values.map(v=>v.label),['75 г','100 г']);
 const chicken=buildRefinement('курица',[{name:'Pileci file 500g',brand:'A'},{name:'Pileca krila 1kg',brand:'B'}],'b');assert.deepEqual(chicken.facets.find(f=>f.key==='type').values.map(v=>v.label),['Филе','Крылья']);
 assert.equal(buildRefinement('лампочка',[{name:'Sijalica 100g'},{name:'Sijalica 200g'}],'c'),null);
});
test('reviewed Russian variants find the same product without broad fuzzy brand matching',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Krofna 75g',terms:['krofna','75g']}),offer(2,{name:'Persun list 20g',terms:['persun','list','20g']}),offer(3,{name:'Energetski napitak Red Bull 250ml',terms:['energetski','napitak','red','bull','250ml']})]);
 for(const [q,base]of [['крофне','пончик'],['пертушка','петрушка'],['першун','петрушка'],['енергетик','энергетик'],['энергитик','энергетик']])assert.deepEqual((await f.store.search(q)).map(r=>r.id),(await f.store.search(base)).map(r=>r.id),q);
 assert((await f.store.search('пертушка')).length);assert.equal((await f.store.search('Monsterr')).length,0);assert.notDeepEqual(queryGroups('Monsterr'),queryGroups('Monster'));
});
test('changing type or brand refreshes dependent choices on the overview before opening another question',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Mleko 1l',brand:'Plain',terms:['mleko','1l']}),offer(2,{name:'Kiselo mleko 180g',brand:'Sour',terms:['kiselo','mleko','180g']})]);await new Bot(f).handle(message(5,'молоко'));
 await new Bot(f).handle(callback(5,keys(f).find(k=>k.callback_data.includes(':type:open')).callback_data));
 await new Bot(f).handle(callback(5,keys(f).find(k=>k.text==='Питьевое').callback_data));
 const d=(await f.store.user(5)).refinement;assert(d.facets.find(f=>f.key==='pack').values.every(v=>v.value.kind==='volume'));assert(d.facets.find(f=>f.key==='brand').values.every(v=>v.label==='Plain'));assert(!f.sent.at(-1).text.includes('180 г'));
});
test('invalid unconfirmed dimensions never become a completed basket or a zero-price bargain',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Donut 1l',terms:['donut','1l']})]);await addList(f.store,5,'пончик',700);const r=await compareBasket(f.store,5);assert.equal(r.split.complete,false);assert.equal(r.stores.length,0);assert.equal(r.unresolved.length,1);assert(!basketSummary(r).includes('0,00 RSD'));
 await new Bot(f).handle(message(5,'энергетик 200 г'));assert(f.sent.at(-1).text.includes('Проверьте единицу'));assert(f.sent.at(-1).text.includes('мл или л'));
});
test('partial basket shows counted, unresolved and missing counts before entering a store',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Mleko 1l',terms:['mleko','1l']}),offer(2,{name:'Mleko 500ml',terms:['mleko','500ml']}),offer(3,{name:'Krastavac',terms:['krastavac']})]);await addList(f.store,5,'молоко, огурцы, сливы',701);
 const r=await compareBasket(f.store,5),text=basketSummary(r);assert(text.includes('Рассчитано: 1 · Уточнить: 1 · Нет цены: 1'));assert(text.includes('✕ сливы'));assert(text.includes('Найденные товары'));assert(!r.bestSingle);assert(r.unresolved[0].choices.includes('500 мл'));assert(!r.unresolved[0].choices.includes('товар'));
});
test('publication audits each title, detects comparable price jumps, and keeps public-only bounded examples',async()=>{
 const f=await fixture(),a=offer(1,{name:'Donut 75g',regular:10000,terms:['donut','75g'],unit:'l'});await publish(f,[a]);let q=await f.store.meta('catalog_quality:'+source);assert.equal(q.offers,1);assert.equal(q.metadata_conflicts,1);assert.equal(q.price_compared,0);
 await publish(f,[{...a,regular:40000}],'c'.repeat(32));q=await f.store.meta('catalog_quality:'+source);assert.equal(q.price_compared,1);assert.equal(q.price_jumps,1);assert.deepEqual(Object.keys(q.examples[0]).sort(),['kind','name']);
 const agg=emptyQuality();for(let i=0;i<20;i++)auditOffer(agg,{name:'Donut 1l',regular:100}, {name:'different',regular:1});assert.equal(agg.wrong_dimension,20);assert.equal(agg.price_compared,0);assert.equal(agg.examples.length,6);
});
test('quality backfill is resumable, replay-safe and scoped to the current source generation',async()=>{
 const f=await fixture();await publish(f,Array.from({length:501},(_,i)=>offer(i+1)));await f.db.run('DELETE FROM sd_meta WHERE key=:key',{':key':'catalog_quality:'+source});
 const first=await run(f,{operation:'quality_page',source});assert(first.more);assert.equal(first.offers,500);
 const outcomes=await Promise.all([run(f,{operation:'quality_page',source}),run(f,{operation:'quality_page',source})]);assert(outcomes.some(r=>r.done));const q=await f.store.meta('catalog_quality:'+source);assert.equal(q.offers,501);assert.equal((await run(f,{operation:'quality_page',source})).offers,501);
 await f.db.run('UPDATE sd_sources SET current_gen=:gen',{':gen':'f'.repeat(32)});assert(!((await run(f,{operation:'quality_page',source})).offers));
});
test('raw duplicate counters require the active generation and quality is owner-only under forged callbacks',async()=>{
 const f=await fixture();await publish(f,[offer()]);const stats={rows:3,accepted:1,rejected:0,conflicts:1,duplicates:1};assert((await run(f,{operation:'source_audit',source,gen:'b'.repeat(32),stats})).saved);assert((await run(f,{operation:'source_audit',source,gen:'c'.repeat(32),stats})).changed);
 await assert.rejects(run(f,{operation:'source_audit',source,gen:'b'.repeat(32),stats:{...stats,rows:-1}}));await assert.rejects(manage({operation:'quality_page',source},{},f));
 await new Bot(f).handle(callback(OWNER_ID,'admin:quality'));assert(f.sent.at(-1).text.includes('Проверено товаров: 1'));assert(f.sent.at(-1).text.includes('Повторы убраны: 1'));
 for(const [uid,role]of [[5,'moderator'],[6,'admin']]){await f.store.ensure(uid);await f.db.run("INSERT INTO sd_admin_records(kind,key,payload,at) VALUES('role',:key,:payload,0)",{':key':String(uid),':payload':JSON.stringify({role})});await new Bot(f).handle(callback(uid,'admin:quality'));assert(!f.sent.at(-1).text.includes('Проверено товаров'));}
 const fake=callback(OWNER_ID,'admin:quality');fake.callback_query.message.chat.id=5;const before=f.sent.length;await new Bot(f).handle(fake);assert.equal(f.sent.length,before);
});

test('canonical package indexing matches a complete multipack and rejects a single bottle or wrong dimension',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Energetski napitak 6x250ml',terms:['energetski','napitak','6x250ml'],product:'local:1'}),offer(2,{name:'Energetski napitak 250ml',terms:['energetski','napitak','250ml'],product:'local:2'}),offer(3,{name:'Donut 1l',terms:['donut','1l'],product:'local:3'})]);
 const found=await f.store.searchChain('энергетик',source,0,Date.now(),{pack:{kind:'volume',amount:1500}});assert.equal(found.length,1);assert.equal(JSON.parse(found[0].payload).name,'Energetski napitak 6x250ml');
 assert.equal((await f.store.search('энергетик 1,5 л')).length,1);assert.equal((await f.store.search('энергетик 250 мл')).length,1);assert.equal((await f.store.search('пончик 1 л')).length,0);
 const row=await f.store.offer(offer(1).id);assert.deepEqual(JSON.parse(row.payload)._measure,{kind:'volume',amount:1500});
});
test('quality backfill adds canonical measures and searchable terms to legacy rows without changing source names or prices',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Energetski napitak 6x250ml',terms:['energetski','napitak','6x250ml']})]);await f.db.run("UPDATE sd_offers SET payload=json_remove(payload,'$._measure')");await f.db.run("DELETE FROM sd_terms WHERE term IN ('1500ml','5l','150cl')");await f.db.run('DELETE FROM sd_meta WHERE key=:key',{':key':'catalog_quality:'+source});
 assert((await run(f,{operation:'quality_page',source})).done);const row=await f.store.offer(offer(1).id),payload=JSON.parse(row.payload);assert.equal(payload.name,'Energetski napitak 6x250ml');assert.equal(row.price,offer().regular);assert.deepEqual(payload._measure,{kind:'volume',amount:1500});assert.equal((await f.store.search('энергетик 1,5 л')).length,1);
});

test('explicit vessel capacity stays searchable while it is excluded from package facets and unit prices',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Solja 500ml',terms:['solja','500ml']})]);assert.equal((await f.store.search('кружка 500 мл')).length,1);assert.equal((await f.store.searchChain('кружка',source,0,Date.now(),{pack:{kind:'volume',amount:500}})).length,0);
});

test('observed powder drinks, flavoured sweets and unusual retail units remain valid without inventing dimensions',()=>{
 for(const name of ['Cola flasice MK14 300g','BEER MIX F&F 300G','Kasika ljubavi Aleva 60g','High Protein napitak SK3 350g','Mleko za bebe Bebelac 400g','Napitak deciji Kras Express 200g','Ulje od kokosa 200g'])assert.equal(packageMeasure(name)?.kind,'weight',name);
 assert.equal(packageMeasure('MLEKO SVEZE PET 2,8%MM DUKAT 1.5KG SOMBOLED'),null);
 const product={name:'Donut 75g',unit:'L'};assert.equal(unitPrice(product,7500).unit,'кг');assert.equal(packageMeasure('Termos solja 350ml'),null);assert.equal(packageMeasure('Donat Mg 1l').kind,'volume');
});
