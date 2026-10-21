import {safe,money,normalize,queryGroups,energyQuery} from './domain.js';
import {briefName,bilingual} from './product-names.js';
// Presentation only: catalogue names, source IDs and matching remain unchanged.
export function storeLabel(name){
 const n=normalize(name);
 for(const [pattern,label] of [[/^metro(?: |$)/,'METRO'],[/^aman(?: |$)/,'Aman'],[/^lidl(?: |$)/,'Lidl'],[/^(delhaize|maxi)(?: |$)/,'Maxi'],[/^gomex(?: |$)/,'Gomex'],[/^(industrija mesa matijevic|matijevic)(?: |$)/,'Matijević'],[/^lilly(?: |$)/,'Lilly'],[/^okov(?: |$)/,'Okov']])if(pattern.test(n))return label;
 return String(name||'Магазин').trim();
}
export function storePriceLabel(name,min,max){
 const price=min===max?money(min):money(min).replace(' RSD','')+'–'+money(max),label=storeLabel(name),limit=Math.max(4,36-price.length-3);
 return (label.length>limit?label.slice(0,limit-1).trimEnd()+'…':label)+' · '+price;
}
const productGroups=[
 ['🧴',/^(sampon|sapun|dezodor|antiperspir|losion|balzam|brijac|pelen|ulosci|tampon|kozmetik)/],
 ['🧽',/^(deterdzent|prasak|omeksiv|izbeljiv|sredstv|ciscenj|sudomasin|brisac|mop$|metla|krpa|belil|fleke)/],
 ['🐾',/^(hrana|whiskas|kitekat|pedigree|posip)/],
 ['💡',/^(sijalic|zarulj|bulb|baterij|uticnic|prekidac|produzn)/],
 ['🔧',/^(busilic|odvijac|srafciger|cekic|ekser|sraf|vijak|klest|testera|smirgl|spahtl|valjak|lepak)/],
 ['🏠',/^(serp|lonac|tiganj|tanjir|cinij|solj|casa$|case$|kasik|viljusk|kuval|cajnik|blender|mikser|toster|pegl|usisivac|vaga$|ventilator|grejalic|jastuk|jorgan|carsav|polic|stolic|saksij)/],
 ['🍞',/^(hleb|kruh|kroasan|croissant|zemick|peciv|djevrek|bagel|prezl|dvopek)/],
 ['🍪',/^(donut|doughnut|krofn|donat$|keks|kolac|mafin|muffin|torta|palacink|vafl|medenjak|cips|chips|kokic|popcorn|smok|flips|gric|kreker|bombon|praline|cokolad|biskvit|sladoled)/],
 ['🥤',/^(energet|energy|redbull$|monster$|voda|water|sok$|juice|cola|kola$|limunad|tonic|tonik|kvas$|pivo|beer|vino|rakij|whisky|whiskey|vodka|votka|rum$|gin$|dzin|liker|cider|sajder)/],
 ['🥛',/^(mleko|mlijeko|jogurt|yogurt|kefir|pavlak|sir$|sirev|maslac|mocarel|mozzarella|parmezan|parmesan|feta|margarin|jaja|jaje)/],
 ['🐟',/^(riba|losos|tun[ae]?$|pastrmk|skus|sardin|haring|oslic|gambor|kozic|shrimp|lignj|dagnj|hobotnic)/],
 ['🥩',/^(meso|pile|pilet|curet|goved|junec|svinj|jagnj|patk|kunic|jetr|kobasic|salam|virsl|sunka|slanina|rebr|batak|stejk|steak|mleven)/],
 ['🥬',/^(krastav|paradajz|rajcic|krompir|krumpir|sargarep|mrkv|luk$|cesnjak|kupus|tikvic|patlidzan|paprik|salat|jabuk|banan|pomorand|narand|mandarin|sljiv|limun|krusk|jagod|grozd|lubenic|avokad|persun|parsley|mirodj|kopar|korijand|bosilj|ruzmar|timijan|menta|rukol|spanac|celer|cvekl|rotkv|bundev|brokol|karfiol|breskv|kajsij|nektarin|tresnj|visnj|malin|kupin|borovnic|ribizl|brusnic|grejp|ananas|mango|kivi|dinj|sampinjon|pecurk|gljiv)/],
 ['🛒',/^(kafa|coffee|caj$|brasno|secer|pirinac|riza$|testenin|pasta|ulje|pesto|sos$|umak|preliv|zacin|badem|lesnik|pistac|susam|cimet|so$|sol$|sirce|senf|ajvar|pasulj|grasak|sociv|kukuruz|musli|granola|ovsen|dzem|pekmez)/]
];
export function productIcon(name){
 // Use the existing local aliases; never send private shopping text to a service.
 const text=String(name),n=normalize(text);
 if(/(?:^| )(?:telo|tela|tijelo|lice|lica|zub[a-z]*)(?: |$)/.test(n)||/молочко.*тел|зубн/i.test(text))return '🧴';
 if(/(?:разрыхлител|бытов.*хими|фрукт|овощ)/i.test(text))return /разрыхлител/i.test(text)?'🛒':/бытов/i.test(text)?'🧽':'🥬';
 if(/(?:^| )prasak za peciv/.test(n))return '🛒';
 if(energyQuery(name))return '🥤';
 let groups;try{groups=queryGroups(name);}catch{groups=text.split(/\s+/).map(token=>{try{return queryGroups(token).flat();}catch{return [normalize(token)];}});}
 for(const terms of groups){
  for(const [icon,pattern] of productGroups)if(terms.some(t=>pattern.test(t)))return icon;
 }
 return '🛍️';
}
export function basketNetworks(result){const seen=new Set();return result.stores.filter(s=>{if(seen.has(s.source))return false;seen.add(s.source);return true;});}
export function basketSummary(result,{offset=0,itemOffset=0,names=new Map()}={}){
 if(!result.items.length)return '<b>Корзина пока пустая</b>\nДобавьте список покупок.';
 const networks=basketNetworks(result),stores=networks.slice(offset,offset+2),items=result.items.slice(itemOffset,itemOffset+5),reasons=new Map((result.unresolved||[]).map(i=>[i.id,i.reason]));
 if(!stores.length)return '<b>Цены не найдены</b>\n\n'+items.map(i=>'✕ '+safe(i.product?briefName(names.get(i.name)||bilingual(null,i.name)):i.query)+(reasons.has(i.id)?' — '+safe(reasons.get(i.id)):'')).join('\n')+'\n\nУточните названия товаров в корзине.';
 const one=result.bestSingle,multi=result.split;
 const unresolved=result.unresolved?.length||0,missing=Math.max(0,(multi?.missing.length||0)-unresolved),count=multi?.networks||0,networkWord=count===1?'сеть':count>=2&&count<=4?'сети':'сетей';
 const overview=(one?'В одной сети: '+safe(storeLabel(one.name))+' · '+(result.estimated?'от ':'')+money(one.total):'Полной корзины в одной сети пока нет')+'\n'+(multi?.complete?(count>1?'В разных сетях: ':'По предложениям одной сети: ')+(result.estimated?'от ':'')+money(multi.total)+' · '+count+' '+networkWord:'Нет цены: '+missing+' · Уточнить: '+unresolved)+(result.savings>0?'\nЭкономия на выбранных товарах: '+money(result.savings)+' без стоимости поездок':'');
 return '<b>Где выгоднее корзина?</b>\n'+(result.bestSingle!==undefined?overview+'\n'+(result.pending?.length&&result.pending.length<result.items.length?'Выбрано: '+(result.items.length-result.pending.length)+' · Подбор: '+result.pending.length+'\n':''):'')+`Магазины ${offset+1}–${Math.min(offset+2,networks.length)} из ${networks.length}`+(result.items.length>5?` · Товары ${itemOffset+1}–${Math.min(itemOffset+5,result.items.length)} из ${result.items.length}`:'')+'\n\n'+stores.map(s=>{
  const found=new Map(s.items.map(i=>[i.id,i])),ready=s.ready??s.found,complete=s.complete??s.found===result.items.length,clarify=s.items.filter(i=>i.ambiguous).length,absent=result.items.length-s.items.length;
  return `<b>${safe(storeLabel(s.chain||s.name))}</b> · ${complete?'Весь список':`Только ${ready} из ${result.items.length}`} \n`+(complete?'':`Рассчитано: ${ready} · Уточнить: ${clarify} · Нет цены: ${absent}\n`)+items.map(item=>{
   const row=found.get(item.id),name=item.product?briefName(names.get(item.name)||bilingual(null,item.name),65):item.query.slice(0,65);
   if(row?.ambiguous)return `${productIcon(item.product?item.name:item.query)} ↪ ${safe(name)} — выберите вид или упаковку`;
   return row?`${productIcon(item.product?item.name:item.query)} ${row.estimated?'~':'✓'} ${safe(name)}${row.demand?' · нужно '+safe(row.demand)+' / '+row.quantity+' уп.'+(row.supplied!==row.demand?' · получите '+safe(row.supplied):''):' × '+row.quantity} — ${row.estimated?'от ':''}${money(row.total)}${row.variant?' · '+safe(row.variant):''}${row.unitPrice?' · '+safe(row.unitPrice):''}`:`${productIcon(item.product?item.name:item.query)} ✕ ${safe(name)} — ${safe(reasons.get(item.id)||'не найдено')}`;
  }).join('\n')+(ready?`\n<b>${complete?'Весь список':'Найденные товары'}:</b> ${result.estimated?'от ':''}${money(s.total)}`:'\nИтог после выбора вида или упаковки');
 }).join('\n\n')+(result.estimated?'\n\nПодбор по названию: вид товара и упаковка могут различаться. Уточняемые позиции не входят в итог.':'\n\nСравниваем выбранные товары.')+'\nНаличие и цены филиала могут отличаться.';
}
