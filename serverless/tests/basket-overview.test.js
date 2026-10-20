import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,message,callback} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {addList,cartItems} from '../tgcloud/lib/basket.js';
import {renderImage} from '../tgcloud/lib/image-renderer.js';
const buttons=f=>f.sent.at(-1).reply_markup.inline_keyboard.flat();

test('Russian plums and pesto match Serbian titles, without plum tomatoes or spirits',async()=>{
 const f=await fixture();await publish(f,[
  offer(1,{name:'Šljiva tamna 500g',terms:['sljiva','tamna','500g']}),
  offer(2,{name:'Sljiva 1kg',terms:['sljiva','1kg']}),
  offer(3,{name:'Paradajz sljivar roma 500g',terms:['paradajz','sljivar','roma','500g'],regular:1}),
  offer(4,{name:'Rakija sljiva 1l',terms:['rakija','sljiva','1l'],regular:1}),
  offer(5,{name:'Pesto sos Genovese 190g',terms:['pesto','sos','genovese','190g']}),
  offer(6,{name:'Pesto verde 190g',terms:['pesto','verde','190g']}),
  offer(7,{name:'Sos paradajz 200g',terms:['sos','paradajz','200g']}),
  offer(8,{name:'Kasica sljiva',terms:['kasica','sljiva'],regular:1}),
  offer(9,{name:'Pasteta pileca pesto 60g',terms:['pasteta','pileca','pesto','60g'],regular:1}),
  offer(10,{name:'Sos za testeninu pesto 190g',terms:['sos','za','testeninu','pesto','190g']})
 ]);
 for(const q of ['сливы','слива','сливу','sljiva','шљива']){const rows=await f.store.search(q);assert.equal(rows.length,2,q);}
 for(const q of ['песто','соус песто','песто соус','соуса песто'])assert.equal((await f.store.search(q)).length,3,q);
 assert.equal((await f.store.search('rakija sljiva')).length,1);assert.equal((await f.store.search('paradajz sljivar')).length,1);
});
test('initial comparison displays each requested item, its price or absence before entering a store',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Energetski napitak',terms:['energetski','napitak'],regular:10000}),offer(2,{name:'Mleko 1l',terms:['mleko','1l'],regular:15000})]);
 await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'энергетик, молоко × 2, сливы, соус песто',900);
 await new Bot(f).handle(callback(5,'basketcompare'));const text=f.sent.at(-1).text;
 assert(text.includes('энергетик × 1 — от 100,00 RSD'));assert(text.includes('молоко × 2 — от 300,00 RSD'));
 assert(text.includes('✕ сливы — не найдено'));assert(text.includes('✕ соус песто — не найдено'));assert(text.includes('Найденные товары:</b> от 400,00 RSD'));
 assert((await cartItems(f.store,5)).every(i=>i.product===null));assert(renderImage(text).height<1700);
});
test('every network including the sixth remains reachable; product paging preserves network page',async()=>{
 const f=await fixture();
 for(let i=1;i<=6;i++){
  const sid=i.toString(16).padStart(24,'0');await publish(f,[offer(i,{source:sid,name:'Mleko 1l',terms:['mleko','1l'],regular:i*10000})],i.toString(16).repeat(32));await f.db.run('UPDATE sd_sources SET name=:name WHERE id=:id',{':id':sid,':name':i===6?'Lidl':'Shop '+i});
 }
 await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'молоко, огурцы, курица, сливы, соус песто, кофе',901);
 await new Bot(f).handle(callback(5,'basketcompare'));assert(f.sent.at(-1).text.includes('Магазины 1–2 из 6'));
 assert(buttons(f).some(b=>b.callback_data==='basketoverview:2:0'));
 await new Bot(f).handle(callback(5,'basketoverview:2:0'));await new Bot(f).handle(callback(5,'basketoverview:4:0'));
 assert(f.sent.at(-1).text.includes('Lidl'));assert(buttons(f).some(b=>b.callback_data==='basketshop:'+('6'.padStart(24,'0'))+':0'));
 assert(buttons(f).some(b=>b.callback_data==='basketoverview:4:5'));
 await new Bot(f).handle(callback(5,'basketoverview:4:5'));assert(f.sent.at(-1).text.includes('Товары 6–6 из 6'));assert(f.sent.at(-1).text.includes('кофе — не найдено'));
 assert(buttons(f).some(b=>b.callback_data==='basketoverview:2:5'));assert(buttons(f).every(b=>!b.callback_data||b.callback_data.length<=64));
 await new Bot(f).handle(callback(6,'basketoverview:4:5'));assert(f.sent.at(-1).text.includes('пустая'));
});
test('pagination clamps stale pages after a basket is edited and all-missing queries remain visible',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'сливы, соус песто',902);
 await new Bot(f).handle(callback(5,'basketoverview:98:25'));const text=f.sent.at(-1).text;assert(text.includes('✕ сливы'));assert(text.includes('✕ соус песто'));
});
