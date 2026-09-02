import test from 'node:test';
import assert from 'node:assert/strict';
import {CUSHION_REQUIREMENTS,SHOT_ENVELOPE} from '../js/game-config.js';
import {deriveFloatingPull} from '../js/floating-pull.js';

const gestureProfile={maxSpeed:2400,fullPullCss:160,deadZoneCss:14};
const close=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const pull=(originScreen,currentScreen,extra={})=>deriveFloatingPull({originScreen,currentScreen,gestureProfile,worldScale:{x:2,y:3},...extra});

test('floating pull is translation invariant',()=>{
 const a=pull({x:40,y:70},{x:120,y:130});
 const b=pull({x:240,y:370},{x:320,y:430});
 close(a.normalizedPull,b.normalizedPull);close(a.normalizedPower,b.normalizedPower);
 close(a.shotDirection.x,b.shotDirection.x);close(a.shotDirection.y,b.shotDirection.y);
});

test('equal CSS distances produce equal power in every direction and ergonomic origin',()=>{
 const origins=[
  {x:200,y:300}, // center
  {x:30,y:700},  // bottom-left
  {x:200,y:700}, // bottom-center
  {x:370,y:700}, // bottom-right
  {x:200,y:80}   // top-center
 ];
 const vectors=[{x:100,y:0},{x:0,y:-100},{x:60,y:80},{x:-60,y:-80}];
 const values=origins.flatMap(origin=>vectors.map(vector=>pull(origin,{x:origin.x+vector.x,y:origin.y+vector.y}).normalizedPower));
 assert.ok(Math.max(...values)-Math.min(...values)<1e-12,values);
});

test('shot direction is the inverse gesture after non-uniform screen-to-world scaling',()=>{
 const result=pull({x:100,y:100},{x:140,y:70});
 const expected={x:-80,y:90},length=Math.hypot(expected.x,expected.y);
 close(result.shotDirection.x,expected.x/length);close(result.shotDirection.y,expected.y/length);
});

test('all eight shot directions map from the opposite gesture',()=>{
 const directions=[['N',0,-1],['NE',1,-1],['E',1,0],['SE',1,1],['S',0,1],['SW',-1,1],['W',-1,0],['NW',-1,-1]];
 for(const [name,x,y] of directions){
  const length=Math.hypot(x,y),desired={x:x/length,y:y/length};
  const screenPull={x:-desired.x/2,y:-desired.y/3},scale=120/Math.hypot(screenPull.x,screenPull.y);
  const result=pull({x:200,y:300},{x:200+screenPull.x*scale,y:300+screenPull.y*scale});
  close(result.shotDirection.x,desired.x,1e-12);close(result.shotDirection.y,desired.y,1e-12);
  assert.ok(result.normalizedPower>0,`${name} has no power`);
 }
});

test('dead-zone gestures cancel and full pull clamps at one',()=>{
 assert.equal(pull({x:0,y:0},{x:gestureProfile.deadZoneCss,y:0}).normalizedPower,0);
 assert.equal(pull({x:0,y:0},{x:gestureProfile.fullPullCss,y:0}).normalizedPower,1);
 assert.equal(pull({x:0,y:0},{x:gestureProfile.fullPullCss*2,y:0}).normalizedPower,1);
});

test('floating pull does not depend on cue position or difficulty',()=>{
 const cuePositions=[
  {x:.5,y:.5},{x:.05,y:.5},{x:.95,y:.5},{x:.5,y:.05},{x:.5,y:.95},
  {x:.05,y:.05},{x:.95,y:.05},{x:.05,y:.95},{x:.95,y:.95}
 ];
 const results=cuePositions.flatMap(cuePosition=>['relaxed','normal','hard'].map(difficulty=>pull(
  {x:260,y:650},{x:100,y:650},{cuePosition,difficulty}
 )));
 for(const result of results){
  assert.equal(result.normalizedPower,1);
  close(result.speed,gestureProfile.maxSpeed);
  close(result.shotDirection.x,1);close(result.shotDirection.y,0);
 }
});

test('shot envelope is the single base-surface calibration contract',()=>{
 assert.deepEqual(SHOT_ENVELOPE,{maxCushions:3,reserveDiameters:3,surface:'base'});
 const maximumRequired=Math.max(...Object.values(CUSHION_REQUIREMENTS));
 assert.ok(maximumRequired<=SHOT_ENVELOPE.maxCushions,`${maximumRequired} exceeds ${SHOT_ENVELOPE.maxCushions}`);
});
