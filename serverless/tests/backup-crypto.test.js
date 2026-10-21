import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {encryptBackup,decryptBackup,MAX_BACKUP_BYTES} from '../backup_crypto.mjs';

// Deliberately synthetic credentials; these never access the Cloud or Telegram.
const TOKEN='app1234567890:synthetic_backup_key_for_unit_tests_only'; // pragma: allowlist secret
const WRONG_TOKEN='app1234567890:different_synthetic_key_for_unit_tests'; // pragma: allowlist secret
const CLEAR=Buffer.from('{"basket":"Пончик / Krofna","private_marker":"never-log-this-record"}');
const SCRIPT=fileURLToPath(new URL('../backup_crypto.mjs',import.meta.url));
const FAILURE='Backup cryptography failed; private details withheld\n';
function cli(mode,input,token=TOKEN,extra=[]){
 return spawnSync(process.execPath,[SCRIPT,mode,...extra],{input,env:{TGCLOUD_TOKEN:token},timeout:10000,maxBuffer:2*1024*1024});
}

test('backup encryption recovers binary, Unicode and empty records without dependencies',()=>{
 for(const original of [CLEAR,Buffer.alloc(0),Buffer.from([0,1,255,0,128])]){
  const encrypted=encryptBackup(original,TOKEN);
  assert.equal(encrypted.subarray(0,8).toString(),'SDCBK001');
  assert.equal(encrypted.length,original.length+68);
  assert.deepEqual(decryptBackup(encrypted,TOKEN),original);
  assert(!encrypted.includes(Buffer.from('never-log-this-record')));
 }
});

test('equal backups use independent salts and nonces',()=>{
 const a=encryptBackup(CLEAR,TOKEN),b=encryptBackup(CLEAR,TOKEN);
 assert.notDeepEqual(a,b);
 assert.notDeepEqual(a.subarray(8,40),b.subarray(8,40));
 assert.notDeepEqual(a.subarray(40,52),b.subarray(40,52));
 assert.deepEqual(decryptBackup(a,TOKEN),decryptBackup(b,TOKEN));
});

test('backup authenticates magic, salt, nonce, tag and every ciphertext byte',()=>{
 const encrypted=encryptBackup(CLEAR,TOKEN);
 for(let i=0;i<encrypted.length;i++){
  const changed=Buffer.from(encrypted);changed[i]^=1;
  assert.throws(()=>decryptBackup(changed,TOKEN),/^Error: Backup cryptography failed; private details withheld$/);
 }
});

test('wrong key, truncation, appended bytes and another bot format are rejected',()=>{
 const encrypted=encryptBackup(CLEAR,TOKEN);
 assert.throws(()=>decryptBackup(encrypted,WRONG_TOKEN));
 for(let size=0;size<encrypted.length;size++)assert.throws(()=>decryptBackup(encrypted.subarray(0,size),TOKEN));
 assert.throws(()=>decryptBackup(Buffer.concat([encrypted,Buffer.from([0])]),TOKEN));
 const jobs=Buffer.from(encrypted);jobs.write('SJCBK001');assert.throws(()=>decryptBackup(jobs,TOKEN));
});

test('credentials and size are validated with a fixed private error',()=>{
 for(const token of [undefined,'','123:invalid','app1:invalid token','app1:line\nbreak','app1:'+('x'.repeat(4096))]){
  assert.throws(()=>encryptBackup(CLEAR,token),/^Error: Backup cryptography failed; private details withheld$/);
  assert.throws(()=>decryptBackup(encryptBackup(CLEAR,TOKEN),token),/^Error: Backup cryptography failed; private details withheld$/);
 }
 const tooLarge=Buffer.alloc(MAX_BACKUP_BYTES+69);
 assert.throws(()=>encryptBackup(tooLarge,TOKEN));
 assert.throws(()=>decryptBackup(tooLarge,TOKEN));
 assert.throws(()=>encryptBackup('not binary',TOKEN));
});

test('CLI accepts only binary stdin and a credential from the environment',()=>{
 const encrypted=cli('encrypt',CLEAR);assert.equal(encrypted.status,0);assert.equal(encrypted.stderr.length,0);
 const restored=cli('decrypt',encrypted.stdout);assert.equal(restored.status,0);assert.equal(restored.stderr.length,0);assert.deepEqual(restored.stdout,CLEAR);
});

test('CLI never releases unauthenticated plaintext or private input in error output',()=>{
 const encrypted=encryptBackup(CLEAR,TOKEN),badTag=Buffer.from(encrypted);badTag[52]^=1;
 const changedHeader=Buffer.from(encrypted);changedHeader[8]^=1;
 const changedBody=Buffer.from(encrypted);changedBody[68]^=1;
 for(const [mode,input,token,extra] of [
  ['decrypt',encrypted,WRONG_TOKEN],['decrypt',badTag,TOKEN],['decrypt',changedHeader,TOKEN],['decrypt',changedBody,TOKEN],
  ['decrypt',encrypted.subarray(0,encrypted.length-1),TOKEN],['decrypt',CLEAR,TOKEN],['decrypt',Buffer.alloc(0),TOKEN],
  ['encrypt',CLEAR,''],['wrong-mode',CLEAR,TOKEN],['encrypt',CLEAR,TOKEN,['do-not-log-extra-argument']]
 ]){
  const result=cli(mode,input,token,extra);assert.equal(result.status,1);assert.equal(result.stdout.length,0);assert.equal(result.stderr.toString(),FAILURE);
 }
});
