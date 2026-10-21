import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,source,owner} from './fixtures.js';
import {ingest} from '../tgcloud/lib/ingest.js';
const current='2026-10-21',older='2026-10-20',fixed=Date.parse('2026-10-21T12:00:00Z');
const genA='a'.repeat(32),genB='b'.repeat(32),genC='c'.repeat(32);
const context=gen=>({source,gen,owner});
async function begin(f,gen,date){return ingest(f.store,{operation:'begin',...context(gen),name:'Example',url:`https://data.gov.rs/sr/datasets/${source}/`,date,chunks:1});}
async function chunk(f,gen,date,price=20000){return ingest(f.store,{operation:'chunk',...context(gen),part:0,rows:[offer(1,{date,regular:price})]});}
async function finish(f,gen){return ingest(f.store,{operation:'finish',...context(gen),count:1});}
async function publish(f,gen,date,price=20000){await begin(f,gen,date);await chunk(f,gen,date,price);return finish(f,gen);}
async function state(f){return f.db.get('SELECT * FROM sd_sources WHERE id=:source',{':source':source});}
async function live(f,gen,date,price){const s=await state(f);assert.equal(s.current_gen,gen);assert.equal(s.date,date);const row=await f.store.offer(offer().id);assert.equal(row.price,price);}
async function clock(fn){const previous=Date.now;Date.now=()=>fixed;try{await fn();}finally{Date.now=previous;}}

test('yesterday fallback cannot replace today prices or alter source staging metadata',async()=>clock(async()=>{
 const f=await fixture();await publish(f,genA,current,15000);const before=await state(f);await assert.rejects(begin(f,genB,older),/older than published/);assert.deepEqual(await state(f),before);await live(f,genA,current,15000);
 // A valid pending stage also survives an unrelated stale retry.
 await begin(f,genB,current);const staged=await state(f);await assert.rejects(begin(f,genC,older),/older than published/);assert.deepEqual(await state(f),staged);
}));
test('begin rejects a snapshot if a newer source wins between its initial read and lease acquisition',async()=>clock(async()=>{
 const f=await fixture();await publish(f,genA,older,20000);const get=f.db.get;let raced=false;f.db.get=async(sql,p)=>{const result=await get(sql,p);if(!raced&&sql==='SELECT * FROM sd_sources WHERE id=:source'){raced=true;await publish(f,genB,current,15000);}return result;};
 await assert.rejects(begin(f,genC,older),/older than published/);f.db.get=get;await live(f,genB,current,15000);assert.equal((await state(f)).stage_gen,null);
}));
test('begin rechecks the live date after acquiring a lease and retains its rejected stage for inspection',async()=>clock(async()=>{
 const f=await fixture();await publish(f,genA,older);const run=f.db.run;let changed=false;f.db.run=async(sql,p)=>{const result=await run(sql,p);if(!changed&&sql.startsWith('INSERT INTO sd_sources')){changed=true;await run('UPDATE sd_sources SET date=:date WHERE id=:source',{':date':current,':source':source});}return result;};
 await assert.rejects(begin(f,genC,older),/older than published/);f.db.run=run;assert.equal((await state(f)).current_gen,genA);assert.equal((await state(f)).stage_gen,genC);assert.equal((await state(f)).date,current);
}));
test('finish rejects older rows even when begin advertised the current date and preserves live prices',async()=>clock(async()=>{
 const f=await fixture();await publish(f,genA,current,15000);const quality=await f.store.meta('catalog_quality:'+source);await begin(f,genB,current);await chunk(f,genB,older,1000);await assert.rejects(finish(f,genB),/older than published/);await live(f,genA,current,15000);assert.equal((await state(f)).stage_gen,genB);assert.deepEqual(await f.store.meta('catalog_quality:'+source),quality);
}));
test('publication compare-and-swap rejects an older stage when a newer date becomes live just before commit',async()=>clock(async()=>{
 const f=await fixture();await publish(f,genA,older,20000);await publish(f,genB,current,15000);
 // Keep both real generations; simulate a newer publisher winning the last SQL race.
 await f.db.run('UPDATE sd_sources SET current_gen=:gen,date=:date WHERE id=:source',{':gen':genA,':date':older,':source':source});await begin(f,genC,older);await chunk(f,genC,older,1000);
 const run=f.db.run;let raced=false;f.db.run=async(sql,p)=>{if(!raced&&sql.startsWith('UPDATE sd_sources SET current_gen=')){raced=true;await run('UPDATE sd_sources SET current_gen=:gen,date=:date WHERE id=:source',{':gen':genB,':date':current,':source':source});}return run(sql,p);};
 await assert.rejects(finish(f,genC),/Publication lost lease or stale/);f.db.run=run;assert(raced);await live(f,genB,current,15000);assert.equal((await state(f)).stage_gen,genC);
}));
test('a corrected body from the same day can replace the published generation',async()=>clock(async()=>{
 const f=await fixture();await publish(f,genA,current,20000);assert((await publish(f,genB,current,15000)).published);await live(f,genB,current,15000);assert.equal((await state(f)).stage_gen,null);
}));
