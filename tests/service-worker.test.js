import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('service worker deletes only obsolete TRI//ECHO caches',async()=>{
 const handlers={},deleted=[],keys=['tri-echo-v4.2.1','tri-echo-v4.3.0','tri-echo-v4.3.1','tri-echo-v4.3.2','outro-jogo-v1','qualquer-cache-X'];
 let activation,claimed=false;
 const context={
  self:{addEventListener:(type,handler)=>handlers[type]=handler,clients:{claim:async()=>{claimed=true}}},
  caches:{keys:async()=>keys,delete:async key=>{deleted.push(key);return true}}
 };
 vm.runInNewContext(await readFile('sw.js','utf8'),context);
 handlers.activate({waitUntil:promise=>activation=promise});
 await activation;
 assert.deepEqual(deleted,['tri-echo-v4.2.1','tri-echo-v4.3.0','tri-echo-v4.3.1']);
 assert.equal(claimed,true);
});
