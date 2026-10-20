// Translate public catalogue titles only; never send private searches or basket input.
const local=new Map(Object.entries({krastavac:'Огурец',paradajz:'Помидор',krompir:'Картофель',sargarepa:'Морковь',luk:'Лук',jabuka:'Яблоко',banana:'Банан',mleko:'Молоко',jaja:'Яйца',kafa:'Кофе',secer:'Сахар',brasno:'Мука',hleb:'Хлеб',voda:'Вода',piletina:'Курица',maslac:'Сливочное масло',pirinac:'Рис',so:'Соль'}));
const latin=value=>String(value).toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/đ/g,'dj');
export function localName(name){return local.get(latin(name).trim())||null;}
export function bilingual(ru,sr){return `${ru||localName(sr)||'Перевод недоступен'} / ${sr}`;}
export function validTranslation(ru,sr){
 if(typeof ru!=='string'||!ru.trim()||ru.length>500||/[<>\x00-\x1f]/.test(ru))return false;
 const numbers=s=>String(s).replace(/,/g,'.').match(/\d+(?:\.\d+)?/g)||[];
 return numbers(sr).every(n=>numbers(ru).includes(n));
}
export async function productNames(store,fetch,offers,now=Date.now()){
 await store.db.run('CREATE TABLE IF NOT EXISTS sd_product_names(name TEXT PRIMARY KEY,ru TEXT,expires INTEGER NOT NULL DEFAULT 0,lease INTEGER NOT NULL DEFAULT 0)');
 await store.db.run('DELETE FROM sd_product_names WHERE name IN (SELECT name FROM sd_product_names WHERE expires<:old AND lease<:now LIMIT 100)',{':old':now-30*86400000,':now':now});
 const unique=[...new Map(offers.filter(o=>typeof o.name==='string'&&o.name.length<=300).map(o=>[o.name,o])).values()],result=new Map();
 const translate=async offer=>{
  const name=offer.name,cached=await store.db.get('SELECT ru,expires FROM sd_product_names WHERE name=:name',{':name':name});
  if(cached?.ru&&cached.expires>now){result.set(name,bilingual(cached.ru,name));return;}
  const simple=localName(name);if(simple){result.set(name,bilingual(simple,name));return;}
  result.set(name,bilingual(cached?.ru,name));if(typeof fetch!=='function'||(await store.meta('name_translation_pause'))>now)return;
  const claim=await store.db.run(`INSERT INTO sd_product_names(name,lease) SELECT :name,:lease WHERE (SELECT COUNT(*) FROM sd_product_names)<3000 ON CONFLICT(name) DO UPDATE SET lease=excluded.lease WHERE sd_product_names.expires<=:now AND sd_product_names.lease<=:now`,{':name':name,':lease':now+30000,':now':now});
  if(claim.rowsAffected!==1)return;
  try{
   const limit=await store.db.run(`INSERT INTO sd_rates(id,n,expires) VALUES('name_translation',1,:until) ON CONFLICT(id) DO UPDATE SET n=CASE WHEN expires<=:now THEN 1 ELSE n+1 END,expires=CASE WHEN expires<=:now THEN :until ELSE expires END WHERE expires<=:now OR n<120`,{':until':now+60000,':now':now});
   if(limit.rowsAffected!==1)return;
   const response=await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=sr&tl=ru&dt=t&q='+encodeURIComponent(name));
   if(!response.ok){if(response.status===429)await store.setMeta('name_translation_pause',now+15*60000);throw Error('Unavailable');}
   const data=await response.json();if(!Array.isArray(data?.[0]))throw Error('Invalid');
   let ru=data[0].map(part=>typeof part?.[0]==='string'?part[0]:'').join('').trim();
   if(!validTranslation(ru,name))throw Error('Invalid');
   // Preserve the catalogue brand verbatim if the translator changes its spelling.
   const brand=String(offer.brand||'').trim();if(brand&&brand.length<60&&!/^(brend|brand|example)$/i.test(brand)&&!latin(ru).includes(latin(brand)))ru=brand+' '+ru;
   await store.db.run('UPDATE sd_product_names SET ru=:ru,expires=:expires,lease=0 WHERE name=:name AND lease=:lease',{':ru':ru,':expires':now+30*86400000,':name':name,':lease':now+30000});result.set(name,bilingual(ru,name));
  }catch{/* Public original remains usable; no external response or URL is logged. */}
  finally{await store.db.run('UPDATE sd_product_names SET lease=0,expires=CASE WHEN ru IS NULL THEN :retry ELSE expires END WHERE name=:name AND lease=:lease',{':retry':now+60000,':name':name,':lease':now+30000});}
 };
 for(let i=0;i<unique.length;i+=3)await Promise.all(unique.slice(i,i+3).map(translate));
 return result;
}
