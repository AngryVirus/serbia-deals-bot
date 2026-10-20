import {checkHealth} from './health.js';
import { Store } from './store.js';
import { cartItems,compareBasket } from './basket.js';
import { OWNER_ID,assertBot,requireValue } from './domain.js';
import { ingest } from './ingest.js';
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
export async function manage(input,ctx,{db,api}){
 requireValue(ctx?.ownerRun===true,'Management requires authenticated owner run');
 await assertBot(api);
 const store=new Store(db);await store.init();
 const operation=input?.operation;
 if(operation==='configure_commands')return configureCommands(api);
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
 if(operation==='basket_check'){
  const items=await cartItems(store,OWNER_ID),report=await compareBasket(store,OWNER_ID);
  return {items:report.items.length,stored_rows:items.length,pending:report.pending.length,stores:report.stores.length,complete_stores:report.stores.filter(s=>s.found===report.items.length).length,split_complete:report.split?.complete??null};
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
