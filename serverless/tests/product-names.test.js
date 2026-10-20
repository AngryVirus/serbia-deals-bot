import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback} from './fixtures.js';
import {productNames,validTranslation} from '../tgcloud/lib/product-names.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {basketSummary} from '../tgcloud/lib/shopping-ui.js';
const response=ru=>({ok:true,json:async()=>[[[ru]]]});
test('public product translation is cached across instances and preserves Serbian original, numbers and brand',async()=>{
 const f=await fixture(),o={name:'Energetski napitak Red Bull 0,25l',brand:'Red Bull'};let calls=0;
 const fetch=async url=>{calls++;assert(new URL(url).searchParams.get('q')===o.name);return response('Энергетический напиток 0,25л');};
 const first=await productNames(f.store,fetch,[o]);assert.equal(first.get(o.name),'Red Bull Энергетический напиток 0,25л / '+o.name);await productNames(f.store,fetch,[o]);assert.equal(calls,1);
});
test('parallel readers make one translation request for an identical public title',async()=>{
 const f=await fixture(),o={name:'Mleko 1l'};let calls=0,release;const wait=new Promise(r=>release=r);const fetch=async()=>{calls++;await wait;return response('Молоко 1л');};const a=productNames(f.store,fetch,[o]);await new Promise(r=>setImmediate(r));const b=productNames(f.store,fetch,[o]);await new Promise(r=>setImmediate(r));release();await Promise.all([a,b]);assert.equal(calls,1);
});
test('translation failure keeps the original usable, backs off, and never invents packaging',async()=>{
 const f=await fixture(),o={name:'Sijalica E27 9W'};let calls=0;const fetch=async()=>{calls++;return response('Лампочка E14 5Вт');};const names=await productNames(f.store,fetch,[o],1000);assert.equal(names.get(o.name),'Перевод недоступен / '+o.name);await productNames(f.store,fetch,[o],2000);assert.equal(calls,2);assert(!validTranslation('<b>Товар</b>',o.name));assert(validTranslation('Лампочка E27 9Вт',o.name));
});
test('external quota failure pauses requests globally and local common names still work',async()=>{
 const f=await fixture();let calls=0;const fetch=async()=>{calls++;return {ok:false,status:429};};await productNames(f.store,fetch,[{name:'Sijalica E27'}],1000);const names=await productNames(f.store,fetch,[{name:'Sijalica E14'},{name:'Krastavac'}],2000);assert.equal(calls,2);assert.equal(names.get('Krastavac'),'Огурец / Krastavac');
});
test('private search and unresolved basket input are not submitted to a translation service',async()=>{
 const f=await fixture();let calls=0;f.fetch=async()=>{calls++;return response('Товар');};await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(message(5,'личный секретный запрос'));await new Bot(f).handle(callback(5,'basketinput'));await new Bot(f).handle(message(5,'мой личный товар'));await new Bot(f).handle(callback(5,'cartitem:'+(await f.db.get('SELECT id FROM sd_basket WHERE uid=5')).id));assert.equal(calls,0);
});
test('explicit card translation displays Russian then Serbian without changing identity',async()=>{
 const f=await fixture();await publish(f,[offer()]);f.fetch=async()=>response('Светодиодная лампочка E27 9W 806lm');await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(callback(5,'translate:offer:'+offer().id));assert(f.sent.at(-1).text.includes('Светодиодная лампочка E27 9W 806lm / LED sijalica'));assert(f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='basketadd:'+offer().id+':'));
});
test('compact basket comparison labels partial prices and provides optional item detail',async()=>{
 const result={items:[{id:'1',query:'молоко'},{id:'2',query:'сливы'}],estimated:true,stores:[{source:'a',chain:'Полный',name:'Полный',found:2,total:10000,items:[{id:'1',quantity:1,total:5000,estimated:true},{id:'2',quantity:1,total:5000,estimated:true}]},{source:'b',chain:'Частичный',name:'Частичный',found:1,total:100,items:[{id:'1',quantity:1,total:100,estimated:true}]}]};const text=basketSummary(result);assert(text.includes('Весь список'));assert(text.includes('Только 1 из 2'));assert(text.includes('упаковка могут различаться'));
});
test('a failed primary service falls back to a valid free translation and caches it',async()=>{
 const f=await fixture();let calls=0;const fetch=async url=>{calls++;if(url.startsWith('https://translate.googleapis.com/'))throw Error('Unavailable');return {ok:true,json:async()=>({responseStatus:200,responseData:{translatedText:'Лампочка E27 9W'}})};};const name='Sijalica E27 9W';const names=await productNames(f.store,fetch,[{name}]);assert.equal(names.get(name),'Лампочка E27 9W / '+name);await productNames(f.store,fetch,[{name}]);assert.equal(calls,2);
});
test('long product names keep both languages and packaging suffixes in compact lists',async()=>{
 const {briefName}=await import('../tgcloud/lib/product-names.js');const name='Русское '.repeat(30)+'500 г / '+'Srpsko '.repeat(30)+'500g',short=briefName(name);assert(short.includes(' / '));assert(short.includes('500 г'));assert(short.endsWith('500g'));assert(short.length<190);
});
test('new shop and split screens remain scoped to the requesting basket',async()=>{
 const f=await fixture();await publish(f,[offer()]);await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(callback(5,'basketadd:'+offer().id+':'));await new Bot(f).handle(callback(5,'basketcompare'));const shop=f.sent.at(-1).reply_markup.inline_keyboard.flat().find(b=>b.callback_data.startsWith('basketshop:'));assert(shop);await new Bot(f).handle(callback(5,shop.callback_data));assert(f.sent.at(-1).text.includes('Итого:'));await new Bot(f).handle(callback(6,shop.callback_data));assert(f.sent.at(-1).text.includes('Корзина пока пустая'));
});
test('a translation cache failure cannot take down the product screen',async()=>{
 const f=await fixture();await publish(f,[offer()]);await new Bot(f).handle(message(5,'/start'));const run=f.db.run;f.db.run=(sql,p)=>{if(sql.includes('sd_product_names'))throw Error('Cache storage unavailable');return run(sql,p);};await new Bot(f).handle(callback(5,'offer:'+offer().id));assert(f.sent.at(-1).text.includes(offer().name));assert(f.sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data.startsWith('basketadd:')));
});
