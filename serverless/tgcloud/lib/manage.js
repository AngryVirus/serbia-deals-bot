import {checkHealth} from './health.js';
import {adTick,checkAds} from './ads.js';
import { Store } from './store.js';
import { cartItems,compareBasket } from './basket.js';
import { OWNER_ID,assertBot,requireValue,emptyQuality,auditOffer,MEASURE_VERSION } from './domain.js';
import { ingest,indexMeasures } from './ingest.js';
import { prepareNotifications,deliverNotifications } from './notifications.js';
import { unzlibSync } from './image-codec.js';
const COMMANDS=[{command:'start',description:'Начать работу'},{command:'menu',description:'Главное меню'},{command:'help',description:'Помощь'}];
async function configureCommands(api){
 let scopes=0;
 for(const type of ['default','all_private_chats'])for(const language_code of ['', 'ru']){
  const target={scope:{type},language_code};
  requireValue(await api.setMyCommands({...target,commands:COMMANDS})===true,'Command registration unconfirmed');
  const saved=await api.getMyCommands(target);
  requireValue(Array.isArray(saved)&&JSON.stringify(saved.map(c=>({command:c.command,description:c.description})))===JSON.stringify(COMMANDS),'Command verification failed');scopes++;
 }
 requireValue(await api.setChatMenuButton({menu_button:{type:'commands'}})===true,'Menu button unconfirmed');
 requireValue((await api.getChatMenuButton({}))?.type==='commands','Menu button verification failed');
 return {commands:COMMANDS.map(c=>c.command),scopes,button:'commands'};
}
async function qualityPage(store,db,sourceId){
  const source=await db.get('SELECT current_gen,date FROM sd_sources WHERE id=:source',{':source':sourceId});if(!source?.current_gen)return {skipped:true};
  const key='quality_scan:'+sourceId,summaryKey='catalog_quality:'+sourceId,current=await store.meta(summaryKey);
  if(current?.gen===source.current_gen&&current.version===MEASURE_VERSION&&current.offers>0)return {done:true,offers:current.offers};
  await db.run("INSERT INTO sd_meta(key,value) VALUES(:key,'null') ON CONFLICT DO NOTHING",{':key':key});
  const old=await store.meta(key),next=old?.gen===source.current_gen&&old.version===MEASURE_VERSION?{...old,quality:{...old.quality,examples:[...old.quality.examples]}}:{gen:source.current_gen,version:MEASURE_VERSION,after:'',quality:emptyQuality()};
  const readStart=Date.now();
  const rows=await db.all('SELECT id,payload FROM sd_offers WHERE source=:source AND gen=:gen AND id>:after ORDER BY id LIMIT 500',{':source':sourceId,':gen':source.current_gen,':after':next.after});
  const readDone=Date.now();
  for(const row of rows){auditOffer(next.quality,JSON.parse(row.payload));next.after=row.id;}
  const analyzed=Date.now(),indexTime=await indexMeasures(db,sourceId,source.current_gen,rows.map(row=>JSON.parse(row.payload))),timing={read_ms:readDone-readStart,analyze_ms:analyzed-readDone,...indexTime};
  const live=await db.get('SELECT current_gen FROM sd_sources WHERE id=:source',{':source':sourceId});if(live.current_gen!==next.gen)return {changed:true};
  const saved=await db.run('UPDATE sd_meta SET value=:next WHERE key=:key AND value=:old',{':key':key,':next':JSON.stringify(next),':old':JSON.stringify(old)});if(saved.rowsAffected!==1)return {busy:true};
  if(rows.length===500)return {more:true,offers:next.quality.offers,timing};
  await store.setMeta(summaryKey,{gen:next.gen,date:source.date,checked:Date.now(),version:MEASURE_VERSION,...next.quality,coverage_drop:false});
  await db.run('DELETE FROM sd_meta WHERE key=:key AND value=:next',{':key':key,':next':JSON.stringify(next)});return {done:true,offers:next.quality.offers,timing};
}
export async function manage(input,ctx,{db,api}){
 requireValue(ctx?.ownerRun===true,'Management requires authenticated owner run');
 await assertBot(api);
 const store=new Store(db);await store.init();
 const operation=input?.operation;
 if(operation==='configure_commands')return configureCommands(api);
 if(operation==='ads_tick')return adTick(store,api);
 if(operation==='ads_check')return checkAds(store);
 if(operation==='init'){if(await store.meta('active')===null)await store.setMeta('active',false);return {ready:true,active:await store.meta('active')};}
 if(operation==='notices_due'){const row=await store.db.get("SELECT COUNT(*) AS count FROM sd_admin_records r JOIN sd_users u ON CAST(u.id AS TEXT)=r.key WHERE r.kind IN ('ban','role') AND json_extract(r.payload,'$.notice')='pending' AND COALESCE(json_extract(r.payload,'$.retry'),0)<=:now",{':now':Date.now()});return {due:row.count};}
 if(operation==='status'){
  const sources=await store.sources(),queue=await db.all('SELECT state,COUNT(*) AS count FROM sd_queue GROUP BY state');
  let offers=0;
  for(const source of sources.filter(s=>s.active)){
   const cached=await store.meta('catalog_count:'+source.id+':'+source.current_gen);
   const count=cached??(await db.get('SELECT COUNT(*) AS n FROM sd_offers WHERE source=:source AND gen=(SELECT current_gen FROM sd_sources WHERE id=:source)',{':source':source.id})).n;
   offers+=count;
  }
  const catalog={offers};
  let storage=null;
  try{
   const pages=await db.get('PRAGMA page_count'),size=await db.get('PRAGMA page_size');
   if(Number.isSafeInteger(pages?.page_count)&&Number.isSafeInteger(size?.page_size))storage={bytes:pages.page_count*size.page_size};
  }catch{/* Some hosted SQLite environments restrict PRAGMA inspection. */}
  return {active:await store.meta('active'),sources,queue,catalog,storage,last_collection:await store.meta('last_collection')};
 }
 if(operation==='source_audit'){
  requireValue(/^[a-f0-9]{24}$/.test(input.source||'')&&/^[a-f0-9]{32}$/.test(input.gen||''));
  const stats={};for(const key of ['rows','accepted','rejected','conflicts','duplicates']){const n=input.stats?.[key];requireValue(Number.isSafeInteger(n)&&n>=0&&n<=10000000);stats[key]=n;}
  const source=await db.get('SELECT current_gen FROM sd_sources WHERE id=:source',{':source':input.source});
  if(source?.current_gen!==input.gen)return {changed:true};
  await store.setMeta('catalog_parse:'+input.source,{gen:input.gen,...stats});return {saved:true};
 }
 if(operation==='quality_page'){
  const pages=input.pages??1;requireValue(/^[a-f0-9]{24}$/.test(input.source||'')&&Number.isInteger(pages)&&pages>=1&&pages<=5);
  let result;for(let page=0;page<pages;page++){result=await qualityPage(store,db,input.source);if(!result.more)return {...result,pages:page+1};}
  return {...result,pages};
 }
 if(operation==='basket_check'){
  const items=await cartItems(store,OWNER_ID),report=await compareBasket(store,OWNER_ID);
  return {items:report.items.length,stored_rows:items.length,pending:report.pending.length,stores:report.stores.length,complete_stores:report.stores.filter(s=>s.complete===true).length,needs_choice:report.unresolved?.length||0,split_complete:report.split?.complete??null};
 }
 if(operation==='search_check'){
  requireValue(typeof input.query==='string'&&input.query.length<=120);
  const started=Date.now(),rows=await store.search(input.query),chains=await store.searchChains(input.query),inside=chains.length?await store.searchChain(input.query,chains[0].source_id):[];
  return {query:input.query,returned:rows.length,networks:chains.map(c=>({name:c.source_name,min:c.min_price,max:c.max_price})),chain_products:inside.length,elapsed_ms:Date.now()-started,sample:rows.slice(0,3).map(row=>({name:JSON.parse(row.payload).name,store:JSON.parse(row.payload).format,price:row.price}))};
 }
 if(operation==='activate'){requireValue(input.confirm_username==='SerbiaDealsBot');await store.setMeta('active',true);return {active:true};}
 if(operation==='pause'){await store.setMeta('active',false);return {active:false};}
 if(operation==='register_sources'){
  requireValue(Array.isArray(input.rows)&&input.rows.length<=100);
  for(const row of input.rows){requireValue(/^[a-f0-9]{24}$/.test(row.id)&&typeof row.name==='string'&&row.name.length<=160);await db.run(`INSERT INTO sd_sources(id,name,url) VALUES(:id,:name,:url) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url`,{':id':row.id,':name':row.name,':url':`https://data.gov.rs/sr/datasets/${row.id}/`});}
  if(input.expected===true)await store.setMeta('expected_sources',input.rows.map(row=>row.id).sort());
  return {registered:input.rows.length};
 }
 if(operation==='source_failure'){
  requireValue(/^[a-f0-9]{24}$/.test(input.source||''));
  await db.run("UPDATE sd_sources SET status='unavailable',checked=:now WHERE id=:source",{':source':input.source,':now':Date.now()});return {recorded:true};
 }
 if(operation==='chunk'&&input.packed){
  requireValue(typeof input.packed==='string'&&input.packed.length<=110000&&/^[A-Za-z0-9+/]*={0,2}$/.test(input.packed));
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[];let bits=0,n=0;
  for(const c of input.packed){const v=alphabet.indexOf(c);if(v<0)continue;bits=(bits<<6)|v;n+=6;if(n>=8){n-=8;out.push((bits>>>n)&255);}}
  const raw=unzlibSync(new Uint8Array(out));requireValue(raw.length<1200000);
  input={...input,rows:JSON.parse(decodeURIComponent(Array.from(raw,b=>'%'+b.toString(16).padStart(2,'0')).join('')))};
 }
 if(['begin','chunk','finish','cleanup'].includes(operation))return ingest(store,input);
 if(operation==='collection_complete'){requireValue(Number.isInteger(input.successful)&&input.successful>0);await store.setMeta('last_collection',Date.now());return {saved:true};}
 if(operation==='prepare_notifications')return prepareNotifications(store);
 if(operation==='deliver_notifications'){if(await store.meta('active')!==true)return {paused:true};return deliverNotifications(store,api);}
 if(operation==='health')return checkHealth(store,api);
 throw Error('Unsupported management operation');
}
