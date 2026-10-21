import test from 'node:test';
import assert from 'node:assert/strict';
import {storeLabel,storePriceLabel,productIcon} from '../tgcloud/lib/shopping-ui.js';
import {imageDocument,renderImage} from '../tgcloud/lib/image-renderer.js';
import {fixture,offer,publish,message,callback} from './fixtures.js';
import {Bot} from '../tgcloud/lib/bot.js';
import {addList,cartItems} from '../tgcloud/lib/basket.js';
const shops=[['METRO Cash&Carry doo Beograd','METRO'],['Aman d.o.o.','Aman'],['Lidl','Lidl'],['Delhaize / Maxi','Maxi'],['Gomex DOO','Gomex'],['Industrija mesa Matijević','Matijević'],['Lilly Drogerie','Lilly'],['Okov','Okov']];
test('short network labels preserve the entire price range and unknown stores remain distinguishable',()=>{
 for(const [name,label] of shops){assert.equal(storeLabel(name),label);assert.equal(storePriceLabel(name,8999,26999),label+' · 89,99–269,99 RSD');}
 const unknown='Совершенно новый магазин с длинным названием';assert.equal(storeLabel(unknown),unknown);const label=storePriceLabel(unknown,10900,126999);assert(label.startsWith('Соверш'));assert(label.includes('…'));assert(label.endsWith('109,00–1\u00a0269,99 RSD'));assert(label.length<=36);assert.equal(storePriceLabel('Lidl',8999,8999),'Lidl · 89,99 RSD');
});
test('category icons use Russian and Serbian aliases, distinguish flavours and handle ambiguous words conservatively',()=>{
 for(const [a,b,icon] of [['огурцы','Krastavac','🥬'],['петрушка','Peršun','🥬'],['молоко','Млеко 1l','🥛'],['курица','Pileća jetra','🥩'],['пончик','Krofna','🍪'],['шампунь','Šampon','🧴'],['порошок','Deterdzent za sudove','🧽'],['лампочка','Sijalica E27','💡'],['чайник','Kuvalo','🏠'],['рыба','Riba','🐟'],['кофе','Kafa','🛒']]){assert.equal(productIcon(a),icon,a);assert.equal(productIcon(b),icon,b);}
 assert.equal(productIcon('Чипсы со вкусом курицы'),'🍪');assert.equal(productIcon('корм для кошек с курицей'),'🐾');assert.equal(productIcon('Prasak za pecivo'),'🛒');assert.equal(productIcon('разрыхлитель'),'🛒');assert.equal(productIcon('Mleko za telo'),'🧴');assert.equal(productIcon('паста зубная'),'🧴');assert.equal(productIcon('фрукты и овощи'),'🥬');assert.equal(productIcon('Бытовая химия'),'🧽');assert.equal(productIcon('Red Bull'),'🥤');assert.equal(productIcon('неизвестная вещь'),'🛍️');
});
test('icons survive image rendering as local glyphs in headings and rows without adding boxes or dropping numbers',()=>{
 const html='<b>🥛 Молоко · 1 л</b>\n<b>Выберите магазин</b>\nДиапазон цен разных вариантов.',doc=imageDocument(html),image=renderImage(html,{format:'jpeg',compact:true});assert.equal(doc.titleIcon,'dairy');assert.equal(doc.title,'Молоко · 1 л');assert.equal(image.icons,1);assert(image.height<=550);const list=imageDocument('<b>Корзина</b>\n🥬 1. огурцы × 1\n🧽 2. порошок × 1');assert.equal(list.lines[0].icon,'produce');assert.equal(list.lines[1].icon,'cleaning');assert.equal(list.lines[0].text,'1. огурцы × 1');assert(!list.lines[0].text.includes('□'));
});
test('network buttons keep original source IDs and active filters while displaying compact prices',async()=>{
 const f=await fixture();await publish(f,[offer(1,{name:'Mleko 1l',brand:'',terms:['mleko','1l'],regular:8999}),offer(2,{name:'Mleko 1l premium',brand:'',terms:['mleko','1l','premium'],regular:26999})]);await f.db.run("UPDATE sd_sources SET name='Industrija mesa Matijević'");await new Bot(f).handle(message(5,'/start'));const bot=new Bot(f);bot.uid=5;await f.store.patch(5,{searchFilters:{pack:{kind:'volume',amount:1000}}});bot.user=await f.store.user(5);bot.allowAll=true;await bot.search('молоко');const panel=f.sent.at(-1),buttons=panel.reply_markup.inline_keyboard.flat(),chain=buttons.find(b=>b.callback_data.startsWith('chainsel:'));assert.equal(chain.text,'Matijević · 89,99–269,99 RSD');assert(chain.callback_data.includes(offer().source));assert(panel.text.includes('молоко · 1 л</b>'));assert(!panel.text.includes('На кнопках'));assert(buttons.some(b=>b.text==='🔎 Другой товар'&&b.callback_data==='search'));await new Bot(f).handle(callback(5,chain.callback_data));assert(f.sent.at(-1).text.startsWith('<b>Matijević</b>'));assert.equal((await f.store.user(5)).searchFilters.pack.amount,1000);assert.equal((await f.db.get('SELECT name FROM sd_sources')).name,'Industrija mesa Matijević');
});
test('basket icons do not change stored requests, quantities or item callbacks',async()=>{
 const f=await fixture();await new Bot(f).handle(message(5,'/start'));await addList(f.store,5,'огурцы, порошок × 2',701);const before=await cartItems(f.store,5);await new Bot(f).handle(callback(5,'basket'));const panel=f.sent.at(-1);assert(panel.text.includes('🥬 1. огурцы × 1'));assert(panel.text.includes('🧽 2. порошок × 2'));for(const item of before)assert(panel.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='cartitem:'+item.id));assert.deepEqual(await cartItems(f.store,5),before);
});
