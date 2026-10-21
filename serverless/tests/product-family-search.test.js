import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish,source} from './fixtures.js';
import {normalize,queryGroups,shoppingLexicon,matchesSearchTerm,nonGrocerySources} from '../tgcloud/lib/domain.js';
import {addList,addOffer,cartItems} from '../tgcloud/lib/basket.js';
import {productIcon} from '../tgcloud/lib/shopping-ui.js';
import {matchesType} from '../tgcloud/lib/refinements.js';
import {fallbackName} from '../tgcloud/lib/product-names.js';

const product=(id,name)=>offer(id,{name,product:'local:'+String(id).padStart(32,'0'),terms:normalize(name).split(' ')});
async function names(f,query,filters={}){const p=await f.store.searchPlan(query,Date.now(),null,filters);return (await f.store.db.all(p.sql,p.params)).map(r=>JSON.parse(r.payload).name).sort();}

test('fish includes species without the word riba and excludes grated cabbage, cheese, scrubbers, tackle and pet food',async()=>{
 const f=await fixture(),fish=['Oslic filet 1kg','Tunjevina komadi 160g','Losos file 500g','Skusa zamrznuta 1kg','Sardina 125g','Pastrmka 500g','Riblji stapici 450g','Riba bela 1kg','Pangasius filet 500g','Saran 1kg','Som filet 1kg'];
 await publish(f,[...fish.map((n,i)=>product(i+1,n)),...['Kiseli kupus ribanac MK10 1000g','Sir ribani 100g','Cetka za ribanje','Ribarske udice riba','Hrana za macke riba 415g','Hrana Whiskas tunjevina','Riblje ulje kapsule','Somborska rakija 1l'].map((n,i)=>product(i+20,n))]);
 for(const q of ['рыба','рыбу','рыбы','riba','риба'])assert.deepEqual(await names(f,q),[...fish].sort(),q);
 assert.deepEqual(await names(f,'тунец'),['Tunjevina komadi 160g']);
 assert.equal((await f.store.searchChains('рыба'))[0].offers,fish.length);
 assert.deepEqual(await names(f,'корм тунец'),['Hrana Whiskas tunjevina']);
});

test('fish package filtering and basket candidates cannot return the reported one-kilo cabbage',async()=>{
 const f=await fixture(),cabbage=product(1,'Kiseli kupus ribanac MK10 1000g'),fish=product(2,'Oslic filet 1kg');
 await publish(f,[cabbage,fish,product(3,'Tunjevina 160g')]);
 const filters={pack:{kind:'weight',amount:1000}};
 assert.deepEqual(await names(f,'рыба',filters),[fish.name]);
 assert.equal((await f.store.searchChain('рыба',source,0,Date.now(),filters)).length,1);
 assert.deepEqual((await f.store.basketCandidates('рыба',Date.now(),filters)).map(r=>JSON.parse(r.payload).name),[fish.name]);
 await addList(f.store,5,'рыба',99);
 assert.equal(await addOffer(f.store,5,cabbage,'99-0'),false);
 assert.equal((await cartItems(f.store,5))[0].product,null);
 assert.equal(await addOffer(f.store,5,fish,'99-0'),true);
});

test('jelly, pomegranate, salt, cheese and cream do not match unrelated words with the same prefix',async()=>{
 const f=await fixture();await publish(f,[
  ...['Zele bombone 100g','Zelena paprika 1kg','Nar komad','Narandza 1kg','Sunka narezak 100g','So morska 1kg','Solid mazivo 200g','Sir trapist 1kg','Sira 200g','Sirce 1l','Sirup 1l','Krem cokoladni 200g','Kremanska rakija 1l'].map((n,i)=>product(i+1,n))
 ]);
 assert.deepEqual(await names(f,'мармелад'),['Zele bombone 100g']);
 assert.deepEqual(await names(f,'гранат'),['Nar komad']);
 assert.deepEqual(await names(f,'соль'),['So morska 1kg']);
 assert.deepEqual(await names(f,'сыр'),['Sir trapist 1kg','Sira 200g']);
 assert.deepEqual(await names(f,'крем'),['Krem cokoladni 200g']);
});

test('compound product names require every component: cashew, baking powder, parchment and contact lenses',async()=>{
 const f=await fixture();await publish(f,[
  ...['Indijski orah 200g','Indijska smokva 500g','Orah 200g','Prasak za pecivo 12g','Prasak za ves 1kg','Pecivo 100g','Papir za pecenje','Papir toaletni','Piletina za pecenje','Kontaktna sociva 2kom','Socivo crveno 500g'].map((n,i)=>product(i+1,n))
 ]);
 for(const [q,expected] of [['кешью','Indijski orah 200g'],['разрыхлитель','Prasak za pecivo 12g'],['пергамент','Papir za pecenje'],['линзы','Kontaktna sociva 2kom'],['чечевица','Socivo crveno 500g']])assert.deepEqual(await names(f,q),[expected],q);
});

