import {db,api,InputFile} from 'sdk';
import {Store} from '../lib/store.js';
import {assertBot,requireValue} from '../lib/domain.js';
import {noticeTick,noticeText} from '../lib/moderation-notices.js';
import {renderImage} from '../lib/image-renderer.js';
export default async function(input,ctx){
 requireValue(ctx?.ownerRun===true,'Authenticated owner run required');await assertBot(api);
 if(input.operation==='preview'){
  const fake={active:true,reason:'Тестовая причина',actor:{id:1,name:'Модератор примера',username:'example_moderator'},ban_actor:{id:1,name:'Модератор примера'}};
  return {ban_bytes:renderImage(noticeText('ban',fake)).bytes.length,unban_bytes:renderImage(noticeText('ban',{...fake,active:false})).bytes.length};
 }
 requireValue(input.operation==='tick');const store=new Store(db);await store.init();if(await store.meta('active')!==true)return {paused:true};return noticeTick(store,api,InputFile);
}
