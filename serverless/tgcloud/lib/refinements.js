import {normalize,energyQuery,volumeQuery,weightQuery,queryGroups,plainMilkQuery,packageMeasure,measurePolicy,milkQuery} from './domain.js';
export function measure(text){
 const m=packageMeasure(text);if(!m)return null;
 const {kind,amount}=m,label=amount>=1000?(amount/1000)+(kind==='volume'?' л':' кг'):amount+(kind==='volume'?' мл':' г');
 return {kind,amount,label};
}
const types=[
 {query:/(?:^|\s)(?:молоко|молока|mleko|mlijeko)(?=\s|$)/i,choices:[['Питьевое',['milkplain']],['Кисломолочное',['kisel','kis']],['Шоколадное',['cokolad']]]},
 {query:/^(?:курица|курицу|piletina|пилетина)(?:\s+\d.*)?$/i,choices:[['Филе',['file','filet']],['Крылья',['kril']],['Бёдра',['batak','karabatak']],['Грудка',['grud','prs','belo']],['Печень и сердце',['jetr','src']],['Колбаса и сосиски',['kobasic','salam','virsl']],['Снеки со вкусом курицы',['cips','flips','smok','kubet']]]},
 {query:/(?:^|\s)(?:мясо|мяса|meso|месо)(?:\s|$)/i,choices:[['Курица',['pile','pilet']],['Говядина',['goved','junec']],['Свинина',['svinj']],['Индейка',['curet']]]},
 {query:/(?:^|\s)(?:кофе|kafa|coffee)(?=\s|$)/i,choices:[['В зёрнах',['zrno','zrn']],['Молотый',['mleven','mljeven']],['Растворимый',['instant','rastvor']],['Капсулы',['kapsul']]]},
 {query:/(?:^|\s)(?:масло|масла|ulje|maslac)(?=\s|$)/i,choices:[['Сливочное',['maslac']],['Оливковое',['maslin']],['Подсолнечное',['suncokret']]]},
 {query:/(?:^|\s)(?:чай|чая|caj|чај)(?=\s|$)/i,choices:[['Чёрный',['crni','crn']],['Зелёный',['zeleni','zelen']],['Травяной',['biljni','biljn']]]},
 {query:/(?:^|\s)(?:рис|риса|pirinac)(?=\s|$)/i,choices:[['Длиннозёрный',['dugo']],['Круглозёрный',['okrug']],['Басмати',['basmati']],['Жасмин',['jasmin']]]},
 {query:/(?:^|\s)(?:вода|воды|voda)(?=\s|$)/i,choices:[['Газированная',['gazirana','gaziran']],['Негазированная',['negaz']]]}
];
export function matchesType(offer,terms){
 const t=normalize(offer.name),tokens=t.split(' ');
 if(terms[0]==='milkplain')return !tokens.some(w=>/^(kisel|kis|cokolad|coko|cok|kakao|arom|ukus|prah|suvo|susen|kondenz|evapor|badem|kokos|soj|ovsen|pirinac|pocet|adapt|formul)/.test(w));
 return terms.some(term=>tokens.some(w=>w.startsWith(term)));
}
const meaningfulBrand=brand=>typeof brand==='string'&&brand.length<=80&&!/^(brend|brand|unknown|n\/a|bez brenda|-|nepoznat)$/i.test(brand.trim());
export function buildRefinement(query,offers,token,now=Date.now(),single=false){
 if(!offers.length||/^\d{8,14}$/.test(query.trim()))return null;
 const normalized=normalize(query),facets=[],options=(key,label,values)=>{if(values.length>(single?0:1))facets.push({key,label,values:values.slice(0,24)});};
 const category=types.find(x=>x.query.test(query));
 if(category&&!plainMilkQuery(query)){const groups=queryGroups(query);if(!category.choices.some(([,terms])=>groups.some(g=>g.length<=2&&g.some(t=>terms.includes(t)))))options('type','Вид',category.choices.filter(([,terms])=>offers.some(o=>matchesType(o,terms))).map(([label,terms])=>({label,value:terms})));}
 const brands=[...new Set(offers.map(o=>o.brand).filter(meaningfulBrand))];
 if(!brands.some(b=>normalized.includes(normalize(b))))options('brand','Бренд',brands.map(b=>({label:b,value:b})));
 if(!volumeQuery(query)&&!weightQuery(query)){const packs=new Map();for(const o of offers){const m=measure(o.name);if(m&&(!energyQuery(query)||m.kind==='volume'))packs.set(m.kind+':'+m.amount,m);}const sizes=[...packs.values()],label=sizes.every(m=>m.kind==='volume')?'Объём':sizes.every(m=>m.kind==='weight')?'Вес':'Упаковка';options('pack',label,[...packs.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.amount-b.amount).map(m=>({label:m.label,value:{kind:m.kind,amount:m.amount}})));}
 if(!/\d\s*[.,]?\d*\s*%/.test(query)&&/(молок|mlek|jogurt|йогурт|сметан|pavlak|сливк)/i.test(query)){const fat=[...new Set(offers.flatMap(o=>{const m=o.name.match(/(\d+(?:[.,]\d+)?)\s*%/);return m?[m[1].replace(',','.')]:[];}))];options('fat','Жирность',fat.sort((a,b)=>Number(a)-Number(b)).map(f=>({label:f+'%',value:f})));}
 if(!/(?:e14|e27|gu10|g9|g4|h4|h7)/i.test(query)){const sockets=[...new Set(offers.map(o=>o.traits?.socket).filter(Boolean))];options('socket','Цоколь',sockets.map(s=>({label:s,value:s})));}
 return facets.length?{query,token,facets,selected:{},expires:now+15*60000}:null;
}
export function validPackChoice(query,pack){
 if(energyQuery(query)&&pack?.kind!=='volume')return false;
 const policy=measurePolicy(query);return policy!=='piece'&&(milkQuery(query)&&!plainMilkQuery(query)||policy==='either'||policy===pack?.kind);
}
export function refinementFilters(draft){const filters={};for(const f of draft.facets){const i=draft.selected[f.key];if(Number.isInteger(i)&&f.values[i]&&(f.key!=='pack'||validPackChoice(draft.query,f.values[i].value)))filters[f.key]=f.values[i].value;}return filters;}

