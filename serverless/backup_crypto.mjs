// Authenticated, per-file encryption using only Node's built-in cryptography.
// The Cloud credential stays in the environment; never pass it in command args.
import {randomBytes,hkdfSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const MAGIC=Buffer.from('SDCBK001');
const CONTEXT=Buffer.from('SerbiaDealsBot backup v1');
const HEADER_BYTES=52,TAG_BYTES=16,ENVELOPE_BYTES=HEADER_BYTES+TAG_BYTES;
export const MAX_BACKUP_BYTES=64*1024*1024;
const FAILURE='Backup cryptography failed; private details withheld';

function dataBuffer(input){
 if(!(input instanceof Uint8Array))throw Error(FAILURE);
 return Buffer.from(input.buffer,input.byteOffset,input.byteLength);
}
function key(token,salt){
 if(typeof token!=='string'||token.length>4096||!/^app\d+:[A-Za-z0-9_-]+$/.test(token))throw Error(FAILURE);
 return Buffer.from(hkdfSync('sha256',Buffer.from(token),salt,CONTEXT,32));
}

export function encryptBackup(input,token){
 let derived;
 try{
  const clear=dataBuffer(input);if(clear.length>MAX_BACKUP_BYTES)throw Error(FAILURE);
  const salt=randomBytes(32),nonce=randomBytes(12),header=Buffer.concat([MAGIC,salt,nonce]);
  derived=key(token,salt);
  const cipher=createCipheriv('aes-256-gcm',derived,nonce);cipher.setAAD(header);
  const encrypted=Buffer.concat([cipher.update(clear),cipher.final()]);
  return Buffer.concat([header,cipher.getAuthTag(),encrypted]);
 }catch{throw Error(FAILURE);}
 finally{derived?.fill(0);}
}

export function decryptBackup(input,token){
 let derived,unverified;
 try{
  const encrypted=dataBuffer(input);
  if(encrypted.length<ENVELOPE_BYTES||encrypted.length>MAX_BACKUP_BYTES+ENVELOPE_BYTES||!encrypted.subarray(0,8).equals(MAGIC))throw Error(FAILURE);
  const header=encrypted.subarray(0,HEADER_BYTES),salt=encrypted.subarray(8,40),nonce=encrypted.subarray(40,HEADER_BYTES);
  derived=key(token,salt);
  const cipher=createDecipheriv('aes-256-gcm',derived,nonce);cipher.setAAD(header);cipher.setAuthTag(encrypted.subarray(HEADER_BYTES,ENVELOPE_BYTES));
  unverified=cipher.update(encrypted.subarray(ENVELOPE_BYTES));
  // GCM can produce bytes in update() even when the tag is wrong. Release
  // plaintext only after final() authenticates the complete file and header.
  const final=cipher.final();
  return Buffer.concat([unverified,final]);
 }catch{throw Error(FAILURE);}
 finally{derived?.fill(0);unverified?.fill(0);}
}

async function main(){
 try{
  const mode=process.argv[2];if(process.argv.length!==3||!['encrypt','decrypt'].includes(mode))throw Error(FAILURE);
  const limit=MAX_BACKUP_BYTES+(mode==='decrypt'?ENVELOPE_BYTES:0),chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>limit)throw Error(FAILURE);chunks.push(chunk);}
  const input=Buffer.concat(chunks),token=process.env.TGCLOUD_TOKEN;
  process.stdout.write(mode==='encrypt'?encryptBackup(input,token):decryptBackup(input,token));
 }catch{process.stderr.write(FAILURE+'\n');process.exitCode=1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
