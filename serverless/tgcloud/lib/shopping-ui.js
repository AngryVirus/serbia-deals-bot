import {safe,money} from './domain.js';
import {briefName,bilingual} from './product-names.js';
export function basketNetworks(result){const seen=new Set();return result.stores.filter(s=>{if(seen.has(s.source))return false;seen.add(s.source);return true;});}
export function basketSummary(result,{offset=0,itemOffset=0,names=new Map()}={}){
 if(!result.items.length)return '<b>Корзина пока пустая</b>\nДобавьте список покупок.';
 const networks=basketNetworks(result),stores=networks.slice(offset,offset+2),items=result.items.slice(itemOffset,itemOffset+5);
 if(!stores.length)return '<b>Цены не найдены</b>\n\n'+items.map(i=>'✕ '+safe(i.product?briefName(names.get(i.name)||bilingual(null,i.name)):i.query)).join('\n')+'\n\nУточните названия товаров в корзине.';
 return '<b>Где выгоднее корзина?</b>\n'+`Магазины ${offset+1}–${Math.min(offset+2,networks.length)} из ${networks.length}`+(result.items.length>5?` · Товары ${itemOffset+1}–${Math.min(itemOffset+5,result.items.length)} из ${result.items.length}`:'')+'\n\n'+stores.map(s=>{
  const found=new Map(s.items.map(i=>[i.id,i]));
  return `<b>${safe(s.chain||s.name)}</b> · ${s.found===result.items.length?'Весь список':`Только ${s.found} из ${result.items.length}`} \n`+items.map(item=>{
   const row=found.get(item.id),name=item.product?briefName(names.get(item.name)||bilingual(null,item.name),65):item.query.slice(0,65);
   return row?`✓ ${safe(name)} × ${row.quantity} — ${row.estimated?'от ':''}${money(row.total)}`:`✕ ${safe(name)} — не найдено`;
  }).join('\n')+`\n<b>${s.found===result.items.length?'Весь список':'Найденные товары'}:</b> ${result.estimated?'от ':''}${money(s.total)}`;
 }).join('\n\n')+(result.estimated?'\n\nПодбор по названию: вид товара и упаковка могут различаться.':'\n\nСравниваем выбранные товары.')+'\nНаличие и цены филиала могут отличаться.';
}
