import test from 'node:test';import assert from 'node:assert/strict';import {isLocalTestSeam} from '../js/testability.js';

test('rule test seam requires both an approved local hostname and explicit opt-in',()=>{
 for(const hostname of ['localhost','127.0.0.1','::1','[::1]'])assert.equal(isLocalTestSeam({hostname,search:'?triEchoTest=1'}),true);
 for(const location of [{hostname:'localhost',search:''},{hostname:'localhost',search:'?triEchoTest=0'},{hostname:'ptcapa0.github.io',search:'?triEchoTest=1'},{hostname:'example.test',search:'?triEchoTest=1'}])assert.equal(isLocalTestSeam(location),false);
});
