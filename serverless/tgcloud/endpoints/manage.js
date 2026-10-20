import {db,api} from 'sdk';
import {manage} from '../lib/manage.js';
export default async function(input,ctx){return manage(input,ctx,{db,api});}
