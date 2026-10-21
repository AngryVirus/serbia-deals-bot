import test from 'node:test';
import assert from 'node:assert/strict';
import {compareModuleSources} from '../deployment-state.mjs';

test('installed code matches the full manifest independently of map ordering',()=>{
 const a={'handlers/message':'export default () => "Молоко";\n','lib/store':'// data\nexport const n=1;\n'},b={'lib/store':a['lib/store'],'handlers/message':a['handlers/message']};
 assert.deepEqual(compareModuleSources(a,b),{matches_local:true,local_modules:2,remote_modules:2,missing_modules:0,extra_modules:0,changed_modules:0,invalid_modules:0});
});
test('a different module with the same manifest size is rejected',()=>{
 const report=compareModuleSources({'lib/known':'source'},{'lib/unknown':'source'});
 assert.equal(report.matches_local,false);assert.equal(report.local_modules,1);assert.equal(report.remote_modules,1);assert.equal(report.missing_modules,1);assert.equal(report.extra_modules,1);
});
test('missing, extra and modified installed sources are independently reported',()=>{
 const report=compareModuleSources({a:'stable',b:'reviewed',c:'required'},{a:'stable',b:'changed',d:'unexpected'});
 assert.equal(report.matches_local,false);assert.equal(report.changed_modules,1);assert.equal(report.missing_modules,1);assert.equal(report.extra_modules,1);
 assert.equal(compareModuleSources({a:'source\n'},{a:'source'}).matches_local,false);
});
test('invalid and empty maps fail closed rather than certifying an empty deployment',()=>{
 for(const invalid of [undefined,null,false,[],1,'source'])assert.equal(compareModuleSources(invalid,invalid).matches_local,false);
 assert.equal(compareModuleSources({},{}).matches_local,false);
 assert.equal(compareModuleSources({a:undefined},{a:undefined}).matches_local,false);
 assert.equal(compareModuleSources({a:'source'},{a:null}).matches_local,false);
});
test('verification reports only counts and the verdict, never module names or source',()=>{
 const marker='PRIVATE-SOURCE-NEVER-LOG';const report=compareModuleSources({'private/module':marker},{'private/module':'changed'}),text=JSON.stringify(report);
 assert(!text.includes(marker));assert(!text.includes('private/module'));assert(Object.values(report).every(value=>typeof value==='boolean'||Number.isInteger(value)));
});
