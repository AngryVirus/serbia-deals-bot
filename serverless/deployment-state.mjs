// Compare module maps without returning their source or private runtime data.
export function compareModuleSources(local,remote){
 const map=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const localMap=map(local),remoteMap=map(remote),expected=localMap?Object.keys(local):[],installed=remoteMap?Object.keys(remote):[];
 const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
 let missing=0,extra=0,changed=0,invalid=Number(!localMap)+Number(!remoteMap);
 for(const key of expected){
  if(typeof local[key]!=='string')invalid++;
  if(!remoteMap||!own(remote,key)){missing++;continue;}
  if(typeof remote[key]!=='string')invalid++;
  if(local[key]!==remote[key])changed++;
 }
 for(const key of installed)if(!localMap||!own(local,key)){extra++;if(typeof remote[key]!=='string')invalid++;}
 return {matches_local:expected.length>0&&!invalid&&!missing&&!extra&&!changed,
  local_modules:expected.length,remote_modules:installed.length,
  missing_modules:missing,extra_modules:extra,changed_modules:changed,invalid_modules:invalid};
}
