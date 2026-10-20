import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,sqlite,offer,publish,message,callback} from './fixtures.js';
import {Store} from '../tgcloud/lib/store.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {productNames} from '../tgcloud/lib/product-names.js';
import {addList,compareBasket,saveBasketFilters} from '../tgcloud/lib/basket.js';
const countDb=db=>{const counts={run:0,get:0,all:0};const measured=Object.fromEntries(Object.keys(counts).map(m=>[m,async(...a)=>{counts[m]++;return db[m](...a);} ]));return {counts,measured};};

test('a fresh invocation skips completed migrations but preserves audit retention',async()=>{
 const f=await fixture(),{counts,measured}=countDb(f.db);await new Store(measured).init();assert.equal(counts.get,1);assert.equal(counts.run,3);
 const tables=await f.db.all("SELECT name FROM sqlite_master WHERE type='table'");for(const name of ['sd_basket_reports','sd_panel_media','sd_product_names'])assert(tables.some(t=>t.name===name));
});
test('a failed migration is retried and concurrent initializers preserve existing data',async()=>{
 const db=sqlite();await db.run('CREATE TABLE sd_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');await db.run("INSERT INTO sd_meta VALUES('active','true')");
 const run=db.run;let fail=true;db.run=async(sql,p)=>{if(fail&&sql.includes('CREATE TABLE IF NOT EXISTS sd_panel_media')){fail=false;throw Error('interrupted');}return run(sql,p);};
 await assert.rejects(new Store(db).init(),/interrupted/);assert.equal(await new Store(db).meta('schema_version'),null);
 await Promise.all([new Store(db).init(),new Store(db).init()]);assert.equal(await new Store(db).meta('active'),true);assert.equal(await new Store(db).meta('schema_version'),2);
});
test('warm translations use one batched read and empty screens do not touch the cache',async()=>{
 const f=await fixture(),now=Date.now(),offers=[{name:'Mleko 1l'},{name:'Kafa 250g'},{name:'Voda 1l'}];
 for(const [i,o] of offers.entries())await f.db.run('INSERT INTO sd_product_names(name,ru,expires) VALUES(:name,:ru,:expiry)',{':name':o.name,':ru':['Молоко 1л','Кофе 250г','Вода 1л'][i],':expiry':now+60000});
 const {counts,measured}=countDb(f.store.db);measured.schemaReady=true;let requests=0;const store={db:measured};
 const names=await productNames(store,async()=>{requests++;throw Error('network must not be used');},offers,now);assert.equal(names.size,3);assert.deepEqual(counts,{run:0,get:0,all:1});assert.equal(requests,0);
 await productNames(store,null,[]);assert.deepEqual(counts,{run:0,get:0,all:1});
});
test('basket navigation reuses calculation and invalidates quantity, filters, generation and expiry',async()=>{
 const f=await fixture(),now=Date.now();await publish(f,[offer()]);await addList(f.store,5,'лампочка E27',900);let calls=0;const candidates=f.store.basketCandidates.bind(f.store);f.store.basketCandidates=async(...a)=>{calls++;return candidates(...a);};
 const first=await compareBasket(f.store,5,now);assert.equal(calls,1);assert.deepEqual(await compareBasket(f.store,5,now+1),first);assert.equal(calls,1);
 await f.db.run('UPDATE sd_basket SET quantity=2 WHERE uid=5');const two=await compareBasket(f.store,5,now+2);assert.equal(calls,2);assert.equal(two.stores[0].total,first.stores[0].total*2);
 await saveBasketFilters(f.store,5,'900-0',{socket:'E14'});assert.equal((await compareBasket(f.store,5,now+3)).stores.length,0);assert.equal(calls,3);
 await saveBasketFilters(f.store,5,'900-0',{});await publish(f,[offer(1,{regular:30000})],'c'.repeat(32));assert.equal((await compareBasket(f.store,5,now+4)).stores[0].total,60000);assert.equal(calls,4);
 await compareBasket(f.store,5,now+61000);assert.equal(calls,5);assert.equal((await compareBasket(f.store,6,now)).items.length,0);
 await f.store.deleteUser(5);assert.equal(await f.db.get('SELECT uid FROM sd_basket_reports WHERE uid=5'),undefined);
});
test('a cache outage still allows a fresh basket calculation',async()=>{
 const f=await fixture();await publish(f,[offer()]);await addList(f.store,5,'лампочка E27',900);const get=f.store.db.get,run=f.store.db.run;f.store.db.get=(sql,p)=>{if(sql.includes('sd_basket_reports'))throw Error('unavailable');return get(sql,p);};f.store.db.run=(sql,p)=>{if(sql.includes('sd_basket_reports'))throw Error('unavailable');return run(sql,p);};assert.equal((await compareBasket(f.store,5)).stores.length,1);
});
test('public menu artwork is reused without sharing another users permissions or private panels',async()=>{
 const f=await fixture();let uploads=0,files=0;f.InputFile=class{};f.api.sendPhoto=async p=>{if(typeof p.photo==='string')files++;else uploads++;f.sent.push(p);return {message_id:100+uploads+files,photo:[{file_id:'public-home-file'}]};};
 await new Bot(f).handle(message(340780041,'/start'));assert(f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='admin'));
 await new Bot(f).handle(message(5,'/start'));assert(!f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='admin'));assert.equal(uploads,1);assert.equal(files,1);
 const bot=new Bot(f);bot.uid=5;bot.user=await f.store.user(5);bot.freshPanel=true;await bot.panel('<b>Личная корзина</b>\nСекретная позиция');assert.equal(uploads,2);assert.equal((await f.db.get('SELECT COUNT(*) n FROM sd_panel_media')).n,1);
});
test('invalid Telegram file ID is rebuilt once, while uncertain cache delivery is never replayed',async()=>{
 const f=await fixture();f.InputFile=class{};let calls=0;f.api.sendPhoto=async p=>{calls++;if(typeof p.photo==='string')throw {code:400};return {message_id:100+calls,photo:[{file_id:'repaired'}]};};
 await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(message(5,'/menu'));assert.equal(calls,3);
 f.api.sendPhoto=async()=>{calls++;throw Error('timeout');};await assert.rejects(new Bot(f).handle(message(5,'/menu')),/timeout/);assert.equal(calls,4);
});
test('callback acknowledgement precedes database work and duplicate clicks stay idempotent',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));let acknowledged=false;f.api.answerCallbackQuery=async()=>{acknowledged=true;};const run=f.db.run;f.db.run=(sql,p)=>{assert(acknowledged);return run(sql,p);};const cb=callback(5,'help');await new Bot(f).handle(cb);const sent=f.sent.length;await new Bot(f).handle(cb);assert.equal(f.sent.length,sent);
});
