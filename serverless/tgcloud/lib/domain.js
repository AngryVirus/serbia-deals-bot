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
 ['слива сливы сливу сливами','sljiv'],['песто','pesto'],['соус соусы соуса','sos umak preliv'],
 ['лимон лимоны','limun'],['груша груши','krusk'],['клубника клубнику','jagod'],['виноград винограда','grozd'],['арбуз арбузы','lubenic'],['авокадо','avokad'],
 ['яйцо яиц яйцами','jaja jaje'],['курица курицу курицы куриный куриное куриные','pile pilet'],['индейка индейку','curet'],['говядина говядину говядины говяжий говяжье говяжья','goved junec'],
 ['свинина свинину свинины свиной свиное свиная','svinj'],['мясо мяса meso месо','meso pile pilet goved junec svinj curet'],['фарш фарша','mleven mljeven'],['рыба рыбу рыбы','riba riblj'],['лосось лосося','losos'],['тунец тунца','tunjevin tuna'],
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
 ['молотый молотая молотого','mleven mljeven'],['растворимый растворимого','instant rastvor'],
 ['зёрна зерна зёрнах зернах зерновой','zrn'],['капсулы капсулах капсульный','kapsul'],
 ['чёрный черный чёрного черного','crn black'],['зелёный зеленый зелёного зеленого','zelen green'],
 ['негазированная негазированную негазированной','negaz'],['газированная газированную газированной','gaziran'],
 ['филе','file filet'],['грудка грудку грудки','grud prs belo'],['бедро бёдра бедра','batak karabatak'],
 ['крылья крылышки','kril'],['лопатка лопатку','pleck'],['шея шею шейка','vrat'],

 ['piletina pileci pileca pilece','pile pilet'],
 ['ред','red'],['булл бул','bull'],['кола колу','cola kola'],['монстр','monster']
];
const phrases=[
 ['соус песто','pesto'],['соуса песто','pesto'],
 ['кофе в зернах','kafa zrn'],['кофе в зёрнах','kafa zrn'],['кофе в капсулах','kafa kapsul'],
 ['сливочное масло','maslac'],['сливочного масла','maslac'],
 ['подсолнечное масло','suncokret ulje'],['подсолнечного масла','suncokret ulje'],
 ['оливковое масло','maslin ulje'],['оливкового масла','maslin ulje'],
 ['минеральная вода','mineral voda'],['минеральной воды','mineral voda'],
 ['газированная вода','gaziran voda'],['газированной воды','gaziran voda'],
 ['зубная паста','pasta zub'],['зубную пасту','pasta zub'],
 ['влажные салфетки','vlazn maramic'],['влажных салфеток','vlazn maramic'],
 ['корм для кошек','hrana mack'],['корм для котов','hrana mack'],['корм для собак','hrana ps']
].flatMap(([from,to])=>{const tokens=normalize(from).split(' '),target=normalize(to);return tokens.length===2?[[tokens.join(' '),target],[[...tokens].reverse().join(' '),target]]:[[tokens.join(' '),target]];});
const aliases=Object.fromEntries([...Object.entries(words),...shoppingWords.flatMap(([forms,terms])=>forms.split(' ').map(form=>[form,terms.split(' ')]))].map(([key,value])=>[normalize(key),value]));
const energyTokens=new Set(shoppingWords.find(([forms])=>forms.startsWith('энергетик '))[0].split(' ').map(normalize));
export const energyQuery=query=>normalize(query).split(' ').some(t=>energyTokens.has(t));
export function volumeQuery(query){
 let match=String(query).match(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(ml|мл|cl|l|л)(?![\p{L}\p{N}])/iu);
 if(!match&&energyQuery(query)){const decimal=String(query).match(/(?<![\p{L}\p{N}.,])([012][.,]\d{1,3})(?![\p{L}\p{N}.,])/u);if(decimal){const ml=Number(decimal[1].replace(',','.'))*1000;if(ml>=50&&ml<=2000)match=[decimal[0],decimal[1],'l'];}}
 if(!match)return null;
 const factor=/^(ml|мл)$/i.test(match[2])?1:/^cl$/i.test(match[2])?10:1000,ml=Number(match[1].replace(',','.'))*factor;
 if(!Number.isInteger(ml)||ml<1||ml>10000)return null;
 const liters=String(ml/1000),centiliters=String(ml/10),forms=[ml+'ml',liters+'l',centiliters+'cl'];
 return {text:match[0],ml,forms,terms:[...new Set(forms.map(x=>normalize(x).split(' ').at(-1)))]};
}
export function weightQuery(query){
 const match=String(query).match(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(kg|кг|g|г)(?![\p{L}\p{N}])/iu);if(!match)return null;
 const grams=Number(match[1].replace(',','.'))*(/^(kg|кг)$/i.test(match[2])?1000:1);if(!Number.isInteger(grams)||grams<1||grams>100000)return null;
 const forms=[grams+'g',(grams/1000)+'kg'];return {text:match[0],grams,forms,terms:[...new Set(forms.map(x=>normalize(x).split(' ').at(-1)))]};
}
export function queryGroups(query){
 const original=String(query),volume=volumeQuery(query)||weightQuery(query);let translated=' '+normalize(volume?original.replace(volume.text,' '):query)+' ';
 for(const [from,to] of phrases)translated=translated.replaceAll(' '+from+' ',' '+to+' ');
 const tokens=translated.trim().split(' ').filter(Boolean);
 requireValue(tokens.length>0&&tokens.length<=8&&original.length<=120,'Введите название короче 120 символов.');
 const brandText=tokens.map(t=>(aliases[t]?.length===1?aliases[t][0]:t)).join(' '),redBull=/(?:^| )red ?bull?(?: |$)/.test(brandText);
 const energy=energyQuery(query),specificEnergy=redBull||energy&&/(?:^| )(?:monster|guarana|hell|ultra)(?: |$)/.test(brandText),groups=[];
 for(const token of tokens){
  if(specificEnergy&&energyTokens.has(token))continue;
  if(['свежий','свежие','свежая','свежую','сырое','сырая','сырой','sveza','sveze','svezi','raw'].map(normalize).includes(token)&&tokens.some(t=>(aliases[t]||[t]).some(w=>/^(krastav|paradajz|rajcic|pile|pilet|goved|junec|svinj|curet)/.test(w))))continue;
  if(energy&&['напиток','напитки','напитка'].map(normalize).includes(token))continue;
  if(redBull&&['redbull','редбулл','редбул'].map(normalize).includes(token)){groups.push(['red','redbull'],['bull','redbull']);continue;}
  const group=aliases[token]||[token];
  if(group.includes('beli')&&group.includes('cesnjak')){groups.push(['beli','cesnjak'],['luk','cesnjak']);continue;}
  if(['фарш','фарша'].map(normalize).includes(token)){groups.push(group,['mes','junec','goved','svinj','pile','curet']);continue;}
  groups.push(redBull&&group.some(t=>t==='red'||t==='bull')?[...group,'redbull']:group);
 }
 if(volume)groups.push(volume.terms);
 return groups;
}
export const plumQuery=query=>queryGroups(query).some(group=>group.some(word=>/^sljiv/.test(word)))&&!/(?:^| )(?:rakij[a-z]*|sljivovic[a-z]*|paradajz|rajcic[a-z]*|dzem|pekmez|kasic[a-z]*|kasa|sok|caj|knedl[a-z]*|cokolad[a-z]*)(?: |$)/.test(normalize(query))&&!/раки|сливовиц|томат|помидор|джем|варень|каша|пюре|сок|чай|шоколад/i.test(String(query));
export const milkQuery=query=>queryGroups(query).some(group=>group.some(word=>/^(mleko|mlijeko)$/.test(word)))&&!/(?:^| )(?:posud[a-z]*|lon[a-z]*|aparat[a-z]*|sapun|losion|telo|tijelo|ciscenj[a-z]*|sampon|kupk[a-z]*)(?: |$)/.test(normalize(query))&&!/посуд|кастрюл|кувшин|аппарат|мыло|лосьон|очищ|тела|шампунь/i.test(String(query));
export const pestoQuery=query=>queryGroups(query).some(group=>group.includes('pesto'))&&!/(?:^| )(?:sir|pastet[a-z]*|rolnic[a-z]*|humus|hummus)(?: |$)/.test(normalize(query))&&!/сыр|паштет|рулет|хумус/i.test(String(query));
export const freshProduceQuery=query=>!/(марин|сол[её]н|консерв|паста|соус|суп|сок|сметан|kisel|marin|paster|konzerv)/i.test(String(query))&&!/(kisel|marin|paster|konzerv|pasta|sos|supa|sok|pavl|perec)/.test(normalize(query))&&queryGroups(query).some(group=>group.some(word=>/^(krastav|paradajz|rajcic)/.test(word)));
export const relatedChickenQuery=query=>!/(корм|hrana|whiskas|kitekat|pedigree)/i.test(String(query))&&queryGroups(query).some(g=>g.length<=2&&g.some(t=>/^(pile|pilet)/.test(t)));
export const freshMeatQuery=query=>(!relatedChickenQuery(query)||/(свеж|сырой|сырая|сырое|svez|svjez|raw)/i.test(String(query)))&&!/(фарш|паштет|колбас|сосиск|копч|готов|суп|соус|корм)/i.test(String(query))&&!/(pastet|kobasic|salam|virsl|dimlj|supa|sos|hrana|mleven|mljeven|gril|rostilj|pecen|pohov|panir|kubet|smok|smaz|kitekat|patelin|fryer|sampinjon|deligh|dog|cat)/.test(normalize(query))&&queryGroups(query).some(group=>group.some(word=>/^(pile|goved|junec|svinj|curet)/.test(word)));
export const butterQuery=query=>queryGroups(query).some(group=>group.length===1&&group[0]==='maslac')&&!/(posud|noz|keks|biskvit|kikirik|kakao|pasta|kokic|popcorn|baget|peciv|kroasan|marg)/.test(normalize(query));
export const oilQuery=query=>queryGroups(query).some(group=>group.length===1&&group[0]==='ulje')&&!/(motor|menjac|sapun|sampon|tun|sardin|grisin|riba|sos|pasta)/.test(normalize(query));
export const bulbQuery=query=>queryGroups(query).some(group=>group.some(word=>/^sijalic|^zarulj|^bulbs?$/.test(word)));
export function day(now=Date.now()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Belgrade',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const get=k=>parts.find(x=>x.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');}
export const cutoff=now=>new Date(Date.parse(day(now)+'T12:00:00Z')-2*86400000).toISOString().slice(0,10);
export function currentPrice(offer,today=day()){return offer.discount&&offer.begin<=today&&((offer.end&&offer.end>=today)||(!offer.end&&offer.date===today))?offer.discount:offer.regular;}
export const money=cents=>(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' RSD';
export async function assertBot(api){const bot=await api.getMe();requireValue(bot?.username===BOT_USERNAME&&positive(bot.id),'Wrong bot identity; stopped before accessing data');return bot;}
