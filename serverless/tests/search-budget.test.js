import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,offer,publish} from './fixtures.js';

test('broad colour modifiers still require the product and preserve prefix synonyms in either order',async()=>{
 const f=await fixture();
 await publish(f,[
  offer(1,{name:'Zeleni caj',terms:['zeleni','caj']}),
  offer(2,{name:'Crni caj',terms:['crni','caj']}),
  offer(3,{name:'Zelena paprika',terms:['zelena','paprika']}),
  offer(4,{name:'Green tea',terms:['green','tea','caj']})
 ]);
 for(const query of ['зелёный чай','чай зеленый']){
  const result=await f.store.search(query);
  assert.deepEqual(result.map(r=>JSON.parse(r.payload).name),['Zeleni caj','Green tea']);
  assert.equal((await f.store.searchChains(query))[0].offers,2);
 }
 assert.deepEqual((await f.store.search('чёрный чай')).map(r=>JSON.parse(r.payload).name),['Crni caj']);
});