test('tables, screws and tape do not become chairs, tablecloths, screwdrivers or tractors',async()=>{
 const f=await fixture();await publish(f,[...['Sto drveni','Stola drvenog','Stolica drvena','Stolnjak beli','Stopica 1kom','Sraf 10mm','Srafovi 20mm','Srafciger 10mm','Traka lepljiva','Traktor 1kom'].map((n,i)=>product(i+1,n))]);
 assert.deepEqual(await names(f,'стол'),['Sto drveni','Stola drvenog']);
 assert.deepEqual(await names(f,'шуруп'),['Sraf 10mm','Srafovi 20mm']);
 assert.deepEqual(await names(f,'скотч'),['Traka lepljiva']);
});

test('breast, ribs, neck and grains do not match vests, white wine, doors, ribbed pipes or KRUPS appliances',async()=>{
 const f=await fixture();await publish(f,[...['Pileca prsa 200g','Pilece belo meso 1kg','Prsluk beli','Vino belo 1l','Svinjski vrat 1kg','Vrata bela','Svinjska rebra 1kg','Crevo rebrasto','Pirinac 1kg','Ovsene pahuljice 500g','KRUPS aparat za kafu'].map((n,i)=>product(i+1,n))]);
 assert.deepEqual(await names(f,'грудка'),['Pileca prsa 200g','Pilece belo meso 1kg']);
 assert.deepEqual(await names(f,'куриная грудка'),['Pileca prsa 200g','Pilece belo meso 1kg']);
 assert.deepEqual(await names(f,'шея'),['Svinjski vrat 1kg']);
 assert.deepEqual(await names(f,'рёбра'),['Svinjska rebra 1kg']);
 assert.deepEqual(await names(f,'крупа'),['Ovsene pahuljice 500g','Pirinac 1kg']);
});

test('word boundaries also apply in category icons and refinement options',()=>{
 assert.equal(productIcon('Ribanac kiseli kupus 1kg'),'🥬');
 for(const name of ['рыба','Riba','Tunjevina 160g','Oslic filet','Som filet'])assert.equal(productIcon(name),'🐟',name);
 assert.equal(matchesType({name:'Prsluk'},['prs']),false);
 assert.equal(matchesType({name:'Pileca prsa'},['prs']),true);
 assert.equal(matchesSearchTerm('ribanac','riba'),false);
 assert.equal(matchesSearchTerm('ribe','riba'),true);
 assert.match(fallbackName('Tunjevina 160g'),/Тунец/);
 assert.match(fallbackName('Losos 500g'),/Лосось/);
 assert(!String(fallbackName('Ribanac')).includes('рыба'));
});

test('every exposed dictionary spelling keeps its canonical query groups, including basic vocabulary',()=>{
 const lexicon=shoppingLexicon();assert(lexicon.some(x=>x.query==='молоко'));assert(lexicon.some(x=>x.query==='рыба'));
 for(const row of lexicon)for(const form of row.forms)assert.deepEqual(queryGroups(form),queryGroups(row.query),form);
});

test('food intent excludes kitchen accessories while those accessories remain searchable explicitly',async()=>{
 const f=await fixture();await publish(f,[...['Sir trapist 200g','Rezac za sir','Jaja 10kom','Kuvalo za jaja','Svinjska rebra 1kg','Radijator 11 rebara','Keks soljeni 100g','Pasta za zube','Pasta testenina 500g'].map((n,i)=>product(i+1,n))]);
 assert.deepEqual(await names(f,'сыр'),['Sir trapist 200g']);
 assert.deepEqual(await names(f,'яйца'),['Jaja 10kom']);
 assert.deepEqual(await names(f,'рёбра'),['Svinjska rebra 1kg']);
 assert.deepEqual(await names(f,'печенье'),['Keks soljeni 100g']);
 assert.deepEqual(await names(f,'паста'),['Pasta testenina 500g']);
 assert.deepEqual(await names(f,'зубная паста'),['Pasta za zube']);
});

test('the reviewed hardware source stays searchable for tools but cannot supply a salt mill as salt',async()=>{
 const f=await fixture();await publish(f,[product(1,'So morska 1kg')]);
 await publish(f,[{...product(2,'Mlin za so 90g'),source:nonGrocerySources[0]},{...product(3,'Sijalica E27'),source:nonGrocerySources[0]}]);
 assert.deepEqual(await names(f,'соль'),['So morska 1kg']);
 assert.deepEqual(await names(f,'mlin za so'),['Mlin za so 90g']);
 assert.deepEqual(await names(f,'лампочка'),['Sijalica E27']);
});
