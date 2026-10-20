import {DatabaseSync} from 'node:sqlite';
import {Store} from '../tgcloud/lib/store.js';
import {day} from '../tgcloud/lib/domain.js';
import {ingest} from '../tgcloud/lib/ingest.js';
let counter=100;
export const source='a'.repeat(24),owner='11111111-1111-4111-8111-111111111111';
export function offer(id=1,extra={}){return {id:id.toString(16).padStart(32,'0'),source,product:'gtin:04006381333931',name:'LED sijalica E27 9W 806lm',brand:'Example',barcode:'4006381333931',format:'Example market',regular:20000,discount:null,begin:null,end:null,date:day(),norm:'led sijalica e27 9w 806lm',terms:['led','sijalica','e27','9w','806lm','4006381333931'],traits:{socket:'E27',lumens:806,kind:'bulb'},...extra};}
export function sqlite(){const connection=new DatabaseSync(':memory:');return {connection,async run(sql,p={}){const result=connection.prepare(sql).run(p);return {rowsAffected:Number(result.changes)};},async get(sql,p={}){return connection.prepare(sql).get(p);},async all(sql,p={}){return connection.prepare(sql).all(p);}};}
export async function fixture(){const db=sqlite(),store=new Store(db),sent=[];await store.init();await store.setMeta('active',true);const api={async getMe(){return {id:123,username:'SerbiaDealsBot'};},async answerCallbackQuery(){},async sendMessage(p){sent.push(p);return {message_id:++counter};},async editMessageText(p){sent.push(p);return {message_id:p.message_id};},async sendPhoto(p){sent.push(p);return {message_id:++counter};},async editMessageMedia(p){sent.push(p);return {message_id:p.message_id};},async deleteMessage(){}};return {db,store,api,sent};}
export async function publish(f,rows,gen='b'.repeat(32),overrides={}){const context={source:rows[0].source,gen,owner,...overrides};await ingest(f.store,{operation:'begin',...context,name:'Example',url:`https://data.gov.rs/sr/datasets/${context.source}/`,date:day(),chunks:1});await ingest(f.store,{operation:'chunk',...context,part:0,rows});return ingest(f.store,{operation:'finish',...context,count:rows.length});}
export const message=(uid,text)=>({message:{message_id:++counter,chat:{id:uid,type:'private'},from:{id:uid},text}});
export const callback=(uid,data)=>({callback_query:{id:String(++counter),from:{id:uid},message:{message_id:1,chat:{id:uid,type:'private'}},data}});
