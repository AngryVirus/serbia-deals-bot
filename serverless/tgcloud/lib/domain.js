export const OWNER_ID=340780041, BOT_USERNAME='SerbiaDealsBot';
export const safe=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const positive=value=>Number.isSafeInteger(value)&&value>0;
export const requireValue=(value,message='Invalid input')=>{if(!value)throw Error(message);};
const cyr=Object.fromEntries([...'абвгдђежзијклљмнњопрстћуфхцчџш'].map((c,i)=>[c,['a','b','v','g','d','dj','e','z','z','i','j','k','l','lj','m','n','nj','o','p','r','s','t','c','u','f','h','c','c','dz','s'][i]]));
export function normalize(value){return String(value).toLowerCase().replace(/[абвгдђежзијклљмнњопрстћуфхцчџш]/g,c=>cyr[c]).replace(/đ/g,'dj').normalize('NFKD').replace(/\p{M}/gu,'').replace(/\b(e|gu)\s+(\d+)\b/g,'$1$2').replace(/(\d)\s+(w|lm|k|kg|g|ml|l)\b/g,'$1$2').replace(/_/g,' ').match(/[\p{L}\p{N}]+/gu)?.join(' ')||'';}
const words={
 'лампочка':['sijalic','zarulj'], 'лампочки':['sijalic','zarulj'], 'лампа':['sijalic','lamp'],
 'молоко':['mleko','mlijeko'], 'кофе':['kafa','coffee'], 'яйца':['jaja'],
 'масло':['ulje','maslac'], 'сахар':['secer'], 'мука':['brasno'], 'сыр':['sir'],
 'батарейка':['baterij'], 'батарейки':['baterij'], 'порошок':['deterdzent','prasak'],
 'шампунь':['sampon'], 'мыло':['sapun'], 'подгузники':['pelen'], 'бумага':['papir'],
 'хлеб':['hleb','kruh'], 'рис':['pirinac','riza'], 'вода':['voda'], 'чай':['caj'],
 'макароны':['testenin','pasta'], 'корм':['hrana'], 'лампочку':['sijalic','zarulj']
};
const aliases=Object.fromEntries(Object.entries(words).map(([key,value])=>[normalize(key),value]));
export function queryGroups(query){const tokens=normalize(query).split(' ').filter(Boolean);requireValue(tokens.length>0&&tokens.length<=8&&String(query).length<=120,'Введите название короче 120 символов.');return tokens.map(token=>aliases[token]||[token]);}
export const bulbQuery=query=>queryGroups(query).some(group=>group.some(word=>/^sijalic|^zarulj|^bulbs?$/.test(word)));
export function day(now=Date.now()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Belgrade',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const get=k=>parts.find(x=>x.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');}
export const cutoff=now=>new Date(Date.parse(day(now)+'T12:00:00Z')-2*86400000).toISOString().slice(0,10);
export function currentPrice(offer,today=day()){return offer.discount&&offer.begin<=today&&((offer.end&&offer.end>=today)||(!offer.end&&offer.date===today))?offer.discount:offer.regular;}
export const money=cents=>(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' RSD';
export async function assertBot(api){const bot=await api.getMe();requireValue(bot?.username===BOT_USERNAME&&positive(bot.id),'Wrong bot identity; stopped before accessing data');return bot;}
