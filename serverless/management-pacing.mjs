// Control-plane pacing only. Deployed Telegram handlers never import this file.
export function pacedManagement(client,{interval=6000,now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 let last=null;
 const invoke=async(name,args)=>{
  for(let attempt=0;;attempt++){
   if(last!==null){const wait=Math.max(0,last+interval-now());if(wait)await sleep(wait);}
   last=now();
   try{return await client[name](...args);}
   catch(error){
    // An explicit gateway rejection is retryable. Unknown execution results,
    // timeouts, server errors and revision conflicts must retain their meaning.
    if(error?.status!==429||attempt>=2)throw error;
    const requested=Number(error.parameters?.retry_after),seconds=Number.isFinite(requested)&&requested>0?requested:10;
    if(seconds>60)throw error;
    await sleep(seconds*1000);
   }
  }
 };
 return {...client,...Object.fromEntries(['getFiles','getWebhook','runFunction','batchDeploy','syncWebhook']
  .filter(name=>typeof client[name]==='function').map(name=>[name,(...args)=>invoke(name,args)]))};
}
