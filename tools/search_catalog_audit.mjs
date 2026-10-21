// Offline, public catalogues only. Never imports SDK or changes a live database.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../serverless/tgcloud/lib/store.js';
import {ingest} from '../serverless/tgcloud/lib/ingest.js';
import {shoppingLexicon,queryGroups,groceryQuery,normalize,day,measurementIssue} from '../serverless/tgcloud/lib/domain.js';
import {productIcon} from '../serverless/tgcloud/lib/shopping-ui.js';
import {buildRefinement,matchesType} from '../serverless/tgcloud/lib/refinements.js';
const [input='work/family-audit-catalogue.json',output='work/product-search-audit.json',database='work/product-search-audit.sqlite',mode]=process.argv.slice(2),reuse=mode==='--reuse';
if(existsSync(database)&&!reuse)throw Error('Use a new disposable public audit database');
const data=JSON.parse(readFileSync(input,'utf8')),connection=new DatabaseSync(database,{readOnly:reuse});
if(!reuse)connection.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF');
const db={async run(sql,p={}){return {rowsAffected:Number(connection.prepare(sql).run(p).changes)};},async get(sql,p={}){return connection.prepare(sql).get(p);},async all(sql,p={}){return connection.prepare(sql).all(p);}},store=new Store(db);
const report={date:day(),offers:0,sources:[],dictionary_entries:0,forms_checked:0,spelling_mismatches:[],queries:[],controls:{},violations:[],wrong_dimension_titles:0};
// These independent known-negative controls are also checked against EVERY
// result, not merely the cheapest six cards. Broad terms can have several
// legitimate uses; only reviewed, unambiguous mistakes are treated as failures.
const controls={
 'рыба':/\b(?:ribanac|ribanje|ribani|ribana|ribars[a-z]*|ribolov[a-z]*|hrana|whiskas|kitekat|pedigree|akvar[a-z]*|omega|kapsul[a-z]*)\b/,
 'гранат':/\b(?:narand[a-z]*|narez[a-z]*|narukv[a-z]*)\b/,
 'мармелад':/\b(?:zelena|zeleni|zelene|zeleno|zelenim)\b/,
 'стол':/\b(?:stolica|stolice|stolnjak|stolnjaci|stopica|story)\b/,
 'шуруп':/\bsrafciger[a-z]*\b/,
 'крупа':/\b(?:krups|krupnik)\b/,
 'рёбра':/\b(?:rebrasti|rebrasto|rebrasta|rebraste)\b/,
 'грудка':/\b(?:prsluk|prskalica)\b/,
 'шея':/\b(?:vrata|vratanca|vratnice)\b/,
 'квас':/\bkvasac\b/
};
const nonfoodObjects=/\b(?:noz|nozevi|nozeva|viljuska|viljuske|kuvalo|radijator|grejalica|mesoreznica|pekac|posuda|drzac|aparat|termometar|stolnjak|posteljina|tapeta)\b/;
try{
 if(!reuse)await store.init();
 for(const [index,[alias,{offers}]] of Object.entries(data).entries()){
  if(!offers.length)continue;
  const context={source:offers[0].source,gen:(index+1).toString(16).padStart(32,'0'),owner:'11111111-1111-4111-8111-111111111111'},chunks=Math.ceil(offers.length/500);
  if(!reuse){
   await ingest(store,{operation:'begin',...context,name:alias,url:`https://data.gov.rs/sr/datasets/${context.source}/`,date:day(),chunks});
   for(let part=0;part<chunks;part++)await ingest(store,{operation:'chunk',...context,part,rows:offers.slice(part*500,(part+1)*500)});
   while((await ingest(store,{operation:'finish',...context,count:offers.length})).verifying){}
  }
  report.offers+=offers.length;report.sources.push({alias,offers:offers.length,date:offers[0].date});
  for(const offer of offers)if(measurementIssue(offer.name)==='wrong_dimension')report.wrong_dimension_titles++;
  console.log(JSON.stringify({source:alias,offers:offers.length}));
 }
 const lexicon=shoppingLexicon();report.dictionary_entries=lexicon.length;
 for(const row of lexicon)for(const form of row.forms){report.forms_checked++;if(JSON.stringify(queryGroups(form))!==JSON.stringify(queryGroups(row.query)))report.spelling_mismatches.push({query:row.query,form});}
 for(const query of new Set([...lexicon.map(x=>x.query),...Object.keys(controls),'сыр','сок','кофе','молоко','разрыхлитель','пергамент','кешью','линзы'])){
  const started=Date.now(),plan=await store.searchPlan(query),rows=await store.db.all(plan.sql,plan.params),all=rows.map(r=>JSON.parse(r.payload));
  const result={query,offers:all.length,networks:new Set(rows.map(r=>r.source_id)).size,elapsed_ms:Date.now()-started,examples:all.slice(0,6).map(o=>o.name)};
  report.queries.push(result);
  if(groceryQuery(query)){
   const nonfood=all.filter(o=>nonfoodObjects.test(normalize(o.name)));
   if(nonfood.length)report.violations.push({query,kind:'nonfood_object',count:nonfood.length,examples:nonfood.slice(0,20).map(o=>o.name)});
  }
  if(controls[query]){
   // Mixed fruit drinks and table+chair sets genuinely contain the searched
   // product; they are not prefix collisions with orange/chair-only listings.
   const legitimate=o=>query==='гранат'?/\b(?:nar|nara|narom)\b/.test(normalize(o.name)):query==='стол'?/\b(?:sto|stola|stolu|stolom|stolovi|stocic[a-z]*)\b/.test(normalize(o.name)):false;
   const violations=all.filter(o=>controls[query].test(normalize(o.name))&&!legitimate(o));
   report.controls[query]={offers:all.length,checked:all.length,violations:violations.length,examples:violations.slice(0,20).map(o=>o.name)};
   if(violations.length)report.violations.push({query,count:violations.length,examples:violations.slice(0,20).map(o=>o.name)});
  }
 }
 report.fish_by_network=await store.searchChains('рыба');
 report.type_queries=[];
 for(const query of ['молоко','курица','мясо','кофе','масло','чай','рис','вода']){
  const p=await store.searchPlan(query),all=(await store.db.all(p.sql,p.params)).map(r=>JSON.parse(r.payload)),draft=buildRefinement(query,all,'offline-audit',Date.now(),true);
  for(const choice of draft?.facets.find(f=>f.key==='type')?.values||[]){
   const plan=await store.searchPlan(query,Date.now(),null,{type:choice.value}),rows=(await store.db.all(plan.sql,plan.params)).map(r=>JSON.parse(r.payload)),invalid=rows.filter(o=>!matchesType(o,choice.value));
   report.type_queries.push({query,type:choice.label,offers:rows.length,violations:invalid.length});
   if(invalid.length)report.violations.push({query,type:choice.label,count:invalid.length,examples:invalid.slice(0,20).map(o=>o.name)});
  }
 }
 report.fish_one_kg=await store.searchChains('рыба',Date.now(),{pack:{kind:'weight',amount:1000}});
 const cabbage=await store.db.get("SELECT id FROM sd_offers WHERE lower(name) LIKE '%kupus%ribanac%' LIMIT 1");
 report.reported_cabbage={found:!!cabbage,matched:cabbage?await store.matchesOffer('рыба',cabbage.id):null,icon:productIcon('Ribanac kiseli kupus 1kg')};
 if(cabbage&&report.reported_cabbage.matched)report.violations.push({query:'рыба',reported_cabbage:true});
 report.zero_result_queries=report.queries.filter(q=>!q.offers).map(q=>q.query);
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({offers:report.offers,dictionary_entries:report.dictionary_entries,forms_checked:report.forms_checked,queries:report.queries.length,violations:report.violations.length,spelling_mismatches:report.spelling_mismatches.length,unmatched:report.zero_result_queries}));
 if(report.violations.length||report.spelling_mismatches.length)process.exitCode=1;
}finally{connection.close();}
