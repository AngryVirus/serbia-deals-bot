import {safe,money} from './domain.js';
export function basketSummary(result){
 if(!result.items.length)return '<b>Корзина пока пустая</b>\nДобавьте список покупок.';
 const seen=new Set(),stores=result.stores.filter(s=>{if(seen.has(s.source))return false;seen.add(s.source);return true;}).slice(0,4);
 if(!stores.length)return '<b>Цены не найдены</b>\n\nУточните названия товаров в корзине.';
 return '<b>Где выгоднее корзина?</b>\n\n'+stores.map(s=>`<b>${safe(s.chain||s.name)}</b> — ${money(s.total)}\n${s.found===result.items.length?'Весь список':`Только ${s.found} из ${result.items.length} товаров`}`).join('\n\n')+(result.estimated?'\n\nПодбор по названию: вид товара и упаковка могут различаться.':'\n\nСравниваем выбранные товары.')+'\nНаличие и цены филиала могут отличаться.';
}
export function basketNetworks(result){const seen=new Set();return result.stores.filter(s=>{if(seen.has(s.source))return false;seen.add(s.source);return true;});}
