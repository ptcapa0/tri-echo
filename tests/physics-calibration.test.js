import test from 'node:test';
import assert from 'node:assert/strict';
import {generateTable} from '../js/generator.js';
import {Physics,PHYSICS_PROFILE,STEP} from '../js/physics.js';
import {SHOT_ENVELOPE} from '../js/game-config.js';
import {
 calibrateShot,
 computeGestureMetrics,
 computeShotRequirement,
 crossedPowerThreshold,
 mapPullToPower,
 powerCurve,
 simulateCushionEnvelope,
 simulateStoppingDistance,
 solveInitialSpeedForRequirement
} from '../js/physics-calibration.js';

const cleanTable=(difficulty='normal',w=720,h=1120,options={})=>{
 const table=generateTable(41,difficulty,0,w,h,{tableStyle:'echo',...options});
 table.hole=null;table.pockets=[];table.obstacles=[];table.frictionZone=null;table.rails=[];
 return table;
};

test('stopping distance and time grow monotonically with initial speed',()=>{
 const samples=[300,700,1300].map(initialSpeed=>simulateStoppingDistance(initialSpeed));
 assert.ok(samples[0].distance<samples[1].distance&&samples[1].distance<samples[2].distance);
 assert.ok(samples[0].time<samples[1].time&&samples[1].time<samples[2].time);
 for(const sample of samples)for(let i=1;i<sample.velocitySamples.length;i++)assert.ok(sample.velocitySamples[i].speed<=sample.velocitySamples[i-1].speed+1e-9);
});

test('cushion characterization records real energy loss at every rail',()=>{
 const result=simulateCushionEnvelope(cleanTable(),2000);
 assert.ok(result.cushionEvents.length>=SHOT_ENVELOPE.maxCushions);
 for(const event of result.cushionEvents.slice(0,SHOT_ENVELOPE.maxCushions)){
  assert.ok(event.speedAfter<event.speedBefore);
  assert.ok(event.retained>0&&event.retained<1);
 }
});

test('shot requirement includes the supported challenge and three-diameter reserve',()=>{
 const requirement=computeShotRequirement(cleanTable());
 assert.equal(requirement.maxCushions,SHOT_ENVELOPE.maxCushions);
 assert.equal(requirement.reserveDistance,requirement.ballDiameter*SHOT_ENVELOPE.reserveDiameters);
 assert.ok(requirement.challengeDistance>=requirement.playableLong*SHOT_ENVELOPE.maxCushions);
 assert.ok(requirement.requiredReach>=requirement.challengeDistance+requirement.reserveDistance);
});

test('solver converges deterministically to the minimum safe satisfying speed',()=>{
 const table=cleanTable(),requirement=computeShotRequirement(table);
 const a=solveInitialSpeedForRequirement(table,requirement),b=solveInitialSpeedForRequirement(table,requirement);
 assert.equal(a.speed,b.speed);
 assert.ok(a.measurement.distance>=requirement.requiredReach);
 assert.ok(a.measurement.cushions>=requirement.maxCushions);
 const below=simulateCushionEnvelope(table,a.speed-a.tolerance*2);
 assert.ok(below.distance<requirement.requiredReach||below.cushions<requirement.maxCushions);
});

test('calibrated maximum reaches the envelope without excessive overshoot or unsafe steps',()=>{
 for(const [w,h] of [[720,620],[720,1120],[720,1440]]){
  const table=cleanTable('normal',w,h),calibration=calibrateShot(table);
  assert.ok(calibration.measuredReach>=calibration.requiredReach);
  assert.ok(calibration.measuredReach<=calibration.requiredReach*1.2);
  assert.ok(calibration.stepRatio<=PHYSICS_PROFILE.maxSafeStepRatio+1e-9);
 }
});

test('the power curve is continuous, monotonic and preserves fine control',()=>{
 const points=[0,.01,.1,.25,.35,.5,.75,.9,1],values=points.map(powerCurve);
 assert.equal(values[0],0);assert.equal(values.at(-1),1);
 for(let i=1;i<values.length;i++){assert.ok(values[i]>=values[i-1]);assert.ok(values[i]>=0&&values[i]<=1)}
 assert.ok(Math.abs(powerCurve(.35)-.18)<.04);
 assert.ok(Math.abs(powerCurve(.75)-.65)<.05);
 assert.ok(powerCurve(.05)<=.03);
 assert.ok(Math.abs(powerCurve(1e-6)-powerCurve(0))<1e-6);
});

test('screen-space pull maps zero to zero and full pull to calibrated maximum',()=>{
 const shot=calibrateShot(cleanTable()),gesture=computeGestureMetrics(390,844),profile={...shot,...gesture};
 assert.equal(mapPullToPower(gesture.deadZoneCss,profile).speed,0);
 const justAbove=mapPullToPower(gesture.deadZoneCss+.01,profile);
 assert.ok(justAbove.speed<shot.maxSpeed*.001);
 const full=mapPullToPower(gesture.fullPullCss,profile);
 assert.equal(full.normalizedPower,1);assert.equal(full.speed,shot.maxSpeed);
});

test('relative screen-space gestures feel the same across supported phones',()=>{
 const sizes=[[360,800],[390,844],[412,915],[430,932]],fractions=[.25,.5,.75,1];
 for(const fraction of fractions){
  const values=sizes.map(([w,h])=>{const g=computeGestureMetrics(w,h);assert.ok(g.fullPullCss>=140&&g.fullPullCss<=180);assert.ok(g.fullPullCss/w>=.35&&g.fullPullCss/w<=.45);return mapPullToPower(g.fullPullCss*fraction,{maxSpeed:2000,...g}).normalizedPower});
  assert.ok(Math.max(...values)-Math.min(...values)<.015,`${fraction}: ${values}`);
 }
});

test('haptic power thresholds fire once per upward crossing',()=>{
 assert.equal(crossedPowerThreshold(.2,.3),.25);
 assert.equal(crossedPowerThreshold(.3,.76),.75);
 assert.equal(crossedPowerThreshold(.76,1),1);
 assert.equal(crossedPowerThreshold(.8,.6),null);
 assert.equal(crossedPowerThreshold(.6,.76),.75);
 assert.equal(crossedPowerThreshold(.76,.76),null);
});

test('difficulty does not alter fundamental shot calibration',()=>{
 const speeds=['relaxed','normal','hard','adaptive'].map(difficulty=>calibrateShot(cleanTable(difficulty)).maxSpeed);
 assert.ok(speeds.every(speed=>Math.abs(speed-speeds[0])<1e-9),speeds);
});

test('all supported ball and table profiles remain inside the numerical envelope',()=>{
 const profiles=[
  cleanTable('normal',720,620),cleanTable('normal',720,1120),cleanTable('normal',720,1440),
  cleanTable('normal',720,1120,{tableStyle:'snooker',ballSet:'american',traditional:true}),
  cleanTable('normal',720,1120,{tableStyle:'snooker',ballSet:'british',traditional:true})
 ];
 for(const table of profiles){const calibration=calibrateShot(table);assert.ok(calibration.maxSpeed*STEP<=calibration.diameter*PHYSICS_PROFILE.maxSafeStepRatio)}
});

test('identical calibrated shots are repeatable',()=>{
 const base=cleanTable(),speed=calibrateShot(base).maxSpeed,run=()=>{const table=structuredClone(base),physics=new Physics(table);physics.shoot(speed*.6,-speed*.8,{x:.2,y:-.15},1);while(physics.active)physics.step(STEP);return table.balls.map(({x,y,vx,vy,pocketed})=>({x,y,vx,vy,pocketed}))};
 assert.deepEqual(run(),run());
});
