import test from 'node:test';
import assert from 'node:assert/strict';
import {generateTable} from '../js/generator.js';
import {Physics} from '../js/physics.js';

for(const ballSet of ['american','british','three']){
 test(`old_capture_circle_false_positive: ${ballSet}`,()=>{
  const t=generateTable(1337,'normal',0,720,1120,{traditional:true,ballSet,tableStyle:'snooker'}),b=t.balls[0];
  Object.assign(b,{x:t.bounds.l+b.r,y:(t.bounds.t+t.bounds.b)/2});
  new Physics(t).capturePocket(b);assert.equal(b.pocketed,false);
 });
 for(const gravity of [false,true])test(`physical_pocket_no_magnetism ${ballSet} gravity=${gravity}`,()=>{
  const t=generateTable(1337,'normal',0,720,1120,{traditional:true,ballSet,tableStyle:'snooker'}),b=t.balls[0];
  Object.assign(b,{x:t.bounds.l+b.r,y:(t.bounds.t+t.bounds.b)/2});
  const p=new Physics(t);p.modifiers={gravity};p.pocketPull(b,1/180);
  assert.equal(b.vx,0);assert.equal(b.vy,0);
 });
}

import {pocketTrajectory} from './helpers/pocket-trajectories.js';
import {createPocketGeometry,pocketPoint,safeFromPocketGeometry} from '../js/pocket-geometry.js';
import {respawnBall,respotBall} from '../js/generator.js';
import {STEP} from '../js/physics.js';
for(const profile of ['american','snooker','classic'])for(const pocketIndex of [0,1,2,3,4,5])for(const speed of [110,2400]){
 test(`${profile} ${pocketIndex<2||pocketIndex>3?'corner':'side'}_${pocketIndex}_center_${speed===110?'slow':'fast'}_pot`,()=>{
  const r=pocketTrajectory({profile,pocketIndex,speed});assert.equal(r.pot,true);assert.equal(r.invalidCaptures,0);assert.equal(r.silentJawMisses,0);
 });
}
for(const [type,pocketIndex] of [['corner',0],['side',2]])for(const side of [-1,1]){
 test(`${type}_cut_${side<0?'left':'right'}`,()=>{const r=pocketTrajectory({pocketIndex,angle:side*.08,speed:500});assert.ok(r.pot)});
 test(`${type}_${side<0?'left':'right'}_jaw_reject`,()=>{const r=pocketTrajectory({pocketIndex,offset:side*.6,speed:300});assert.ok(r.jawReject);assert.equal(r.silentJawMisses,0)});
}
test('corner_rattle_pot',()=>{const r=pocketTrajectory({offset:.25,speed:300});assert.ok(r.pot&&r.rattle)});
test('corner_rattle_escape',()=>{const r=pocketTrajectory({offset:.6,speed:300});assert.ok(r.rattle&&r.escape&&!r.pot)});
test('high_speed_jaw',()=>{const r=pocketTrajectory({offset:.6,speed:2400,spin:1});assert.ok(r.jaws>0);assert.equal(r.silentJawMisses,0);assert.ok(r.finite);assert.ok(r.maxEnergyRatio<=1+1e-9)});
test('cue_scratch_physical',()=>{assert.deepEqual(pocketTrajectory().physics.pocketed,[0])});
test('jaw_contact_episode_dedup',()=>{
 const run=minimumInternalSubsteps=>pocketTrajectory({offset:.25,speed:300,minimumInternalSubsteps});
 const a=run(1),b=run(16);assert.equal(a.pot,b.pot);assert.equal(a.jaws,2);assert.equal(b.jaws,2);assert.equal(a.physics.cushions,b.physics.cushions);
});
test('spawn inside shelf cannot manufacture a capture',()=>{
 const r=pocketTrajectory(),p=r.pocket,b=r.ball;Object.assign(b,pocketPoint(p,0,p.captureDepth+1),{pocketed:false});
 const physics=new Physics(r.table);physics.active=true;physics.step(STEP);assert.equal(b.pocketed,false);
});
for(const target of ['portal','arcade'])test(`${target}_magnetism_preserved`,()=>{
 const t=generateTable(1,'normal',0,720,1120,{tableStyle:target==='portal'?'echo':'snooker'}),h=target==='portal'?t.hole:t.pockets[2],b=t.balls[0];
 Object.assign(b,{x:h.x+b.r,y:h.y});const p=new Physics(t);p.pocketPull(b,STEP);assert.ok(b.vx<0);p.capturePocket(b);assert.ok(b.pocketed);
});
test('physical pockets do not suppress a separate portal',()=>{
 const r=pocketTrajectory();r.table.hole={x:400,y:500,r:34};Object.assign(r.ball,{x:420,y:500,pocketed:false});const p=new Physics(r.table);p.pocketPull(r.ball,STEP);assert.ok(r.ball.vx<0);p.capturePocket(r.ball);assert.ok(r.ball.pocketed);
});
test('safe_respawn_outside_pocket_geometry and respot',()=>{
 for(const ballSet of ['american','british','three'])for(let seed=0;seed<100;seed++){
  const t=generateTable(seed,'normal',0,720,620,{traditional:true,ballSet,tableStyle:'snooker'}),b=t.balls[0];b.pocketed=true;
  assert.ok(respawnBall(t,b,seed));assert.ok(safeFromPocketGeometry(t.pocketGeometry,b,b.r));
  b.spot=pocketPoint(t.pockets[0],0,10);assert.ok(respotBall(t,b));assert.ok(safeFromPocketGeometry(t.pocketGeometry,b,b.r));
 }
});
test('failed respawn preserves the ball instead of placing it in an occupied fallback',()=>{
 const t=generateTable(1,'normal',0,720,1120,{traditional:true}),b=t.balls[0];t.obstacles=[{x:360,y:560,r:2000}];b.pocketed=true;
 const before=structuredClone(b);assert.equal(respawnBall(t,b,1),false);assert.deepEqual(b,before);
});
test('pocket profiles scale with diameter and remain independent of difficulty',()=>{
 for(const profile of ['american','snooker','classic']){const a=createPocketGeometry({l:0,r:600,t:0,b:900},26,profile),b=createPocketGeometry({l:0,r:600,t:0,b:900},36,profile);assert.equal(a.pockets.length,6);assert.ok(Math.abs(a.pockets[0].width/26-b.pockets[0].width/36)<1e-10)}
 const options={traditional:true,ballSet:'american'};assert.deepEqual(generateTable(1,'relaxed',0,720,1120,options).pocketGeometry,generateTable(1,'hard',0,720,1120,options).pocketGeometry);
});
test('deterministic replay retains geometry and capture history',()=>{
 const a=pocketTrajectory({offset:.25,spin:.4}),b=pocketTrajectory({offset:.25,spin:.4});assert.deepEqual(a.ball,b.ball);assert.deepEqual(a.physics.collisionEvents,b.physics.collisionEvents);
});
test('a ball resting on the shelf retains its entry across round reset and next shot',()=>{
 const r=pocketTrajectory({speed:70,maxSteps:3300});assert.equal(r.pot,false);assert.equal(r.physics.active,false);
 const restored=structuredClone(r.table),physics=new Physics(restored);
 physics.shoot(r.pocket.outward.x*150,r.pocket.outward.y*150);
 for(let i=0;i<600&&physics.active;i++)physics.step(STEP);
 assert.deepEqual(physics.pocketed,[0]);
});
test('generated classic balls never start in a mouth or jaw (seed 78 regression)',()=>{
 for(const seed of [78,79,104,160,214]){
  const options={traditional:true},a=generateTable(seed,'hard',0,720,620,options),b=generateTable(seed,'hard',0,720,620,options);
  assert.deepEqual(a,b);assert.ok(a.balls.every(ball=>safeFromPocketGeometry(a.pocketGeometry,ball,ball.r)),`seed ${seed}`);
 }
});
test('object balls use the same physical capture as the cue',()=>{
 const r=pocketTrajectory({speed:70,maxSteps:3300});r.ball.id=7;
 const physics=new Physics(r.table);physics.shoot(r.pocket.outward.x*150,r.pocket.outward.y*150);
 while(physics.active)physics.step(STEP);assert.deepEqual(physics.pocketed,[7]);
});
test('phase power cannot bypass physical jaws',()=>{
 const a=pocketTrajectory({offset:.6,speed:300}),b=structuredClone(a.table),ball=b.balls[0];
 const start=pocketPoint(a.pocket,.6*ball.r*2,-4*ball.r);Object.assign(ball,start,{pocketed:false,pocketEntry:null});
 const physics=new Physics(b,{diagnostics:true});physics.shoot(a.pocket.outward.x*300,a.pocket.outward.y*300,{x:0,y:0},0,{phase:true});
 while(physics.active)physics.step(STEP);assert.ok(physics.collisionEvents.some(e=>e.type==='CUSHION'&&e.part==='jaw'));
});
