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
  const names=['lib/domain','lib/store','lib/ingest','lib/notifications','lib/manage','lib/image-codec','endpoints/manage'];
  const selected=Object.fromEntries(names.map(name=>[name,sources[name]]));
  result=(await client.runFunction(token,'endpoints/manage',selected,input.args,{ownerRun:true})).result;
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
 const message=String(error.description||error.message||'');
 const categories=[['sqlite_full',/SQLITE_FULL|database or disk is full|storage.{0,30}(quota|limit)/i],['pragma_restricted',/pragma/i],['execution_limit',/time.{0,20}(limit|out)|execution.{0,20}(limit|budget)|memory.{0,20}limit/i],['sql_error',/SQLITE_|SQL error|syntax error|no such (table|column)/i],['source_lease',/Source (busy|lease expired)|Publication lost lease/],['revision_review',/explicit revision review/]];
 const category=categories.find(([,pattern])=>pattern.test(message))?.[0]||'unclassified';
 process.stdout.write(JSON.stringify({ok:false,status:Number.isInteger(error.status)?error.status:null,retry_after:Number(error.parameters?.retry_after)||null,category,reason:'Management operation failed; private output withheld'}));process.exitCode=1;
}
