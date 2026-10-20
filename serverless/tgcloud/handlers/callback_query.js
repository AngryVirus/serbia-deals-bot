import { db,api,InputFile } from 'sdk';
import { Bot } from '../lib/bot.js';
export default async function(callback_query,ctx){return new Bot({db,api,InputFile}).handle(ctx?.update||{callback_query});}