export function filterLabels(filters={}){
 const labels=[];if(filters.type){const choice=types.flatMap(t=>t.choices).find(([,value])=>JSON.stringify(value)===JSON.stringify(filters.type));if(choice)labels.push(choice[0]);}
 if(filters.brand)labels.push(filters.brand);
 if(filters.pack){const n=filters.pack.amount;labels.push(filters.pack.kind==='volume'?(n>=1000?(n/1000)+' л':n+' мл'):(n>=1000?(n/1000)+' кг':n+' г'));}
 if(filters.fat)labels.push(filters.fat+'%');if(filters.socket)labels.push(filters.socket);return labels;
}

// Saved choices can fall outside the current sample of public catalogue rows.
// Keep them explicit instead of silently dropping them when editing a basket.
export function restoreRefinement(draft,filters={}){
 const labels={type:'Вид',brand:'Бренд',pack:'Упаковка',fat:'Жирность',socket:'Цоколь'};
 for(const [key,value] of Object.entries(filters)){
  if(!labels[key]||key==='pack'&&!validPackChoice(draft.query,value))continue;
  let facet=draft.facets.find(f=>f.key===key);if(!facet){facet={key,label:labels[key],values:[]};draft.facets.push(facet);}
  let index=facet.values.findIndex(v=>JSON.stringify(v.value)===JSON.stringify(value));
  if(index<0){const label=filterLabels({[key]:value})[0];if(!label)continue;if(facet.values.length>=24)facet.values.pop();facet.values.push({label,value});index=facet.values.length-1;}
  draft.selected[key]=index;
 }
 return draft;
}
