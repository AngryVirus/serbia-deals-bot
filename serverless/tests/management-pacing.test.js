import test from 'node:test';
import assert from 'node:assert/strict';
import {pacedManagement} from '../management-pacing.mjs';
function clock(){let stamp=0;return {now:()=>stamp,sleep:async ms=>{stamp+=ms;}};}
test('diagnostic control calls share a clock across endpoint methods',async()=>{
 const c=clock(),times=[],method=async()=>{times.push(c.now());return {ok:true};},client=pacedManagement({getFiles:method,runFunction:method},c);
 await client.getFiles();await client.runFunction();await client.getFiles();
 assert.deepEqual(times,[0,6000,12000]);
});
test('only explicit 429 is retried, honoring both server cooldown and pacing',async()=>{
 const c=clock(),times=[],args=[],client=pacedManagement({runFunction:async(...input)=>{times.push(c.now());args.push(input);if(times.length===1)throw {status:429,parameters:{retry_after:9}};return 'done';}},c);
 assert.equal(await client.runFunction('same request'),'done');assert.deepEqual(times,[0,9000]);assert.deepEqual(args[0],args[1]);
});
test('ambiguous mutations and revision conflicts are never repeated',async()=>{
 for(const error of [{status:500},{status:409},{status:403},new Error('private timeout')]){
  let calls=0;const client=pacedManagement({batchDeploy:async()=>{calls++;throw error;}},clock());
  await assert.rejects(client.batchDeploy(),e=>e===error);assert.equal(calls,1);
 }
});
test('repeated throttling and a long cooldown remain bounded failures',async()=>{
 let calls=0;const error={status:429},client=pacedManagement({getFiles:async()=>{calls++;throw error;}},clock());
 await assert.rejects(client.getFiles(),e=>e===error);assert.equal(calls,3);
 calls=0;const long={status:429,parameters:{retry_after:61}},blocked=pacedManagement({getFiles:async()=>{calls++;throw long;}},clock());
 await assert.rejects(blocked.getFiles(),e=>e===long);assert.equal(calls,1);
});
