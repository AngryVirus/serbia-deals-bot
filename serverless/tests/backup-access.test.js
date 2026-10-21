import test from 'node:test';
import assert from 'node:assert/strict';
import {manage} from '../tgcloud/lib/manage.js';
import {fixture} from './fixtures.js';

test('backup pages require private owner-run context and the correct bot',async()=>{
 const f=await fixture(),input={operation:'backup_create',id:'11111111-1111-4111-8111-111111111111'};
 for(const ctx of [{},{ownerRun:false},{ownerRun:true,update:{callback_query:{from:{id:340780041}}}},{ownerRun:true,initData:'forged'}]){
  await assert.rejects(manage(input,ctx,f));
 }
 await assert.rejects(manage(input,{ownerRun:true},{...f,api:{getMe:async()=>({id:123,username:'SerbiaJobsBot'})}}));
 assert.equal(await f.db.get("SELECT name FROM sqlite_schema WHERE name='sd_backup_rows'"),undefined);
 assert.equal(f.sent.length,0);
});
