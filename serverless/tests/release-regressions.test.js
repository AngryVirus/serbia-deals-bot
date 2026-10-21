import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {addOffer,cartItems,compareBasket} from '../tgcloud/lib/basket.js';
import {day,currentPrice,OWNER_ID} from '../tgcloud/lib/domain.js';
import {lockUser,unlockUser} from '../tgcloud/lib/moderation-state.js';
import {adTick} from '../tgcloud/lib/ads.js';
import {checkHealth} from '../tgcloud/lib/health.js';

test('watch limit reports honestly, keeps existing subscriptions and never exceeds 100 concurrently',async()=>{
 const f=await fixture(),offers=Array.from({length:102},(_,i)=>offer(i+1,{product:'gtin:'+String(i+1).padStart(14,'0')}));await publish(f,offers);await new Bot(f).handle(message(5,'/start'));for(const o of offers.slice(0,99))await f.store.watch(5,o.id);const concurrent=await Promise.allSettled(offers.slice(99,101).map(o=>f.store.watch(5,o.id)));assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.store.watches(5)).length,100);assert.equal(await f.store.watch(5,offers[0].id),true);
 await new Bot(f).handle(callback(5,'watch:'+offers[101].id));assert(f.sent.at(-1).text.includes('Лимит отслеживаний'));assert(!f.sent.at(-1).text.includes('Товар отслеживается'));assert(f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='watches'));assert.equal((await f.store.watches(5)).length,100);await new Bot(f).handle(callback(5,'watches:90'));const next=f.sent.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.callback_data==='watches:95');assert(next);await new Bot(f).handle(callback(5,next.callback_data));assert(f.sent.at(-1).text.includes('100.'));assert.equal(f.sent.at(-1).reply_markup.inline_keyboard.flat().filter(b=>b.callback_data.startsWith('remove:')).length,5);
});
test('watch handles a generation change between offer lookup and cheapest lookup',async()=>{
 const f=await fixture();await publish(f,[offer()]);f.store.cheapest=async()=>null;assert.equal(await f.store.watch(5,offer().id),false);assert.equal((await f.store.watches(5)).length,0);
});
test('saved local EAN8 choices and watches resolve current global identity without rewriting user data',async()=>{
 const f=await fixture(),old=offer(1,{product:'local:'+offer(1).id,barcode:'0000090493393'});await publish(f,[old]);await f.store.ensure(5);await addOffer(f.store,5,old);await f.store.watch(5,old.id);const before=await cartItems(f.store,5),watches=await f.store.watches(5),canonical='gtin:00000090493393';
 await publish(f,[{...old,product:canonical}],'c'.repeat(32));await publish(f,[offer(2,{source:'e'.repeat(24),product:canonical,barcode:old.barcode,regular:10000})],'d'.repeat(32));assert.equal((await f.store.cheapest(old.product)).price,10000);const result=await compareBasket(f.store,5);assert.equal(result.stores.length,2);assert.equal(result.bestSingle.total,10000);assert.equal(result.stores[0].items[0].match,'exact');assert.deepEqual(await cartItems(f.store,5),before);assert.deepEqual(await f.store.watches(5),watches);assert.equal(await f.store.watch(5,old.id),true);assert.equal((await f.store.watches(5)).length,1);assert.equal((await f.store.basketSelectedRows(6)).length,0);
});
test('local compatibility never guesses another missing SKU or merges retailer-internal products',async()=>{
 const f=await fixture(),a=offer(1,{product:'local:'+offer(1).id}),b=offer(2,{product:'local:'+offer(2).id});await publish(f,[a,b]);await addOffer(f.store,5,a);await publish(f,[b],'c'.repeat(32));assert.equal(await f.store.cheapest(a.product),undefined);assert.equal((await compareBasket(f.store,5)).stores.length,0);
});
test('disabling notifications cancels pending events but preserves uncertain receipts',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));for(const [state,product] of [['pending','p'],['uncertain','u']])await f.db.run('INSERT INTO sd_queue(uid,product,price,offer,state,created) VALUES(5,:product,1,\'{}\',:state,:now)',{':product':product,':state':state,':now':Date.now()});await new Bot(f).handle(callback(5,'notify:off'));assert.equal((await f.db.get("SELECT state FROM sd_queue WHERE product='p'")).state,'cancelled');assert.equal((await f.db.get("SELECT state FROM sd_queue WHERE product='u'")).state,'uncertain');await new Bot(f).handle(callback(5,'notify:on'));assert.equal((await f.db.get("SELECT state FROM sd_queue WHERE product='p'")).state,'cancelled');
});
test('health and ads use independent worker leases',async()=>{
 const f=await fixture();await f.store.setMeta('last_collection',Date.now());assert(await lockUser(f.store,-1,'health-held'));assert.equal((await adTick(f.store,f.api)).busy,undefined);await unlockUser(f.store,-1,'health-held');assert(await lockUser(f.store,-3,'ads-held'));assert.equal((await checkHealth(f.store,f.api)).busy,undefined);await unlockUser(f.store,-3,'ads-held');assert.equal(f.sent.length,0);
});
test('standard commands leave administrative reason input instead of being saved as a ban reason',async()=>{
 const f=await fixture();await new Bot(f).handle(message(OWNER_ID,'/start'));await f.store.patch(OWNER_ID,{adminInput:{kind:'reason',uid:5}});await new Bot(f).handle(message(OWNER_ID,'/help'));assert(f.sent.at(-1).text.includes('Как пользоваться'));assert.equal((await f.store.user(OWNER_ID)).adminInput,undefined);await f.store.patch(OWNER_ID,{adminInput:{kind:'reason',uid:5}});await new Bot(f).handle(message(OWNER_ID,'/delete'));assert(f.sent.at(-1).text.includes('Удалить данные?'));assert.equal((await f.store.user(OWNER_ID)).adminInput,undefined);assert.equal((await f.db.get("SELECT COUNT(*) AS n FROM sd_admin_records WHERE kind='ban'")).n,0);
});
test('future promotion activates by date in pure logic and SQL without a reimport',async()=>{
 const f=await fixture(),today=day(),tomorrow=day(Date.now()+86400000),end=day(Date.now()+2*86400000),o=offer(1,{discount:10000,begin:tomorrow,end});assert.equal(currentPrice(o,today),20000);assert.equal(currentPrice(o,tomorrow),10000);await publish(f,[o]);assert.equal((await f.store.offer(o.id)).price,20000);assert.equal((await f.store.offer(o.id,Date.now()+86400000)).price,10000);
});
