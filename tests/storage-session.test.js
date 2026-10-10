import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgressStore,KEY,MAX_SAVE_BYTES,normalizeSave,exportSave} from '../js/storage.js';

function fixture(raw=null){
 const calls=[];let fault=null;
 const store={getItem(key){assert.equal(key,KEY);if(fault==='read')throw Error('denied');return raw},setItem(key,value){calls.push(key);if(fault==='write')throw new DOMException('full','QuotaExceededError');raw=value}};
 const statuses=[];
 const session=createProgressStore({getStore(){if(fault==='getter')throw new DOMException('denied','SecurityError');return store},onStatus:s=>statuses.push(s)});
 return {session,calls,statuses,raw:()=>raw,fault:value=>{fault=value}};
}
test('A02: absence and valid saves load without probe writes',()=>{
 for(const raw of [null,JSON.stringify({stats:{shots:7},settings:{sound:false}})]){
  const f=fixture(raw),data=f.session.load();assert.equal(data.stats.shots,raw?7:0);
  assert.deepEqual(f.calls,[]);assert.equal(f.raw(),raw);assert.equal(f.session.status.mode,'persistent');
  data.stats.shots=99;assert.notEqual(f.session.load().stats.shots,99);
 }
});
test('A02/07: getter/read failures load defaults and retry latest temporary progress',()=>{
 for(const fault of ['getter','read']){
  const f=fixture('{"stats":{"shots":8}}');f.fault(fault);const data=f.session.load();
  assert.equal(data.stats.shots,0);assert.equal(f.session.status.mode,'temporary');
  f.fault('write');data.stats.shots=3;data.settings.sound=false;
  assert.equal(f.session.save(data),false);assert.equal(f.session.retry(),false);
  assert.equal(f.raw(),'{"stats":{"shots":8}}');
  f.fault(null);assert.equal(f.session.retry(),true);assert.equal(f.session.status.mode,'persistent');
  assert.deepEqual(JSON.parse(f.raw()),data);assert.ok(f.calls.every(k=>k===KEY));
 }
});
test('A04/08: setter failure retains session export and next ordinary write recovers',async()=>{
 const f=fixture(),data=f.session.load();f.fault('write');data.stats.shots=4;
 assert.equal(f.session.save(data),false);assert.equal(f.session.load().stats.shots,4);
 assert.equal(JSON.parse(await exportSave(data).text()).stats.shots,4);
 assert.equal(f.raw(),null);f.fault(null);data.stats.shots=5;
 assert.equal(f.session.save(data),true);assert.equal(JSON.parse(f.raw()).stats.shots,5);
 assert.equal(f.session.status.mode,'persistent');
});
test('A06: corrupt bytes survive all ordinary writes and retry until strict valid import',()=>{
 for(const raw of ['{bad','{"settings":{"sound":"false"}}','x'.repeat(MAX_SAVE_BYTES+1)]){
  const f=fixture(raw),data=f.session.load();assert.equal(f.session.status.mode,'corrupt');
  data.stats.shots=2;assert.equal(f.session.save(data),false);assert.equal(f.session.retry(),false);
  assert.equal(f.raw(),raw);assert.deepEqual(f.calls,[]);
  const candidate=normalizeSave({stats:{shots:12}});f.fault('write');
  assert.throws(()=>f.session.commitImport(candidate));assert.equal(f.session.status.mode,'corrupt');
  assert.equal(f.raw(),raw);assert.equal(f.session.load().stats.shots,2);
  f.fault(null);assert.equal(f.session.commitImport(candidate),true);
  assert.equal(f.session.status.mode,'persistent');assert.deepEqual(JSON.parse(f.raw()),candidate);
 }
});
test('A09: strict import failures preserve live snapshot and old durable bytes',()=>{
 for(const fault of ['getter','write']){
  const f=fixture('{"stats":{"shots":7}}'),live=f.session.load();live.stats.shots=8;
  f.fault('write');f.session.save(live);f.fault(fault);
  const candidate=normalizeSave({stats:{shots:99},settings:{sound:false}});
  assert.throws(()=>f.session.commitImport(candidate));assert.equal(f.session.load().stats.shots,8);
  assert.equal(f.raw(),'{"stats":{"shots":7}}');f.fault(null);f.session.retry();
  assert.equal(JSON.parse(f.raw()).stats.shots,8);
 }
});
test('adapter does not mask serialization/programmer errors or expose mutable status',()=>{
 const f=fixture();f.session.load();const circular={};circular.self=circular;
 assert.throws(()=>f.session.save(circular),TypeError);assert.deepEqual(f.calls,[]);
 const status=f.session.status;status.mode='corrupt';assert.equal(f.session.status.mode,'persistent');
});
