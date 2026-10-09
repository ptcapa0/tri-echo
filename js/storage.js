import {MODES,TABLE_STYLES,TRAINING_DISCIPLINES} from './gameplay.js';

const KEY='triEchoSaveV1';
export const MAX_SAVE_BYTES=1048576;
const LEGACY_MODES=['flow','zen','precision','rush'];
const defaults={best:{flow:0,zen:0,precision:0,rush:0,daily:0},bestStreak:0,dailies:[],achievements:[],stats:{shots:0,successes:0,recent:[]},settings:{sound:true,haptics:true,reducedMotion:false},mode:'golf',difficulty:'normal',tableStyle:'echo',trainingDiscipline:'golf',trickDiscipline:'golf',tutorial:false};
export class SaveValidationError extends Error {
 constructor(code='invalid'){super('Invalid progress save');this.name='SaveValidationError';this.code=code}
}
function invalid(){throw new SaveValidationError()}
function record(v){if(v===null||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype)invalid();return v}
// Inspect descriptors before reading any values, including ignored extensions.
// Root counts as level 1; cycles, custom prototypes and accessors are rejected.
function inspect(v,depth=1){
 if(v===null||typeof v!=='object')return;
 if(depth>8)invalid();
 if(Array.isArray(v)){if(Object.getPrototypeOf(v)!==Array.prototype)invalid()}else record(v);
 for(const key of Reflect.ownKeys(v)){
  if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))invalid();
  const descriptor=Object.getOwnPropertyDescriptor(v,key);
  if(!Object.hasOwn(descriptor,'value'))invalid();
  inspect(descriptor.value,depth+1);
 }
}
function own(v,key,fallback,check){return Object.hasOwn(v,key)?check(v[key]):fallback}
function count(v){if(!Number.isSafeInteger(v)||v<0)invalid();return v}
function bool(v){if(typeof v!=='boolean')invalid();return v}
function text(v,max,nonempty=false){if(typeof v!=='string'||v.length>max||(nonempty&&!v.length))invalid();return v}
function choice(v,values){if(typeof v!=='string'||!values.includes(v))invalid();return v}
function list(v,max,check){if(!Array.isArray(v)||v.length>max)invalid();return Array.from(v,check)}
function calendar(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))invalid();
 const date=new Date(`${v}T00:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==v)invalid();
 return v;
}
function timestamp(v){
 text(v,64);
 const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(v);
 if(!match)invalid();
 calendar(match[1]);
 if(Number(match[2])>23||Number(match[3])>59||Number(match[4]||0)>59||!Number.isFinite(Date.parse(v)))invalid();
 return v;
}
function achievement(v){
 record(v);
 const result={id:own(v,'id',undefined,x=>text(x,128,true)),desc:own(v,'desc','',x=>text(x,512))};
 if(result.id===undefined)invalid();
 if(Object.hasOwn(v,'date'))result.date=timestamp(v.date);
 return result;
}
function position(v){record(v);const coordinate=x=>{if(typeof x!=='number'||!Number.isFinite(x)||x<0||x>1)invalid();return x};if(!Object.hasOwn(v,'x')||!Object.hasOwn(v,'y'))invalid();return{x:coordinate(v.x),y:coordinate(v.y)}}
export function normalizeSave(value,{source='import'}={}){
 inspect(value);record(value);
 const result=structuredClone(defaults);
 if(source==='import'&&!Object.hasOwn(value,'stats'))invalid();
 if(Object.hasOwn(value,'best')){
  const best=record(value.best);
  for(const key of [...Object.keys(MODES),...LEGACY_MODES])if(Object.hasOwn(best,key))result.best[key]=count(best[key]);
 }
 result.bestStreak=own(value,'bestStreak',0,count);
 if(Object.hasOwn(value,'stats')){
  const stats=record(value.stats);
  result.stats={shots:own(stats,'shots',0,count),successes:own(stats,'successes',0,count),recent:own(stats,'recent',[],x=>list(x,10000,bool).slice(-12))};
 }
 result.dailies=own(value,'dailies',[],x=>[...new Set(list(x,10000,calendar))]);
 result.achievements=own(value,'achievements',[],x=>list(x,1000,achievement));
 if(Object.hasOwn(value,'settings')){
  const settings=record(value.settings);
  for(const key of ['sound','haptics','reducedMotion'])result.settings[key]=own(settings,key,result.settings[key],bool);
  if(Object.hasOwn(settings,'contactPos'))result.settings.contactPos=position(settings.contactPos);
 }
 result.mode=own(value,'mode','golf',x=>LEGACY_MODES.includes(x)?'golf':choice(x,Object.keys(MODES)));
 result.difficulty=own(value,'difficulty','normal',x=>choice(x,['relaxed','normal','hard','adaptive']));
 result.tableStyle=own(value,'tableStyle','echo',x=>choice(x,Object.keys(TABLE_STYLES)));
 result.trainingDiscipline=own(value,'trainingDiscipline','golf',x=>choice(x,Object.keys(TRAINING_DISCIPLINES)));
 result.trickDiscipline=own(value,'trickDiscipline','golf',x=>choice(x,['golf','classic','american','british']));
 result.tutorial=own(value,'tutorial',false,bool);
 return result;
}
function parseSave(text,source){
 if(typeof text!=='string')invalid();
 if(text.length>MAX_SAVE_BYTES||new TextEncoder().encode(text).byteLength>MAX_SAVE_BYTES)throw new SaveValidationError('oversize');
 let value;try{value=JSON.parse(text)}catch{invalid()}
 return normalizeSave(value,{source});
}
export function loadSave(store){try{return parseSave((store??globalThis.localStorage).getItem(KEY)??'{}','local')}catch{return structuredClone(defaults)}}
export function save(data,store=localStorage){store.setItem(KEY,JSON.stringify(data))}
export function exportSave(data){return new Blob([JSON.stringify(data,null,2)],{type:'application/json'})}
export async function importSave(file){
 if(!file||typeof file.size!=='number'||!Number.isFinite(file.size)||file.size<0||typeof file.text!=='function')invalid();
 if(file.size>MAX_SAVE_BYTES)throw new SaveValidationError('oversize');
 return parseSave(await file.text(),'import');
}
export {KEY};
