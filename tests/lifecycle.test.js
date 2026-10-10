import test from 'node:test';
import assert from 'node:assert/strict';
import {RoundTaskController} from '../js/rules.js';
import {AudioFX} from '../js/audio.js';

function harness(){
 let now=0,id=0;const queue=new Map(),retired=[];
 const tasks=new RoundTaskController((fn,delay)=>{const key=++id;queue.set(key,{fn,due:now+delay});return key},key=>{const entry=queue.get(key);if(entry)retired.push(entry.fn);queue.delete(key)},()=>now);
 function advance(ms){const end=now+ms;while(true){const entry=[...queue].filter(([,v])=>v.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!entry)break;now=entry[1].due;queue.delete(entry[0]);entry[1].fn()}now=end}
 return{tasks,queue,retired,advance};
}

test('suspension freezes remaining delay and repeated events cannot duplicate a transition',()=>{
 const h=harness();let count=0;h.tasks.schedule(260,()=>count++);h.advance(100);h.tasks.suspend();h.tasks.suspend();assert.equal(h.queue.size,0);
 h.advance(10000);assert.equal(count,0);h.tasks.resume();h.tasks.resume();assert.equal(h.queue.size,1);h.advance(159);assert.equal(count,0);h.advance(1);assert.equal(count,1);h.tasks.resume();h.advance(1000);assert.equal(count,1);assert.equal(h.tasks.tasks.size,0);
});
test('callbacks queued before suspend or before rearm cannot execute',()=>{
 const h=harness();let count=0;h.tasks.schedule(10,()=>count++);h.tasks.suspend();const old=h.retired[0];old();assert.equal(count,0);h.tasks.resume();old();assert.equal(count,0);h.advance(10);old();assert.equal(count,1);
});
test('a new round during suspension discards old callbacks and preserves suspension for new work',()=>{
 const h=harness();const calls=[];h.tasks.schedule(20,()=>calls.push('old'));h.tasks.suspend();const old=h.retired[0];h.tasks.beginRound();h.tasks.schedule(5,()=>calls.push('new'));assert.equal(h.queue.size,0);h.advance(1000);h.tasks.resume();old();h.advance(5);assert.deepEqual(calls,['new']);
});
test('zero-delay and nested completion/menu work executes once after a second suspension',()=>{
 const h=harness();const calls=[];h.tasks.suspend();h.tasks.schedule(0,()=>{calls.push('completion');h.tasks.schedule(800,()=>calls.push('menu'))});h.advance(100);assert.deepEqual(calls,[]);h.tasks.resume();h.advance(0);assert.deepEqual(calls,['completion']);h.advance(200);h.tasks.suspend();h.advance(9999);h.tasks.resume();h.advance(599);assert.deepEqual(calls,['completion']);h.advance(1);assert.deepEqual(calls,['completion','menu']);
});
test('callback can begin a round without allowing sibling callbacks from previous epoch',()=>{
 const h=harness();const calls=[];h.tasks.schedule(1,()=>{calls.push('new-hole');h.tasks.beginRound();h.tasks.schedule(5,()=>calls.push('own'))});h.tasks.schedule(2,()=>calls.push('stale'));h.advance(10);assert.deepEqual(calls,['new-hole','own']);assert.equal(h.tasks.timers.size,0);
});
test('resume does not execute callbacks synchronously, preserving input gate until reconciliation',()=>{
 const h=harness();let lock=true;h.tasks.schedule(0,()=>lock=false);h.tasks.suspend();h.tasks.resume();assert.equal(lock,true);h.advance(0);assert.equal(lock,false);
});
test('audio never creates a context on suspension/return and a disabled gesture cannot create one',()=>{
 const audio=new AudioFX();audio.suspend();assert.equal(audio.ctx,null);audio.enabled=false;audio.unlock();assert.equal(audio.ctx,null);
});
test('audio suspend discards an old celebration and tolerates failed browser operations',async()=>{
 const audio=new AudioFX(),tones=[];audio.tone=freq=>tones.push(freq);audio.success();audio.ctx={suspend:()=>Promise.reject(new Error('suspend denied')),resume:()=>Promise.reject(new Error('resume denied'))};audio.suspend();await new Promise(resolve=>setTimeout(resolve,120));assert.deepEqual(tones,[440]);audio.unlock();await Promise.resolve();assert.equal(audio.paused,false);
 audio.ctx={suspend:()=>{throw Error('closed')},resume:()=>{throw Error('closed')}};assert.doesNotThrow(()=>audio.suspend());assert.doesNotThrow(()=>audio.unlock());
});
test('blocked AudioContext construction cannot interrupt an accepted gameplay gesture',()=>{
 const audio=new AudioFX();assert.doesNotThrow(()=>audio.unlock());assert.equal(audio.ctx,null);
});
