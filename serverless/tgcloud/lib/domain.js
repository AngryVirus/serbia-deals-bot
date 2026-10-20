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
const shoppingWords=[
 ['огурец огурцы огурцов огурца','krastav'],['помидор помидоры помидоров томат томаты','paradajz rajcic'],
 ['картошка картофель картофеля картошку','krompir krumpir'],['морковь морковка','sargarep mrkv'],['лук лука','luk'],['чеснок чеснока','beli cesnjak'],
 ['капуста капусты','kupus'],['кабачок кабачки','tikvic'],['баклажан баклажаны','patlidzan'],['перец перцы','paprik'],['салат салата','salat'],
 ['яблоко яблоки яблок яблоками','jabuk'],['банан бананы бананов','banan'],['апельсин апельсины','pomorand narand'],['мандарин мандарины','mandarin'],
 ['лимон лимоны','limun'],['груша груши','krusk'],['клубника клубнику','jagod'],['виноград винограда','grozd'],['арбуз арбузы','lubenic'],['авокадо','avokad'],
 ['яйцо яиц яйцами','jaja jaje'],['курица курицу курицы куриный куриное куриные','pile pilet'],['индейка индейку','curet'],['говядина говядину','goved junec'],
 ['свинина свинину','svinj'],['мясо мяса','meso'],['фарш фарша','mleven mljeven'],['рыба рыбу рыбы','riba riblj'],['лосось лосося','losos'],['тунец тунца','tunjevin tuna'],
 ['колбаса колбасу колбасы','kobasic salam'],['сосиски сосисок','virsl hrenov'],['ветчина ветчину','sunk'],['бекон бекона','slanin bacon'],
 ['йогурт йогурты йогурта','jogurt yogurt'],['кефир кефира','kefir'],['сметана сметану','pavlak'],['сливки сливок','pavlak vrhnj'],['творог творога','sir'],
 ['сыра сыры','sir'],['молока молочку','mleko mlijeko'],['шоколад шоколада шоколадка','cokolad'],['печенье печенья','keks biskvit'],['мороженое мороженого','sladoled'],
 ['сок соки сока','sok'],['газировка газировку','gaziran cola kola'],['пиво пива','pivo'],['вино вина','vino'],['минералка минералку','mineraln'],
 ['энергетик энергетики энергетика энергетиков энергетический энергетические энергетического','energet energij energy red redbull guarana monster hell ultra'],
 ['напиток напитки напитка','napit pic drink'],['чая','caj'],['кофейный','kafa coffee'],['меда мёд мед','med'],['соль соли','so soli'],
 ['гречка гречку','heljd'],['овсянка овсянку овсяные','ovsen zob'],['хлопья хлопьев','pahulj'],['хлеба батон','hleb kruh baget'],['макарон спагетти','testenin spaget pasta'],
 ['кетчуп кетчупа','kecap ketchup'],['майонез майонеза','majonez'],['орехи орехов','oras orah lesnik badem'],['арахис арахиса','kikiriki'],
 ['шампуни шампуня','sampon'],['мыла','sapun'],['паста пасту','pasta'],['зубная зубную','zub'],['салфетки салфеток','maramic salvete'],
 ['батареек','baterij'],['губка губки','sundjer spuzv'],['пакет пакеты','kes vrec'],['туалетная туалетную','toalet'],
 ['маринованные маринованный солёные соленые солёный соленый','kisel marin paster'],
 ['консервированные консервированный','konzerv'],
 ['ред','red'],['булл бул','bull'],['кола колу','cola kola'],['монстр','monster']
];
const aliases=Object.fromEntries([...Object.entries(words),...shoppingWords.flatMap(([forms,terms])=>forms.split(' ').map(form=>[form,terms.split(' ')]))].map(([key,value])=>[normalize(key),value]));
const energyTokens=new Set(shoppingWords.find(([forms])=>forms.startsWith('энергетик '))[0].split(' ').map(normalize));
export const energyQuery=query=>normalize(query).split(' ').some(t=>energyTokens.has(t));
export function queryGroups(query){
 const original=String(query),tokens=normalize(query).split(' ').filter(Boolean);
 requireValue(tokens.length>0&&tokens.length<=8&&original.length<=120,'Введите название короче 120 символов.');
 const brandText=tokens.map(t=>(aliases[t]?.length===1?aliases[t][0]:t)).join(' '),redBull=/(?:^| )red ?bull?(?: |$)/.test(brandText);
 const energy=energyQuery(query),groups=[];
 for(const token of tokens){
  if(redBull&&energyTokens.has(token))continue;
  if(['свежий','свежие','свежая','свежую'].map(normalize).includes(token)&&tokens.some(t=>(aliases[t]||[]).some(w=>['krastav','paradajz','rajcic'].includes(w))))continue;
  if(energy&&['напиток','напитки','напитка'].map(normalize).includes(token))continue;
  if(redBull&&['redbull','редбулл','редбул'].map(normalize).includes(token)){groups.push(['red','redbull'],['bull','redbull']);continue;}
  const group=aliases[token]||[token];
  groups.push(redBull&&group.some(t=>t==='red'||t==='bull')?[...group,'redbull']:group);
 }
 return groups;
}
export const freshProduceQuery=query=>!/(марин|сол[её]н|консерв|паста|соус|суп|сок|сметан|kisel|marin|paster|konzerv)/i.test(String(query))&&queryGroups(query).some(group=>group.some(word=>['krastav','paradajz','rajcic'].includes(word)));
export const bulbQuery=query=>queryGroups(query).some(group=>group.some(word=>/^sijalic|^zarulj|^bulbs?$/.test(word)));
export function day(now=Date.now()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Belgrade',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const get=k=>parts.find(x=>x.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');}
export const cutoff=now=>new Date(Date.parse(day(now)+'T12:00:00Z')-2*86400000).toISOString().slice(0,10);
export function currentPrice(offer,today=day()){return offer.discount&&offer.begin<=today&&((offer.end&&offer.end>=today)||(!offer.end&&offer.date===today))?offer.discount:offer.regular;}
export const money=cents=>(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' RSD';
export async function assertBot(api){const bot=await api.getMe();requireValue(bot?.username===BOT_USERNAME&&positive(bot.id),'Wrong bot identity; stopped before accessing data');return bot;}
