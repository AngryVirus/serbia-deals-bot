import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,source,owner} from './fixtures.js';
import {ingest} from '../tgcloud/lib/ingest.js';
import {day} from '../tgcloud/lib/domain.js';

test('bounded verification amortizes requests, checkpoints every page and never publishes an incomplete scan',async()=>{
 const f=await fixture(),context={source,owner,gen:'c'.repeat(32)};
 await ingest(f.store,{operation:'begin',...context,name:'Example',url:`https://data.gov.rs/sr/datasets/${source}/`,date:day(),chunks:10});
 for(let part=0;part<10;part++)await ingest(f.store,{operation:'chunk',...context,part,rows:Array.from({length:500},(_,i)=>offer(part*500+i+1))});
 for(const pages of [0,5,1.5])await assert.rejects(ingest(f.store,{operation:'finish',...context,count:5000,pages}),/verification budget/);
 assert.equal((await f.db.get('SELECT current_gen FROM sd_sources WHERE id=:source',{':source':source})).current_gen,null);
 const first=await ingest(f.store,{operation:'finish',...context,count:5000,pages:4});
 assert.equal(first.verifying,true);assert.equal(first.count,4000);
 assert.equal((await f.store.meta('verify:'+source)).count,4000);
 assert.equal((await f.db.get('SELECT current_gen FROM sd_sources WHERE id=:source',{':source':source})).current_gen,null);
 const result=await ingest(f.store,{operation:'finish',...context,count:5000,pages:4});
 assert.equal(result.published,true);assert.equal(result.count,5000);
 assert.equal((await f.store.meta('catalog_quality:'+source)).offers,5000);
});

test('a worker losing ownership between verification pages cannot continue or publish',async()=>{
 const f=await fixture(),context={source,owner,gen:'c'.repeat(32)};
 await ingest(f.store,{operation:'begin',...context,name:'Example',url:`https://data.gov.rs/sr/datasets/${source}/`,date:day(),chunks:3});
 for(let part=0;part<3;part++)await ingest(f.store,{operation:'chunk',...context,part,rows:Array.from({length:500},(_,i)=>offer(part*500+i+1))});
 const set=f.store.setMeta.bind(f.store);let changed=false;
 f.store.setMeta=async(key,value)=>{await set(key,value);if(!changed&&key==='verify:'+source){changed=true;await f.db.run('UPDATE sd_sources SET owner=:owner WHERE id=:source',{':owner':'22222222-2222-4222-8222-222222222222',':source':source});}};
 await assert.rejects(ingest(f.store,{operation:'finish',...context,count:1500,pages:4}),/Source lease expired/);
 assert.equal((await f.store.meta('verify:'+source)).count,1000);
 assert.equal((await f.db.get('SELECT current_gen FROM sd_sources WHERE id=:source',{':source':source})).current_gen,null);
});
