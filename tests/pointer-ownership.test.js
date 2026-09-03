import test from 'node:test';
import assert from 'node:assert/strict';
import {GameplayPointerOwner} from '../js/pointer-ownership.js';

test('single pointer acquires ownership and a secondary pointer cannot steal it',()=>{
 const owner=new GameplayPointerOwner();
 assert.equal(owner.acquire(11),true);
 assert.equal(owner.pointerId,11);
 assert.equal(owner.acquire(22),false);
 assert.equal(owner.pointerId,11);
});

test('secondary move and terminal events are rejected by the owner guard',()=>{
 const owner=new GameplayPointerOwner();
 owner.acquire(11);
 assert.equal(owner.owns(22),false);
 assert.equal(owner.release(22),false);
 assert.equal(owner.pointerId,11);
 assert.equal(owner.owns(11),true);
});

test('owner cancel and lost-capture cleanup release ownership without side effects',()=>{
 const owner=new GameplayPointerOwner();
 owner.acquire(11);
 assert.equal(owner.release(11),true);
 assert.equal(owner.pointerId,null);
 assert.equal(owner.release(11),false);
 assert.equal(owner.pointerId,null);
});

test('a new pointer can acquire ownership after the previous owner releases',()=>{
 const owner=new GameplayPointerOwner();
 owner.acquire(11);
 owner.release(11);
 assert.equal(owner.acquire(33),true);
 assert.equal(owner.pointerId,33);
});

test('interaction lock prevents ownership acquisition',()=>{
 const owner=new GameplayPointerOwner();
 assert.equal(owner.acquire(11,false),false);
 assert.equal(owner.pointerId,null);
});

test('global pointer cancellation clears ownership idempotently',()=>{
 const owner=new GameplayPointerOwner();
 owner.acquire(11);
 assert.equal(owner.clear(),11);
 assert.equal(owner.pointerId,null);
 assert.equal(owner.clear(),null);
});
