// Private management credential remains in the process environment.
import {readFileSync,readdirSync} from 'node:fs';
import {relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareModuleSources} from './deployment-state.mjs';
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
  const names=['lib/domain','lib/product-names','lib/moderation-state','lib/ads','lib/basket','lib/store','lib/ingest','lib/notifications','lib/health','lib/backup','lib/manage','lib/image-codec','endpoints/manage'];
  const selected=Object.fromEntries(names.map(name=>[name,sources[name]]));
  result=(await client.runFunction(token,'endpoints/manage',selected,input.args,{ownerRun:true})).result;
 }else if(input.command==='moderation'){
  const names=['lib/domain','lib/store','lib/moderation-state','lib/moderation-notices','lib/image-codec','lib/image-fonts','lib/image-header','lib/image-renderer','endpoints/moderation'];
  const selected=Object.fromEntries(names.map(name=>[name,sources[name]]));
  result=(await client.runFunction(token,'endpoints/moderation',selected,input.args,{ownerRun:true})).result;
 }else if(input.command==='diagnose'){
  const routing=await client.getWebhook(token),remote=await client.getFiles(token);
  const text=String(routing.last_error_message||'');
  result={revision:remote.revision,deployed:compareModuleSources(sources,remote.canonical_modules),routing:{in_sync:routing.in_sync,pending:routing.pending_update_count,last_error_date:routing.last_error_date||null,error_hints:['500','502','503','timeout','failed','error','limit','memory'].filter(word=>text.toLowerCase().includes(word))}};
  const probe=`import {api,db,fetch,InputFile} from 'sdk';
import {Bot} from '../lib/bot.js';
import {assertBot,OWNER_ID} from '../lib/domain.js';
import {Store} from '../lib/store.js';
import {adminRoute} from '../lib/admin.js';
import {adStatus} from '../lib/ads.js';
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
 bot.user={};await adminRoute(bot,'admin:sources');bot.user={};await adminRoute(bot,'admin:sources:1');bot.user={};await adminRoute(bot,'admin:quality');
 bot.user={};await adStatus(bot);
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
import {assertBot,normalize,matchesSearchTerm} from '../lib/domain.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');await assertBot(api);const store=new Store(db),queries=[];
 for(const query of [input.query]){const started=Date.now(),rows=await store.search(query),check={query,matches:rows.length,elapsed_ms:Date.now()-started};const chainStart=Date.now();check.network_count=(await store.searchChains(query)).length;check.networks_ms=Date.now()-chainStart;if(query==='питьевое молоко')check.refined_networks=(await store.searchChains('молоко',Date.now(),{type:['milkplain']})).length;if(['Энергетик монстр 0.5','курица'].includes(query)){const chains=await store.searchChains(query);check.networks=chains.length;check.products=chains.length?(await store.searchChain(query,chains[0].source_id)).length:0;}queries.push(check);}
 if(input.query==='рыба'){
  const cabbage=await db.get("SELECT o.id FROM sd_offers o JOIN sd_sources s ON s.id=o.source AND s.current_gen=o.gen WHERE lower(o.name) LIKE '%kupus%ribanac%' LIMIT 1");
  queries[0].reported_cabbage_found=Boolean(cabbage);
  queries[0].reported_cabbage_matches=cabbage?await store.matchesOffer('рыба',cabbage.id):false;
  if(queries[0].reported_cabbage_matches)throw Error('Unsafe fish match');
 }
 if(input.query==='курица'){
  const plan=await store.searchPlan('курица',Date.now(),null,{type:['prs']}),typed=await store.db.all(plan.sql,plan.params);
  queries[0].breast_filter_checked=typed.length;
  queries[0].breast_filter_invalid=typed.filter(r=>!normalize(JSON.parse(r.payload).name).split(' ').some(w=>matchesSearchTerm(w,'prs'))).length;
  if(queries[0].breast_filter_invalid)throw Error('Unsafe product type match');
  queries[0].empty_type_is_any=(await store.searchChains('курица',Date.now(),{type:[]})).length===queries[0].network_count;
  if(!queries[0].empty_type_is_any)throw Error('Invalid empty type filter');
 }
 const patchProbe=await db.get("SELECT json_patch(json_remove(:payload,'$.searchFilters'),:fields) AS value",{':payload':JSON.stringify({query:'probe',searchFilters:{brand:'Old'}}),':fields':JSON.stringify({searchFilters:{}})});const topLevelReplace=JSON.parse(patchProbe.value).searchFilters.brand===undefined;
 return {top_level_replace:topLevelReplace,queries};
}`;
  // Each family gets its own execution budget, just as separate user requests
  // do. Keep every scenario; a failed one still blocks the release.
  const searchQueries=['молотый кофе','кофе в зернах','куриное филе','зелёный чай','Энергетик монстр 0.5','курица','сливы','соус песто','питьевое молоко','рыба','рыба 1 кг'];
  result.search={ok:true,top_level_replace:true,queries:[]};
  for(const query of searchQueries){
   try{
    await new Promise(resolve=>setTimeout(resolve,2000));
    const checked=(await client.runFunction(token,'endpoints/search_probe',{'lib/domain':sources['lib/domain'],'lib/store':sources['lib/store'],'endpoints/search_probe':searchProbe},{query},{ownerRun:true})).result;
    if(checked?.top_level_replace!==true||checked?.queries?.length!==1||checked.queries[0].query!==query)throw Error('Invalid search probe result');
    result.search.queries.push(...checked.queries);
   }catch(error){const detail=(String(error.description||error.message||'')+' '+JSON.stringify(error.parameters||{})).toLowerCase();result.search={...result.search,ok:false,status:Number.isInteger(error.status)?error.status:null,hints:['time','limit','memory','syntax','column','table','json','function','parameter','module','unsupported','denied','quota','rate','argument','invalid','binding','budget','statement','interrupted','maximum','scope'].filter(word=>detail.includes(word)),failed_probe:searchQueries.indexOf(query)+1};break;}
  }
  const basketProbe=`import {api,db} from 'sdk';
import {Store} from '../lib/store.js';
import {compareBasket,saveBasketFilters,initBasket} from '../lib/basket.js';
import {basketNetworks} from '../lib/shopping-ui.js';
import {assertBot} from '../lib/domain.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');await assertBot(api);
 await initBasket(db);if((await db.get('SELECT COUNT(*) AS n FROM sd_basket WHERE uid=-2')).n)throw Error('Probe identity occupied');const saveGuard=!await saveBasketFilters(new Store(db),-2,'syntax-probe',{type:['milkplain']});
 let items=['энергетик','молоко','сливы','соус песто'].map((query,i)=>({uid:-2,id:'probe-'+i,query,product:null,name:null,quantity:1,filters:'{}'}));
 const virtualDb={run:async()=>({rowsAffected:0}),get:(...args)=>db.get(...args),all:(sql,params)=>sql.startsWith('SELECT b.*,COALESCE(f.payload,')?Promise.resolve(items):db.all(sql,params)};
 const publicStore=new Store(db),selectedSql=(await publicStore.basketSelectedRows(-2)).length===0,first=(await publicStore.search('энергетик'))[0],localIdentity=!first||Boolean(await publicStore.cheapest('local:'+JSON.parse(first.payload).id));
 const report=await compareBasket(new Store(virtualDb),-2);
 items=[{uid:-2,id:'filtered',query:'молоко',product:null,name:null,quantity:2,filters:JSON.stringify({type:['milkplain'],pack:{kind:'volume',amount:1000}})}];const filtered=await compareBasket(new Store(virtualDb),-2);
 items=[{uid:-2,id:'amount',query:'молоко 2 л',product:null,name:null,quantity:1,filters:JSON.stringify({type:['milkplain']})}];const quantityReport=await compareBasket(new Store(virtualDb),-2);
 return {selected_sql:selectedSql,local_identity_lookup:localIdentity,items:report.items.length,quantity_networks:basketNetworks(quantityReport).map(s=>({name:s.chain,complete:s.complete,quantity:s.items[0]?.quantity,demand:s.items[0]?.demand,pack:s.items[0]?.pack,supplied:s.items[0]?.supplied})),quantity_unresolved:quantityReport.unresolved.length,save_without_row_rejected:saveGuard,filtered_networks:basketNetworks(filtered).map(s=>({name:s.chain,found:s.found,variant:s.items[0]?.variant,unit_price:s.items[0]?.unitPrice})),plum_samples:(await new Store(virtualDb).basketCandidates('сливы')).map(r=>({store:r.source_name,name:JSON.parse(r.payload).name})),milk_samples:(await new Store(virtualDb).basketCandidates('молоко')).map(r=>({store:r.source_name,name:JSON.parse(r.payload).name})),networks:basketNetworks(report).map(s=>({name:s.chain,found:s.found,items:s.items.map(i=>({query:i.name,price:i.total,variant:i.variant,unit_price:i.unitPrice})),missing:s.missing}))};
}`;
  try{const checked=(await client.runFunction(token,'endpoints/basket_probe',{...Object.fromEntries(['lib/domain','lib/store','lib/basket','lib/shopping-ui','lib/product-names'].map(name=>[name,sources[name]])),'endpoints/basket_probe':basketProbe}, {},{ownerRun:true})).result;result.basket={ok:checked.selected_sql===true&&checked.local_identity_lookup===true&&checked.save_without_row_rejected===true,...checked};}
  catch(error){const detail=String(error.message||'').toLowerCase();result.basket={ok:false,hints:['time','limit','memory','syntax'].filter(word=>detail.includes(word))};}
  const languageProbe=`import {api,db,fetch} from 'sdk';
import {Store} from '../lib/store.js';
import {assertBot,unitPrice} from '../lib/domain.js';
import {productNames,bilingual,validTranslation} from '../lib/product-names.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');await assertBot(api);const store=new Store(db),queries=[];
 for(const query of ['пончик','петрушка','Donat Mg']){const rows=await store.search(query),networks=await store.searchChains(query);queries.push({query,networks:networks.length,examples:rows.slice(0,2).map(r=>{const o=JSON.parse(r.payload);return {name:o.name,unit_price:unitPrice(o)?.label||null};})});}
 const name='KEKS JAFFA KOLAČ DONAT CHOCO CREAM 75G',names=await productNames(store,fetch,[{name,brand:'JAFFA'}]);
 return {queries,translation:names.get(name),fallback:bilingual(null,name),rejects_wrong_unit:!validTranslation('Пончик 75 л','Donut 75g')};
}`;
  try{result.language={ok:true,...(await client.runFunction(token,'endpoints/language_probe',{...Object.fromEntries(['lib/domain','lib/store','lib/product-names'].map(name=>[name,sources[name]])),'endpoints/language_probe':languageProbe},{},{ownerRun:true})).result};}
  catch(error){const detail=String(error.message||'').toLowerCase();result.language={ok:false,hints:['time','limit','memory','syntax'].filter(word=>detail.includes(word))};}
  const speedProbe=`import {api,db} from 'sdk';
import {Store} from '../lib/store.js';
import {assertBot} from '../lib/domain.js';
import {productNames} from '../lib/product-names.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');
 const start=Date.now();await assertBot(api);const identityMs=Date.now()-start;
 const counts={run:0,get:0,all:0};const measured=Object.fromEntries(['run','get','all'].map(method=>[method,async(...args)=>{counts[method]++;return db[method](...args);}])) ;
 const initStart=Date.now();await new Store(measured).init();const initMs=Date.now()-initStart,initCalls={...counts};
 for(const k of Object.keys(counts))counts[k]=0;
 const repeatStart=Date.now(),store=new Store(measured);await store.init();const repeatMs=Date.now()-repeatStart,repeatCalls={...counts};
 for(const k of Object.keys(counts))counts[k]=0;
 const namesStart=Date.now();await productNames(store,null,[{name:'KEKS JAFFA KOLAČ DONAT CHOCO CREAM 75G'},{name:'LED sijalica E27 9W 806lm'},{name:'Energetski napitak Red Bull 0,25l'}]);
 return {identity_ms:identityMs,init_ms:initMs,init_calls:initCalls,repeat_init_ms:repeatMs,repeat_init_calls:repeatCalls,cached_names_ms:Date.now()-namesStart,cached_names_calls:{...counts},observed_screens:await Promise.all(['networks','products','card','other'].map(async screen=>({screen,timing:await store.meta('ui_latency:'+screen)})))};
}`;
  try{result.performance=(await client.runFunction(token,'endpoints/speed_probe',{...Object.fromEntries(['lib/domain','lib/store','lib/product-names'].map(name=>[name,sources[name]])),'endpoints/speed_probe':speedProbe},{},{ownerRun:true})).result;}
  catch{result.performance={ok:false};}
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
  const qualityProbe=`import {api,db} from 'sdk';
import {manage} from '../lib/manage.js';
import {Store} from '../lib/store.js';
import {packageMeasure,measurementIssue,assertBot,MEASURE_VERSION} from '../lib/domain.js';
export default async function(input,ctx){
 if(ctx?.ownerRun!==true)throw Error('Private probe only');await assertBot(api);
 let phase='source_list';
 const traced=Object.fromEntries(['run','all','get'].map(method=>[method,async(sql,params)=>{phase=sql.startsWith('INSERT INTO sd_offers')?'canonical_update':sql.startsWith('INSERT INTO sd_terms')?'index_update':sql.startsWith('UPDATE sd_meta')?'checkpoint':method;return db[method](sql,params);} ]));
 try{
 const store=new Store(db),sources=(await store.sources()).filter(s=>s.active);let target=sources[0];for(const source of sources){const quality=await store.meta('catalog_quality:'+source.id);if(quality?.gen!==source.current_gen||quality.version!==MEASURE_VERSION){target=source;break;}}const page=target?await manage({operation:'quality_page',source:target.id,pages:5},{ownerRun:true},{db:traced,api}):null;
 const invalidDrink=packageMeasure('Energetski napitak 200g')===null,invalidDonut=packageMeasure('Donut 1l')===null,powder=packageMeasure('Cedevita napitak 200g')?.kind==='weight',vessel=measurementIssue('Posuda 2l')==='capacity_or_specification';
 return {ok:invalidDrink&&invalidDonut&&powder&&vessel,page,invalid_drink:packageMeasure('Energetski napitak 200g')===null,invalid_donut:packageMeasure('Donut 1l')===null,powder_preserved:packageMeasure('Cedevita napitak 200g')?.kind==='weight',vessel_excluded:measurementIssue('Posuda 2l')==='capacity_or_specification'};
 }catch(error){const text=String(error.message||'')+' '+JSON.stringify(error.parameters||{});return {ok:false,phase,hints:['syntax','column','table','sqlite','json','limit','instruction','memory','unsupported','allowed','denied','permission','rowid','ambiguous','function','invalid','binding','parameter'].filter(word=>text.toLowerCase().includes(word))};}
}`;
  try{result.quality=(await client.runFunction(token,'endpoints/quality_probe',{...sources,'endpoints/quality_probe':qualityProbe},{},{ownerRun:true})).result;}
  catch(error){const detail=(String(error.message||'')+' '+JSON.stringify(error.parameters||{})).toLowerCase();result.quality={ok:false,status:Number.isInteger(error.status)?error.status:null,hints:['time','limit','memory','syntax','column','table','json','function','update','from'].filter(word=>detail.includes(word))};}
  try{result.advertising=(await client.runFunction(token,'endpoints/manage',sources,{operation:'ads_check'},{ownerRun:true})).result;}
  catch(error){const message=(String(error.description||error.message||'')+' '+JSON.stringify(error.parameters||{})).toLowerCase();result.advertising={ok:false,status:Number.isInteger(error.status)?error.status:null,hints:['syntax','column','table','sqlite','parameter','limit','module','unsupported','function','statement','write','read','only','allowed','denied','exceeded','rows','execution','invalid','constraint','binding'].filter(word=>message.includes(word))};}
 }else if(input.command==='remote'){const r=await client.getFiles(token);result={revision:r.revision,canonical_modules:r.canonical_modules};}
 else if(input.command==='deploy'){
  const remote=await client.getFiles(token);
  if(Object.keys(remote.canonical_modules||{}).length&&input.expected_revision!==remote.revision)throw Error('Existing remote code requires explicit revision review');
  const deployed=await client.batchDeploy(token,{expected_revision:remote.revision,manifest:Object.keys(sources),changed_sources:sources});
  const installed=await client.getFiles(token),comparison=compareModuleSources(sources,installed.canonical_modules);
  if(installed.revision!==deployed.revision||!comparison.matches_local)throw Error('Installed module verification failed');
  result={revision:installed.revision,modules:Object.keys(sources).length,verified:true};
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
