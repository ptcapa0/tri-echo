import assert from 'node:assert/strict';
import test from 'node:test';
import {Physics,STEP} from '../js/physics.js';
import {estimateTableStoppingDistance} from '../js/physics-calibration.js';

function tableFor(frictionZone=null,traditional=false){return{w:20000,h:10000,bounds:{l:0,r:20000,t:0,b:10000},traditional,balls:[{id:'cue',x:10000,y:5000,vx:0,vy:0,r:18,pocketed:false}],obstacles:[],rails:[],pockets:[],hole:null,targetType:'none',frictionZone}}
function oracleDistance(table,speed,direction={x:1,y:0}){
 const physics=new Physics(structuredClone(table));physics.shoot(direction.x*speed,direction.y*speed);
 while(physics.active)physics.step(STEP);
 return physics.distanceTravelled;
}
function assertReach(table,speed,direction={x:1,y:0}){
 const predicted=estimateTableStoppingDistance({table,cueBall:table.balls[0],shotDirection:direction,initialSpeed:speed}),actual=oracleDistance(table,speed,direction),limit=Math.max(actual*.03,18);
 assert.ok(Math.abs(predicted-actual)<=limit,`predicted ${predicted}, actual ${actual}, tolerance ${limit}`);
}

test('table-aware reach agrees with production Physics outside and through friction zones',()=>{
 assertReach(tableFor(),1000);
 assertReach(tableFor(null,true),1000);
 assertReach(tableFor({x:500,y:4500,w:19000,h:1000,factor:1.5}),1000);
 assertReach(tableFor({x:500,y:4500,w:19000,h:1000,factor:.62}),1000);
});

test('table-aware reach handles entering, exiting and missing a friction rectangle',()=>{
 assertReach(tableFor({x:10800,y:4500,w:1200,h:1000,factor:1.5}),1000);
 assertReach(tableFor({x:9000,y:4500,w:500,h:1000,factor:.62}),1000);
 assertReach(tableFor({x:10800,y:6500,w:1200,h:500,factor:1.5}),1000);
});
