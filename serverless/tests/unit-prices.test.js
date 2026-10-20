import test from 'node:test';
import assert from 'node:assert/strict';
import {packageMeasure,unitPrice,day} from '../tgcloud/lib/domain.js';
import {fixture,offer,publish,message,callback,source} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {addList,compareBasket} from '../tgcloud/lib/basket.js';

test('unit prices compare 200g and 1kg rather than their cash totals, and use active discounted price',()=>{
 const small=offer(1,{name:'Kafa 200g',regular:10000}),big=offer(2,{name:'Kafa 1kg',regular:40000});assert.equal(unitPrice(small).price,50000);assert.equal(unitPrice(big).price,40000);
 const promo={...small,discount:8000,begin:day(),end:day()};assert.equal(unitPrice(promo).price,40000);
});
test('volume equivalents and explicit multipacks have correct denominators without multiplying stock codes',()=>{
 for(const title of ['Energy 500ml','Energy 0,5l','Energy 50cl'])assert.equal(unitPrice({name:title},10000).price,20000,title);
 assert.equal(unitPrice({name:'Milk 6x250ml'},30000).price,20000);assert.equal(unitPrice({name:'Milk 250ml x 6'},30000).price,20000);
 assert.equal(unitPrice({name:'Milk MK24 250ml'},10000).price,40000);
});
test('unknown, mixed and contradictory sizes do not produce invented unit prices',()=>{
 for(const title of ['Krastavac komad','Product 200g 300g','Milk 500ml + 200ml','Product 500g 1l','Donut 75ml','Solja Donut 440ml','Posuda za mleko 500ml'])assert.equal(unitPrice({name:title},10000),null,title);
 assert.equal(unitPrice({name:'Kafa 100g'},Number.MAX_SAFE_INTEGER),null);
});
test('donut metadata in liters does not override its actual solid package and repeated source sizes are deduplicated',()=>{
 assert.deepEqual(packageMeasure('Donut 75g'),{kind:'weight',amount:75});assert.equal(unitPrice({name:'Donut 75g',unit:'lit'},7500).label,'1 000,00 RSD/кг');
 assert.equal(packageMeasure('Persun 400g 400g').amount,400);assert.equal(packageMeasure('Persun 7gr').amount,7);assert.equal(packageMeasure('Петрушка 7 гр.').amount,7);
});
test('unit price is visible in the product card and initial basket comparison without selecting an offer',async()=>{
 const f=await fixture(),o=offer(1,{name:'Kafa 200g',terms:['kafa','200g'],regular:10000});await publish(f,[o]);await new Bot(f).handle(message(5,'/start'));await new Bot(f).handle(callback(5,'offer:'+o.id));assert(f.sent.at(-1).text.includes('500,00 RSD/кг'));
 await addList(f.store,5,'кофе',900);await new Bot(f).handle(callback(5,'basketcompare'));assert(f.sent.at(-1).text.includes('500,00 RSD/кг'));assert.equal((await compareBasket(f.store,5)).stores[0].total,10000);
});
