import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {addList,cartItems} from '../tgcloud/lib/basket.js';
const buttons=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat();
const translation={ok:true,json:async()=>[[['Лампочка E27 9W 806lm']]]};

test('default results, card, basket and watches never wait for external translation',async()=>{
 const f=await fixture();await publish(f,[offer()]);let calls=0;f.fetch=()=>{calls++;return new Promise(()=>{});};
 await new Bot(f).handle(message(5,'/start'));const bot=new Bot(f);bot.uid=5;bot.user=await f.store.user(5);bot.allowAll=true;await bot.search('лампочка E27');assert(buttons(f).some(b=>b.callback_data.startsWith('chainsel:')));
 await new Bot(f).handle(callback(5,buttons(f).find(b=>b.callback_data.startsWith('chainsel:')).callback_data));assert(f.sent.at(-1).text.includes(offer().name));assert(buttons(f).some(b=>b.callback_data.startsWith('translate:results:')));
 await new Bot(f).handle(callback(5,'offer:'+offer().id));assert(buttons(f).some(b=>b.callback_data==='translate:offer:'+offer().id));
 await new Bot(f).handle(callback(5,'basketadd:'+offer().id+':'));await new Bot(f).handle(callback(5,'basketcompare'));await new Bot(f).handle(callback(5,'watches'));assert.equal(calls,0);
});
test('translation is explicit, cached, and returning to the original does not fetch',async()=>{
 const f=await fixture();await publish(f,[offer()]);let calls=0;f.fetch=async()=>{calls++;return translation;};await new Bot(f).handle(message(5,'/start'));
 await new Bot(f).handle(callback(5,'translate:offer:'+offer().id));assert.equal(calls,1);assert(f.sent.at(-1).text.includes('Лампочка E27 9W 806lm / '+offer().name));assert(buttons(f).some(b=>b.callback_data==='offer:'+offer().id));
 await new Bot(f).handle(callback(5,'offer:'+offer().id));assert.equal(calls,1);assert(!f.sent.at(-1).text.includes('Лампочка E27 9W 806lm / '));await new Bot(f).handle(callback(5,'translate:offer:'+offer().id));assert.equal(calls,1);
});
test('translated results retain filters and pending basket target; stale buttons do not translate another search',async()=>{
 const f=await fixture();await publish(f,[offer()]);await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'лампочка E27',900);await f.store.patch(5,{query:'лампочка E27',searchRev:'abcdefg',offset:0,searchSource:offer().source,searchFilters:{socket:'E27'},cartTarget:'900-0'});let calls=0;f.fetch=async()=>{calls++;return translation;};
 await new Bot(f).handle(callback(5,'translate:results:abcdefg:0'));assert.equal(calls,1);assert.deepEqual((await f.store.user(5)).searchFilters,{socket:'E27'});assert.equal((await f.store.user(5)).cartTarget,'900-0');assert(f.sent.at(-1).text.includes('Лампочка E27 9W 806lm / '));
 await new Bot(f).handle(callback(5,'translate:results:abcdefg:0'));assert.equal(calls,1);assert(f.sent.at(-1).text.includes('Поиск уже изменился'));assert.equal((await cartItems(f.store,5))[0].product,null);
});
test('translation callbacks honor bans and per-user frequency limits',async()=>{
 const f=await fixture();await publish(f,[offer()]);await new Bot(f).handle(message(5,'/start'));let calls=0;f.fetch=async()=>{calls++;return translation;};for(let i=0;i<20;i++)await f.store.rate(5);
 await new Bot(f).handle(callback(5,'translate:offer:'+offer().id));assert.equal(calls,0);assert(f.sent.at(-1).text.includes('сек.'));
 await f.db.run("INSERT INTO sd_admin_records(kind,key,payload,at) VALUES('ban','6',:payload,0)",{':payload':JSON.stringify({active:true})});await new Bot(f).handle(callback(6,'translate:offer:'+offer().id));assert.equal(calls,0);
});
test('narrow network aggregation equals full search semantics including deduplication, dates and filters',async()=>{
 const f=await fixture();await publish(f,[offer(1,{regular:10000,terms:['sijalica','sijalice','led','e27']}),offer(2,{product:'local:'+'2'.repeat(32),regular:20000}),offer(3,{regular:1})]);
 await f.db.run("UPDATE sd_offers SET date='2000-01-01' WHERE id=:id",{':id':offer(3).id});
 for(const filters of [{},{socket:'E27'},{socket:'E14'},{brand:'Example'}]){
  const plan=await f.store.searchPlan('лампочка E27',Date.now(),null,filters),expected=await f.store.db.all(`WITH matches AS (${plan.sql}) SELECT source_id,source_name,MIN(price) AS min_price,MAX(price) AS max_price,COUNT(*) AS offers FROM matches GROUP BY source_id,source_name ORDER BY min_price,source_name LIMIT 100`,plan.params);
  assert.deepEqual(await f.store.searchChains('лампочка E27',Date.now(),filters),expected);
 }
 const rows=await f.store.searchChains('лампочка E27');assert.equal(rows[0].offers,2);assert.equal(rows[0].min_price,10000);assert.equal(rows[0].max_price,20000);
});
test('latency diagnostics contain fixed screen and numeric timings without search or identity',async()=>{
 const f=await fixture();await publish(f,[offer()]);await new Bot(f).handle(message(5,'/start'));const b=new Bot(f);b.uid=5;b.user=await f.store.user(5);b.allowAll=true;await b.search('лампочка E27');
 await new Bot(f).handle(callback(5,'offer:'+offer().id));const metric=await f.store.meta('ui_latency:card');assert(metric);assert(Object.values(metric).every(v=>typeof v==='number'));assert(!JSON.stringify(metric).includes(offer().name));
});

test('compact artwork remains decodable at the original dimensions and uses fewer upload bytes',async()=>{
 const {renderImage}=await import('../tgcloud/lib/image-renderer.js'),{default:jpeg}=await import('jpeg-js');
 const text='<b>Где купить: энергетик</b>\n\nМагазины: 7\nВыберите сеть ниже.\n\nДиапазон цен включает разные упаковки.',png=renderImage(text),photo=renderImage(text,{format:'jpeg'}),decoded=jpeg.decode(photo.bytes,{useTArray:true});
 assert.equal(decoded.width,png.width);assert.equal(decoded.height,png.height);assert(photo.bytes.length<png.bytes.length*.65);assert.deepEqual([...photo.bytes.slice(0,2)],[255,216]);
 // Foreground text retains strong contrast against the light paper background.
 let dark=0;for(let y=240;y<300;y++)for(let x=56;x<850;x++){const i=(y*decoded.width+x)*4;if(decoded.data[i]<80&&decoded.data[i+1]<100&&decoded.data[i+2]<120)dark++;}assert(dark>1000);
});
