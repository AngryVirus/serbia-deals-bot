import {safe,money} from './domain.js';
import {briefName,bilingual} from './product-names.js';
export function basketNetworks(result){const seen=new Set();return result.stores.filter(s=>{if(seen.has(s.source))return false;seen.add(s.source);return true;});}
export function basketSummary(result,{offset=0,itemOffset=0,names=new Map()}={}){
 if(!result.items.length)return '<b>Корзина пока пустая</b>\nДобавьте список покупок.';
 const networks=basketNetworks(result),stores=networks.slice(offset,offset+2),items=result.items.slice(itemOffset,itemOffset+5),reasons=new Map((result.unresolved||[]).map(i=>[i.id,i.reason]));
 if(!stores.length)return '<b>Цены не найдены</b>\n\n'+items.map(i=>'✕ '+safe(i.product?briefName(names.get(i.name)||bilingual(null,i.name)):i.query)+(reasons.has(i.id)?' — '+safe(reasons.get(i.id)):'')).join('\n')+'\n\nУточните названия товаров в корзине.';
 const one=result.bestSingle,multi=result.split;
 const unresolved=result.unresolved?.length||0,missing=Math.max(0,(multi?.missing.length||0)-unresolved),count=multi?.networks||0,networkWord=count===1?'сеть':count>=2&&count<=4?'сети':'сетей';
 const overview=(one?'В одной сети: '+safe(one.name)+' · '+(result.estimated?'от ':'')+money(one.total):'В одной сети: полного расчёта нет')+'\n'+(multi?.complete?'По отдельным предложениям: '+(result.estimated?'от ':'')+money(multi.total)+' · '+count+' '+networkWord:'Нет цены: '+missing+' · Уточнить: '+unresolved)+(result.savings>0?'\nЭкономия на выбранных товарах: '+money(result.savings)+' без стоимости поездок':'');
 return '<b>Где выгоднее корзина?</b>\n'+(result.bestSingle!==undefined?overview+'\n'+(result.pending?.length&&result.pending.length<result.items.length?'Выбрано: '+(result.items.length-result.pending.length)+' · Подбор: '+result.pending.length+'\n':''):'')+`Магазины ${offset+1}–${Math.min(offset+2,networks.length)} из ${networks.length}`+(result.items.length>5?` · Товары ${itemOffset+1}–${Math.min(itemOffset+5,result.items.length)} из ${result.items.length}`:'')+'\n\n'+stores.map(s=>{
  const found=new Map(s.items.map(i=>[i.id,i])),ready=s.ready??s.found,complete=s.complete??s.found===result.items.length;
  return `<b>${safe(s.chain||s.name)}</b> · ${complete?'Весь список':`Только ${ready} из ${result.items.length}`} \n`+items.map(item=>{
   const row=found.get(item.id),name=item.product?briefName(names.get(item.name)||bilingual(null,item.name),65):item.query.slice(0,65);
   if(row?.ambiguous)return `↪ ${safe(name)} — выберите вид или упаковку`;
   return row?`${row.estimated?'~':'✓'} ${safe(name)}${row.demand?' · нужно '+safe(row.demand)+' / '+row.quantity+' уп.'+(row.supplied!==row.demand?' · получите '+safe(row.supplied):''):' × '+row.quantity} — ${row.estimated?'от ':''}${money(row.total)}${row.variant?' · '+safe(row.variant):''}${row.unitPrice?' · '+safe(row.unitPrice):''}`:`✕ ${safe(name)} — ${safe(reasons.get(item.id)||'не найдено')}`;
  }).join('\n')+(ready?`\n<b>${complete?'Весь список':'Найденные товары'}:</b> ${result.estimated?'от ':''}${money(s.total)}`:'\nИтог после выбора вида или упаковки');
 }).join('\n\n')+(result.estimated?'\n\nПодбор по названию: вид товара и упаковка могут различаться. Неоднозначное в сумму не включено.':'\n\nСравниваем выбранные товары.')+'\nНаличие и цены филиала могут отличаться.';
}
