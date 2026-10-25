import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,source,owner,publish} from './fixtures.js';
import {ingest} from '../tgcloud/lib/ingest.js';
import {day} from '../tgcloud/lib/domain.js';

test('cleanup bounds each SQL batch and gateway request while retaining live, staged and unrelated data',async()=>{
 const f=await fixture(),old='c'.repeat(32),staged='d'.repeat(32),context={source,gen:old,owner};
 await ingest(f.store,{operation:'begin',...context,name:'Example',url:`https://data.gov.rs/sr/datasets/${source}/`,date:day(),chunks:3});
 for(let part=0;part<3;part++)await ingest(f.store,{operation:'chunk',...context,part,rows:Array.from({length:400},(_,i)=>offer(part*400+i+1))});
 while((await ingest(f.store,{operation:'finish',...context,count:1200})).verifying){}
 await publish(f,[offer(9999)]);const other='e'.repeat(24);await publish(f,[offer(2,{source:other})]);await f.store.ensure(77);
 const user=await f.store.user(77),run=f.db.run.bind(f.db),sizes=[];
 f.db.run=async(sql,params)=>{if(sql.startsWith('DELETE FROM sd_offers WHERE rowid')){const ids=JSON.parse(params[':ids']);assert(ids.length<=250);sizes.push(ids.length);}return run(sql,params);};
 const next={source,gen:staged,owner};
 const first=await ingest(f.store,{operation:'begin',...next,name:'Example',url:`https://data.gov.rs/sr/datasets/${source}/`,date:day(),chunks:1});
 assert(first.cleanup);assert.equal(sizes.reduce((a,b)=>a+b,0),1000);
 assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_offers WHERE gen=:gen',{':gen':old})).n,200);
 await ingest(f.store,{operation:'chunk',...next,part:0,rows:[offer(9998)]});
 await assert.rejects(ingest(f.store,{operation:'cleanup',...next,owner:'22222222-2222-4222-8222-222222222222'}),/Source busy/);
 assert.equal((await ingest(f.store,{operation:'cleanup',...next})).cleanup,false);
 assert.equal((await f.db.get('SELECT COUNT(*) AS n FROM sd_offers')).n,3);
 assert.equal((await f.db.get('SELECT stage_gen FROM sd_sources WHERE id=:source',{':source':source})).stage_gen,staged);
 assert.deepEqual(await f.store.user(77),user);
});

test('a restarted importer resumes paginated cleanup and fences the expired worker',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-25T12:00:00Z')});
 const f=await fixture(),old='c'.repeat(32),next='d'.repeat(32),base={source,gen:old,owner};
 await ingest(f.store,{operation:'begin',...base,name:'Example',url:`https://data.gov.rs/sr/datasets/${source}/`,date:day(),chunks:3});
 for(let part=0;part<3;part++)await ingest(f.store,{operation:'chunk',...base,part,rows:Array.from({length:400},(_,i)=>offer(part*400+i+1))});
 while((await ingest(f.store,{operation:'finish',...base,count:1200})).verifying){}
 await publish(f,[offer(9999)]);
 const input={operation:'begin',source,gen:next,owner,name:'Example',url:`https://data.gov.rs/sr/datasets/${source}/`,date:day(),chunks:1};
 assert((await ingest(f.store,input)).cleanup);
 t.mock.timers.tick(120001);const replacement='22222222-2222-4222-8222-222222222222';
 assert.deepEqual((await ingest(f.store,{...input,owner:replacement})).done,[]);
 await assert.rejects(ingest(f.store,{operation:'chunk',source,gen:next,owner,part:0,rows:[offer(9998)]}),/lease expired/);
 await ingest(f.store,{operation:'chunk',source,gen:next,owner:replacement,part:0,rows:[offer(9998)]});
 assert((await ingest(f.store,{operation:'finish',source,gen:next,owner:replacement,count:1})).published);
 assert.equal((await f.db.get('SELECT current_gen FROM sd_sources WHERE id=:source',{':source':source})).current_gen,next);
});
