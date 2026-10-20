import {readFileSync,writeFileSync} from 'node:fs';
import {fixture} from '../serverless/tests/fixtures.js';
import {ingest} from '../serverless/tgcloud/lib/ingest.js';
import {shoppingLexicon,packageMeasure,unitPrice,normalize,day} from '../serverless/tgcloud/lib/domain.js';
import {bilingual,fallbackName,localName} from '../serverless/tgcloud/lib/product-names.js';
const data=JSON.parse(readFileSync(process.argv[2]||'work/catalog-snapshot.json','utf8')),f=await fixture();
const report={date:day(),sources:[],offers:0,measurable:0,unit_prices:0,metadata_dimension_conflicts:0,dictionary_fallback_names:0,no_dictionary_words:0,conflict_examples:[],dictionary_queries:[],controls:{}};
for(const [index,[alias,{offers}]] of Object.entries(data).entries()){
 report.sources.push({alias,offers:offers.length,date:offers[0]?.date||null});report.offers+=offers.length;
 for(const o of offers){if(localName(o.name)||fallbackName(o.name))report.dictionary_fallback_names++;else report.no_dictionary_words++;const pack=packageMeasure(o.name);if(pack)report.measurable++;if(unitPrice(o))report.unit_prices++;
  const unit=normalize(o.unit||''),dim=/^(l|lit|ml|litar|litara)$/.test(unit)?'volume':/^(kg|g|gr|kilogram)$/.test(unit)?'weight':null;
  if(pack&&dim&&pack.kind!==dim){report.metadata_dimension_conflicts++;if(report.conflict_examples.length<20)report.conflict_examples.push({source:alias,name:o.name,metadata_unit:o.unit,title_kind:pack.kind});}
 }
 const ctx={source:offers[0].source,gen:(index+1).toString(16).repeat(32),owner:'11111111-1111-4111-8111-111111111111'},chunks=Math.ceil(offers.length/500);
 await ingest(f.store,{operation:'begin',...ctx,name:alias,url:`https://data.gov.rs/sr/datasets/${ctx.source}/`,date:day(),chunks});
 for(let part=0;part<chunks;part++)await ingest(f.store,{operation:'chunk',...ctx,part,rows:offers.slice(part*500,(part+1)*500)});
 while((await ingest(f.store,{operation:'finish',...ctx,count:offers.length})).verifying){}
 console.log(JSON.stringify({source:alias,offers:offers.length}));
}
for(const query of new Set(shoppingLexicon().map(x=>x.query))){
 const chains=await f.store.searchChains(query);report.dictionary_queries.push({query,offers:chains.reduce((n,s)=>n+s.offers,0),networks:chains.length});
}
for(const query of ['пончик','пончики','донат','Donat Mg','петрушка','питьевое молоко','соус песто','сливы']){
 const chains=await f.store.searchChains(query),rows=await f.store.search(query);report.controls[query]={networks:chains.map(s=>s.source_name),examples:rows.map(r=>{const o=JSON.parse(r.payload);return {name:o.name,translated:bilingual(null,o.name),unit:o.unit,unit_price:unitPrice(o)?.label||null};})};
}
report.matched_queries=report.dictionary_queries.filter(q=>q.offers).length;report.unmatched_queries=report.dictionary_queries.filter(q=>!q.offers).map(q=>q.query);
writeFileSync(process.argv[3]||'work/catalog-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({offers:report.offers,queries:report.dictionary_queries.length,matched:report.matched_queries,metadata_dimension_conflicts:report.metadata_dimension_conflicts,unmatched:report.unmatched_queries}));
