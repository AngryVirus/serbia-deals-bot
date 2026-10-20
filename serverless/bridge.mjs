// Private management credential remains in the process environment.
import {readFileSync,readdirSync} from 'node:fs';
import {relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
for(const key of ['TGCLOUD_DEBUG','TG_CLOUD_API_URL','TGCLOUD_BETA'])delete process.env[key];
const client=await import('./node_modules/@tgcloud/cli/src/api/endpoints.js');
const token=process.env.TGCLOUD_TOKEN;
try{
 if(!/^app\d+:[A-Za-z0-9_-]+$/.test(token||''))throw Error('Missing dedicated Cloud credential');
 const input=JSON.parse(readFileSync(0,'utf8')),root=fileURLToPath(new URL('./tgcloud/',import.meta.url)),sources={};
 const walk=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(entry.name.endsWith('.js'))sources[relative(root,path).slice(0,-3)]=readFileSync(path,'utf8');}};walk(root);
 let result;
 if(input.command==='run'){
  // Bulk ingestion never resends image/font assets to the management gateway.
  const names=['lib/domain','lib/product-names','lib/moderation-state','lib/basket','lib/store','lib/ingest','lib/notifications','lib/health','lib/manage','lib/image-codec','endpoints/manage'];
  const selected=Object.fromEntries(names.map(name=>[name,sources[name]]));
  result=(await client.runFunction(token,'endpoints/manage',selected,input.args,{ownerRun:true})).result;
 }else if(input.command==='moderation'){
  const names=['lib/domain','lib/store','lib/moderation-state','lib/moderation-notices','lib/image-codec','lib/image-fonts','lib/image-header','lib/image-renderer','endpoints/moderation'];
  const selected=Object.fromEntries(names.map(name=>[name,sources[name]]));
  result=(await client.runFunction(token,'endpoints/moderation',selected,input.args,{ownerRun:true})).result;
 }else if(input.command==='diagnose'){
  const routing=await client.getWebhook(token),remote=await client.getFiles(token);
  const text=String(routing.last_error_message||'');
  result={revision:remote.revision,routing:{in_sync:routing.in_sync,pending:routing.pending_update_count,last_error_date:routing.last_error_date||null,error_hints:['500','502','503','timeout','failed','error','limit','memory'].filter(word=>text.toLowerCase().includes(word))}};
  const probe=`import {api,db,fetch,InputFile} from 'sdk';
import {Bot} from '../lib/bot.js';
import {assertBot,OWNER_ID} from '../lib/domain.js';
import {Store} from '../lib/store.js';
import {adminRoute} from '../lib/admin.js';
import {cartItems} from '../lib/basket.js';
import {productNames} from '../lib/product-names.js';
import {buildRefinement,refinementFilters} from '../lib/refinements.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');
 await assertBot(api);
 let photoCalls=0,textCalls=0;
 const stub={sendPhoto:async()=>{photoCalls++;return {message_id:1};},sendMessage:async()=>{textCalls++;return {message_id:1};}};
 const bot=new Bot({db:{},api:stub,InputFile});bot.uid=OWNER_ID;bot.user={};bot.store.patch=async()=>{};
 const started=Date.now();await bot.home();const home={photoCalls,textCalls};
 bot.store=new Store(db);await bot.store.init();bot.store.patch=async()=>{};
 bot.user={};await adminRoute(bot,'admin');bot.user={};await adminRoute(bot,'admin:stats');
 const adminPhotos=photoCalls-home.photoCalls,adminTexts=textCalls-home.textCalls;
 bot.user={};await adminRoute(bot,'admin:sources');bot.user={};await adminRoute(bot,'admin:sources:1');
 const sourcePhotos=photoCalls-home.photoCalls-adminPhotos,sourceTexts=textCalls-home.textCalls-adminTexts;
 const beforePhotos=photoCalls,beforeTexts=textCalls;bot.store.rate=async()=>0;
 bot.user={};await bot.prompt();bot.user={};await bot.basket();bot.user={};await bot.notifications();
 const items=await cartItems(bot.store,OWNER_ID);if(items.length){bot.user={};await bot.basketItem(items[0].id);}
 const translationRequests=[];const translationFetch=async(...args)=>{try{const response=await fetch(...args);translationRequests.push({status:response.status,ok:Boolean(response.ok)});return response;}catch(error){const message=String(error.message||'').toLowerCase();translationRequests.push({failed:true,hints:['timeout','argument','options','allowed','host','denied','network','fetch','disabled','unsupported','function','undefined','not defined','invalid','http','budget','limit','quota','proxy','dns','resolve','certificate','ssl','tls','connect','owner','sandbox','safe','method','scope'].filter(word=>message.includes(word))});throw error;}};
 const chains=await bot.store.searchChains('огурцы');
 bot.user={};await bot.search('огурцы');
 if(chains.length){bot.user={};await bot.search('огурцы',0,chains[0].source_id);const offers=await bot.store.searchChain('огурцы',chains[0].source_id,0);if(offers.length){bot.user={};await bot.card(JSON.parse(offers[0].payload).id);}}
 bot.user={};await bot.comparison();
 const refinementChecks=[];
 for(const query of ['энергетик','мясо','молоко','кофе','шампунь','лампочка']){
  const samples=await bot.store.refinementSamples(query),draft=buildRefinement(query,samples.map(r=>JSON.parse(r.payload)),'probe');
  const check={query,samples:samples.length,facets:draft?.facets.map(f=>f.key)||[]};if(query==='энергетик')check.weight_options=draft?.facets.find(f=>f.key==='pack')?.values.filter(v=>v.value.kind==='weight').length||0;
  if(draft){bot.user={};await bot.refine(draft);for(const facet of draft.facets)if(facet.key==='brand')draft.selected[facet.key]=0;const narrowed=await bot.store.refinementSamples(query,Date.now(),refinementFilters(draft)),dependent=buildRefinement(query,narrowed.map(r=>JSON.parse(r.payload)),'dependent',Date.now(),true),pack=dependent?.facets.find(f=>f.key==='pack');if(pack){const original=draft.facets.find(f=>f.key==='pack');if(original){original.values=pack.values;draft.selected.pack=0;}}const filtered=await bot.store.searchChains(query,Date.now(),refinementFilters(draft));check.filtered_networks=filtered.length;}
  refinementChecks.push(check);
 }

 const names=await productNames(bot.store,translationFetch,[{name:'LED sijalica E27 9W 806lm'},{name:'Energetski napitak Red Bull 0,25l',brand:'Red Bull'}]);
 const translated=[...names.values()].filter(name=>!name.startsWith('Перевод недоступен')).length;
 return {refinements:refinementChecks,translations:{checked:names.size,translated,requests:translationRequests},...home,admin_photo_calls:adminPhotos,admin_text_calls:adminTexts,source_photo_calls:sourcePhotos,source_text_calls:sourceTexts,shopping_photo_calls:photoCalls-beforePhotos,shopping_text_calls:textCalls-beforeTexts,elapsed_ms:Date.now()-started};
}`;
  try{result.ui={ok:true,...(await client.runFunction(token,'endpoints/ui_probe',{...sources,'endpoints/ui_probe':probe},{},{ownerRun:true})).result};}
  catch(error){const detail=String(error.message||'')+' '+JSON.stringify(error.parameters||{});result.ui={ok:false,status:Number.isInteger(error.status)?error.status:null,hints:['time','limit','memory','source','size','module','parse','syntax','inputfile','function','png','invalid','cpu','heap','execution'].filter(word=>detail.toLowerCase().includes(word))};}
  const searchProbe=`import {api,db} from 'sdk';
import {Store} from '../lib/store.js';
import {assertBot} from '../lib/domain.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');await assertBot(api);const store=new Store(db),queries=[];
 for(const query of ['молотый кофе','кофе в зернах','куриное филе','зелёный чай','Энергетик монстр 0.5','курица','сливы','соус песто']){const rows=await store.search(query),check={query,matches:rows.length};if(['Энергетик монстр 0.5','курица'].includes(query)){const chains=await store.searchChains(query);check.networks=chains.length;check.products=chains.length?(await store.searchChain(query,chains[0].source_id)).length:0;}queries.push(check);}
 const patchProbe=await db.get("SELECT json_patch(json_remove(:payload,'$.searchFilters'),:fields) AS value",{':payload':JSON.stringify({query:'probe',searchFilters:{brand:'Old'}}),':fields':JSON.stringify({searchFilters:{}})});const topLevelReplace=JSON.parse(patchProbe.value).searchFilters.brand===undefined;
 return {top_level_replace:topLevelReplace,queries};
}`;
  try{result.search={ok:true,...(await client.runFunction(token,'endpoints/search_probe',{'lib/domain':sources['lib/domain'],'lib/store':sources['lib/store'],'endpoints/search_probe':searchProbe},{},{ownerRun:true})).result};}
  catch(error){const detail=String(error.message||'').toLowerCase();result.search={ok:false,status:Number.isInteger(error.status)?error.status:null,hints:['time','limit','memory','syntax'].filter(word=>detail.includes(word))};}
  const basketProbe=`import {api,db} from 'sdk';
import {Store} from '../lib/store.js';
import {compareBasket} from '../lib/basket.js';
import {basketNetworks} from '../lib/shopping-ui.js';
import {assertBot} from '../lib/domain.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');await assertBot(api);
 const items=['энергетик','молоко','сливы','соус песто'].map((query,i)=>({uid:-2,id:'probe-'+i,query,product:null,name:null,quantity:1}));
 const virtualDb={run:async()=>({rowsAffected:0}),get:(...args)=>db.get(...args),all:(sql,params)=>sql.startsWith('SELECT * FROM sd_basket WHERE uid=')?Promise.resolve(items):db.all(sql,params)};
 const report=await compareBasket(new Store(virtualDb),-2);
 return {items:items.length,networks:basketNetworks(report).map(s=>({name:s.chain,found:s.found,items:s.items.map(i=>({query:i.name,price:i.total})),missing:s.missing}))};
}`;
  try{result.basket={ok:true,...(await client.runFunction(token,'endpoints/basket_probe',{...Object.fromEntries(['lib/domain','lib/store','lib/basket','lib/shopping-ui','lib/product-names'].map(name=>[name,sources[name]])),'endpoints/basket_probe':basketProbe}, {},{ownerRun:true})).result};}
  catch(error){const detail=String(error.message||'').toLowerCase();result.basket={ok:false,hints:['time','limit','memory','syntax'].filter(word=>detail.includes(word))};}
  const handlerProbe=`import {api,db,InputFile} from 'sdk';
import {Bot} from '../lib/bot.js';
import {OWNER_ID,assertBot} from '../lib/domain.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');await assertBot(api);
 let phase='begin',panels=0,profileSql=0;
 const now=Date.now(),lease=await db.get('SELECT expires FROM sd_locks WHERE id=:uid',{':uid':OWNER_ID});
 const active=await db.get("SELECT value FROM sd_meta WHERE key='active'");
 const fakeDb={
  run:async(sql,params={})=>{phase=sql.startsWith('UPDATE sd_users SET payload=')?'profile_patch':sql.includes('sd_locks')?'lease':sql.includes('sd_updates')?'update_claim':'write';
   if(sql.startsWith('UPDATE sd_users SET payload=')){const expression=sql.slice(sql.indexOf('payload=')+8,sql.lastIndexOf(' WHERE'));await db.get('SELECT '+expression+' AS payload FROM sd_users WHERE id=:uid',params);profileSql++;}
   return {rowsAffected:1};},
  get:async(sql,params)=>{phase='read';return db.get(sql,params);},
  all:async(sql,params)=>{phase='read';return db.all(sql,params);}
 };
 const fakeApi={getMe:()=>api.getMe(),answerCallbackQuery:async()=>{},deleteMessage:async()=>{},sendMessage:async()=>{panels++;return {message_id:1};},sendPhoto:async()=>{panels++;return {message_id:1};},editMessageText:async p=>{panels++;return {message_id:p.message_id};},editMessageMedia:async p=>{panels++;return {message_id:p.message_id};}};
 try{await new Bot({db:fakeDb,api:fakeApi,InputFile}).handle({message:{message_id:2147000000,chat:{id:OWNER_ID,type:'private'},from:{id:OWNER_ID,first_name:'Owner'},text:'/start'}});return {ok:true,panels,profile_sql:profileSql,active:active?JSON.parse(active.value):null,lease_remaining:Math.max(0,(lease?.expires||0)-now)};}
 catch(error){const message=String(error.message||'').toLowerCase();return {ok:false,phase,panels,profile_sql:profileSql,hints:['sqlite','json','path','limit','argument','parameter','syntax','function','invalid','input','bind','column','table'].filter(word=>message.includes(word)),active:active?JSON.parse(active.value):null,lease_remaining:Math.max(0,(lease?.expires||0)-now)};}
}`;
  try{result.handler=(await client.runFunction(token,'endpoints/handler_probe',{...sources,'endpoints/handler_probe':handlerProbe},{},{ownerRun:true})).result;}
  catch(error){const detail=String(error.message||'').toLowerCase();result.handler={ok:false,status:Number.isInteger(error.status)?error.status:null,hints:['time','limit','memory','syntax'].filter(word=>detail.includes(word))};}
 }else if(input.command==='remote'){const r=await client.getFiles(token);result={revision:r.revision,canonical_modules:r.canonical_modules};}
 else if(input.command==='deploy'){
  const remote=await client.getFiles(token);
  if(Object.keys(remote.canonical_modules||{}).length&&input.expected_revision!==remote.revision)throw Error('Existing remote code requires explicit revision review');
  result=await client.batchDeploy(token,{expected_revision:remote.revision,manifest:Object.keys(sources),changed_sources:sources});
  result={revision:result.revision,modules:Object.keys(sources).length};
 }else if(input.command==='routing')result=await client.getWebhook(token);
 else if(input.command==='sync')result=await client.syncWebhook(token);
 else throw Error('Unsupported command');
 process.stdout.write(JSON.stringify({ok:true,result}));
}catch(error){
 const message=String(error.description||error.message||'')+' '+JSON.stringify(error.parameters||{}).replace(/[_-]/g,' ');
 const categories=[['sqlite_full',/SQLITE_FULL|database or disk is full|storage.{0,30}(quota|limit)/i],['pragma_restricted',/pragma/i],['execution_limit',/time.{0,20}(limit|out)|execution.{0,20}(limit|budget)|memory.{0,20}limit/i],['sql_error',/SQLITE_|SQL error|syntax error|no such (table|column)/i],['source_lease',/Source (busy|lease expired)|Publication lost lease/],['revision_review',/explicit revision review/]];
 const category=categories.find(([,pattern])=>pattern.test(message))?.[0]||'unclassified';
 const vocabulary=['database','quota','limit','size','disk','full','memory','timeout','execution','sql','sqlite','pragma','authorized','denied','syntax','column','table','request','payload','argument','module','invalid','unsupported','function','rate','maximum','rows','bytes','budget','read','only','statement','failed','step','steps','instruction','instructions','row','scanned','scan','exceeded','result','returned','output'];
 const hints=vocabulary.filter(word=>new RegExp('\\b'+word+'\\b','i').test(message));
 process.stdout.write(JSON.stringify({ok:false,status:Number.isInteger(error.status)?error.status:null,retry_after:Number(error.parameters?.retry_after)||null,category,hints,reason:'Management operation failed; private output withheld'}));process.exitCode=1;
}
