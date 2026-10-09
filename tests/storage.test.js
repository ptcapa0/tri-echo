import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY,MAX_SAVE_BYTES,SaveValidationError,normalizeSave,loadSave,save,importSave,exportSave} from '../js/storage.js';
import {MODES,TABLE_STYLES,TRAINING_DISCIPLINES} from '../js/gameplay.js';
const norm=value=>normalizeSave(value);
const file=value=>new Blob([JSON.stringify(value)]);
const rejects=value=>assert.throws(()=>norm(value),SaveValidationError);
const store=raw=>({raw,writes:0,getItem(key){assert.equal(key,KEY);return this.raw},setItem(key,text){assert.equal(key,KEY);this.writes++;this.raw=text}});

test('COMP-01: minimal import and local empty save have fresh canonical defaults',()=>{
 const minimal=norm({stats:{}});
 assert.deepEqual(minimal,loadSave(store('{}')));
 assert.equal(minimal.mode,'golf');assert.equal(minimal.difficulty,'normal');assert.equal(minimal.tableStyle,'echo');
 assert.deepEqual(minimal.stats,{shots:0,successes:0,recent:[]});
 assert.deepEqual(minimal.best,{flow:0,zen:0,precision:0,rush:0,daily:0});
 assert.deepEqual(minimal.settings,{sound:true,haptics:true,reducedMotion:false});
 assert.equal(minimal.tutorial,false);assert.equal(minimal.trainingDiscipline,'golf');assert.equal(minimal.trickDiscipline,'golf');
});
test('COMP-01/02: populated legacy progress canonicalizes without losing recognized data',async()=>{
 const legacy={best:{flow:8,zen:9,precision:10,rush:11,golf:12,extension:99},bestStreak:4,stats:{shots:3,successes:9,recent:Array.from({length:20},(_,i)=>i%2===0)},dailies:['2030-02-28','2024-02-29','2030-02-28'],achievements:[{id:'old',desc:'legacy',date:'2026-10-09T10:30:00.123Z'},{id:'old'}],settings:{sound:false,haptics:false,reducedMotion:true,contactPos:{x:0,y:1}},mode:'precision',difficulty:'adaptive',tableStyle:'snooker',trainingDiscipline:'snooker',trickDiscipline:'british',tutorial:true,extension:{a:1}};
 const before=structuredClone(legacy),result=norm(legacy);
 assert.deepEqual(legacy,before);assert.equal(result.mode,'golf');assert.equal(result.best.golf,12);assert.equal(result.best.rush,11);assert.equal(result.best.extension,undefined);
 assert.equal(result.stats.successes,9);assert.deepEqual(result.stats.recent,legacy.stats.recent.slice(-12));
 assert.deepEqual(result.dailies,['2030-02-28','2024-02-29']);assert.deepEqual(result.achievements[1],{id:'old',desc:''});assert.equal(Object.hasOwn(result.achievements[1],'date'),false);
 assert.deepEqual(norm(result),result);assert.deepEqual(await importSave(exportSave(result)),result);
 result.settings.contactPos.x=.8;result.best.flow=200;result.stats.recent.push(false);assert.deepEqual(legacy,before);
 const baseline=loadSave(store('{}'));assert.deepEqual(await importSave(exportSave(baseline)),baseline);
});
test('VAL-01: recognizable own stats record required for imports',async()=>{
 for(const value of [null,[],42,true,'save',{}, {stats:null},{stats:[]},{stats:1}])rejects(value);
 for(const text of ['','{bad','null','[]','{}'])await assert.rejects(importSave(new Blob([text])),SaveValidationError);
 rejects(Object.create({stats:{}}));
});
test('SEC-03: forbidden keys anywhere are rejected without prototype changes',()=>{
 const before=Object.getOwnPropertyDescriptors(Object.prototype);
 for(const key of ['__proto__','prototype','constructor'])for(const path of ['root','extension','achievement','best']){
  const poison=JSON.parse(`{"${key}":{"polluted":true}}`);
  const v={stats:{}};
  if(path==='root')Object.defineProperty(v,key,{value:poison,enumerable:true});
  if(path==='extension')v.extension=[{nested:poison}];
  if(path==='achievement')v.achievements=[{id:'ok',extension:poison}];
  if(path==='best')v.best=poison;
  rejects(v);
 }
 assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype),before);
});
test('SEC-03: never evaluate accessors; inherited fields and class instances rejected',()=>{
 let calls=0;const accessor={stats:{},get ignored(){calls++;return {}}};rejects(accessor);assert.equal(calls,0);
 const nested={stats:{},extension:{get hidden(){calls++;return 1}}};rejects(nested);assert.equal(calls,0);
 class Save{constructor(){this.stats={}}}rejects(new Save());
 rejects({stats:Object.create({shots:7})});
 const inherited=Object.create({stats:{}});rejects(inherited);
});
test('VAL-02/04: safe integer counters accept independent bounds and reject coercion',()=>{
 for(const field of ['bestStreak','stats.shots','stats.successes','best.golf']){
  const fixture=value=>{const v={stats:{}};const parts=field.split('.');if(parts.length===1)v[field]=value;else {v[parts[0]]??={};v[parts[0]][parts[1]]=value}return v};
  for(const value of [0,Number.MAX_SAFE_INTEGER])assert.doesNotThrow(()=>norm(fixture(value)));
  for(const value of [-1,1.2,Number.MAX_SAFE_INTEGER+1,Infinity,NaN,'1',null,true,{}])rejects(fixture(value));
 }
 assert.equal(norm({stats:{shots:0,successes:100}}).stats.successes,100);
});
test('VAL-02: present malformed recognized fields are rejected',()=>{
 for(const field of ['best','settings'])for(const value of [null,[],false,'record'])rejects({stats:{},[field]:value});
 for(const field of ['dailies','achievements'])for(const value of [null,{},true,'array'])rejects({stats:{},[field]:value});
 for(const field of ['sound','haptics','reducedMotion'])for(const value of [1,0,'true',null,{},[]])rejects({stats:{},settings:{[field]:value}});
 for(const value of [1,'false',null,{},[]])rejects({stats:{},tutorial:value});
 for(const value of [null,{},true,[1],[null],['true']])rejects({stats:{recent:value}});
 for(const value of [null,[],{x:0},{x:'0',y:0},{x:NaN,y:0},{x:0,y:Infinity},{x:-.01,y:0},{x:1.01,y:0}])rejects({stats:{},settings:{contactPos:value}});
 assert.deepEqual(norm({stats:{},settings:{contactPos:{x:1,y:0}}}).settings.contactPos,{x:1,y:0});
});
test('VAL-03: all production enums accepted; historical modes fall back to Golf',()=>{
 const enums={mode:Object.keys(MODES),tableStyle:Object.keys(TABLE_STYLES),trainingDiscipline:Object.keys(TRAINING_DISCIPLINES),trickDiscipline:['golf','classic','american','british'],difficulty:['relaxed','normal','hard','adaptive']};
 for(const [key,values] of Object.entries(enums)){
  for(const value of values)assert.equal(norm({stats:{},[key]:value})[key],value);
  for(const value of ['unknown',null,[],{},1])rejects({stats:{},[key]:value});
 }
 for(const mode of ['flow','zen','precision','rush'])assert.equal(norm({stats:{},mode}).mode,'golf');
 rejects({stats:{},trainingDiscipline:'british'});rejects({stats:{},trickDiscipline:'snooker'});
});
test('VAL-04: maximum arrays accepted, excess rejected before normalization',()=>{
 assert.equal(norm({stats:{recent:Array(10000).fill(true)}}).stats.recent.length,12);
 rejects({stats:{recent:Array(10001).fill(true)}});
 assert.deepEqual(norm({stats:{},dailies:Array(10000).fill('2024-02-29')}).dailies,['2024-02-29']);
 rejects({stats:{},dailies:Array(10001).fill('2024-02-29')});
 assert.equal(norm({stats:{},achievements:Array.from({length:1000},()=>({id:'x'}))}).achievements.length,1000);
 rejects({stats:{},achievements:Array(1001).fill({id:'x'})});
});
test('VAL-04: UTF-16 string limits and optional achievement fields',()=>{
 assert.equal(norm({stats:{},achievements:[{id:'😀'.repeat(64),desc:'d'.repeat(512)}]}).achievements[0].id.length,128);
 for(const entry of [{},{id:''},{id:42},{id:'i'.repeat(129)},{id:'😀'.repeat(65)},{id:'ok',desc:'d'.repeat(513)},{id:'ok',desc:null},{id:'ok',date:null}])rejects({stats:{},achievements:[entry]});
 // ISO fractions are accepted up to the specified timestamp text bound.
 const date='2026-10-09T10:30:00.'+'1'.repeat(43)+'Z';assert.equal(date.length,64);
 assert.equal(norm({stats:{},achievements:[{id:'x',date}]}).achievements[0].date,date);
 rejects({stats:{},achievements:[{id:'x',date:date.replace('Z','1Z')}]});
});
test('VAL-05: real UTC calendar dates and timestamps; no invented dates',()=>{
 for(const date of ['2024-02-29','2000-02-29','0000-01-01','9999-12-31'])assert.doesNotThrow(()=>norm({stats:{},dailies:[date]}));
 for(const date of ['2023-02-29','1900-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','2026-1-01','2026-01-01Z',1])rejects({stats:{},dailies:[date]});
 for(const date of ['2026-10-09T23:59:59Z','2024-02-29T00:00:00.123Z','2026-10-09T10:30Z'])assert.doesNotThrow(()=>norm({stats:{},achievements:[{id:'x',date}]}));
 for(const date of ['2023-02-29T00:00:00Z','2026-10-09T24:00:00Z','2026-10-09T12:60:00Z','2026-10-09T12:00:60Z','2026-10-09T00:00:00+00:00','2026-10-09','not date'])rejects({stats:{},achievements:[{id:'x',date}]});
});
test('VAL-04: depth includes ignored arrays/records; cycles rejected',()=>{
 const fixture=depth=>{const v={stats:{}};let cursor=v;for(let i=1;i<depth;i++){cursor.ext=i%2===0?[]:{};cursor=cursor.ext}return v};
 assert.doesNotThrow(()=>norm(fixture(8)));rejects(fixture(9));
 const cycle={stats:{}};cycle.ext=cycle;rejects(cycle);
});
test('VAL-04: file metadata/read/UTF-8 limits and exact byte boundary',async()=>{
 const text='{"stats":{}}',padding=' '.repeat(MAX_SAVE_BYTES-new TextEncoder().encode(text).length);
 assert.deepEqual(await importSave(new Blob([text+padding])),norm({stats:{}}));
 await assert.rejects(importSave(new Blob([text+padding+' '])),e=>e.code==='oversize');
 let read=false;await assert.rejects(importSave({size:MAX_SAVE_BYTES+1,text(){read=true}}),e=>e.code==='oversize');assert.equal(read,false);
 for(const file of [null,{}, {size:NaN,text(){}},{size:Infinity,text(){}},{size:-1,text(){}},{size:'1',text(){}}])await assert.rejects(importSave(file),SaveValidationError);
 await assert.rejects(importSave({size:0,text:async()=>null}),SaveValidationError);
 await assert.rejects(importSave({size:0,text:async()=>{throw Error('read failure')}}));
 const unicode=JSON.stringify({stats:{},ignored:'😀'.repeat(262144)});
 assert.ok(unicode.length<MAX_SAVE_BYTES);assert.ok(new TextEncoder().encode(unicode).length>MAX_SAVE_BYTES);
 await assert.rejects(importSave({size:0,text:async()=>unicode}),e=>e.code==='oversize');
 const unknownType=new Blob([text],{type:'text/plain'});assert.deepEqual(await importSave(unknownType),norm({stats:{}}));
});
test('SEC-01: HTML-like ID remains literal recognized text',async()=>{
 const payload='<img src=x onerror="window.auditImportExecuted=true">';
 const result=await importSave(file({stats:{},achievements:[{id:payload}]}));assert.equal(result.achievements[0].id,payload);
});
test('LOAD-01: invalid local bytes preserved; defaults independent; guarded getter',()=>{
 for(const raw of ['{bad','null','[]','{"stats":{"shots":"1"}}','{"extension":{"constructor":1}}',' '.repeat(MAX_SAVE_BYTES+1)]){
  const memory=store(raw);assert.equal(loadSave(memory).stats.shots,0);assert.equal(memory.raw,raw);assert.equal(memory.writes,0);
 }
 const a=loadSave(store('{}'));a.stats.recent.push(true);a.best.daily=88;a.settings.sound=false;
 const b=loadSave(store('{}'));assert.equal(b.best.daily,0);assert.deepEqual(b.stats.recent,[]);assert.equal(b.settings.sound,true);
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try{Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('denied getter')}});assert.deepEqual(loadSave(),b)}finally{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage}
});
test('TX-02: save boundary propagates single atomic write failure, no rollback or input mutation',()=>{
 const previous='{"stats":{"shots":7}}',candidate=norm({stats:{shots:99}}),before=structuredClone(candidate);let writes=0;
 const memory={raw:previous,setItem(){writes++;throw new DOMException('denied','QuotaExceededError')}};
 assert.throws(()=>save(candidate,memory));assert.equal(writes,1);assert.equal(memory.raw,previous);assert.deepEqual(candidate,before);
});
