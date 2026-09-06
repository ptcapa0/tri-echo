import test from 'node:test';
import assert from 'node:assert/strict';
import {Physics,STEP} from '../js/physics.js';

function table(balls,{obstacles=[],rails=[],bounds={l:0,r:600,t:0,b:400},traditional=false}={}){
 return{w:bounds.r,h:bounds.b,bounds,traditional,balls,obstacles,rails,frictionZone:null,pockets:[],hole:null,targetType:'none'};
}

const ball=(id,x,y,vx=0,vy=0,r=18)=>({id,x,y,vx,vy,r,pocketed:false,spinX:0,spinY:0});
const finiteBall=b=>[b.x,b.y,b.vx,b.vy].every(Number.isFinite);

test('Echo Rail centerline contact is resolved instead of silently ignored',()=>{
 const t=table([ball(0,250,200,0,-900)],{rails:[{a:{x:100,y:200},b:{x:400,y:200}}]});
 const p=new Physics(t,{diagnostics:true});p.active=true;p.step(0);
 assert.ok(t.balls[0].y>=200+t.balls[0].r+5-1e-6);
 assert.ok(t.balls[0].vy>0);
 assert.ok(p.collisionEvents.some(event=>event.type==='ECHO_RAIL'));
});

test('coincident ball centers resolve completely with finite deterministic state',()=>{
 const run=()=>{const t=table([ball(0,250,200,500,0),ball(1,250,200,-500,0)]),p=new Physics(t,{diagnostics:true});p.active=true;p.step(STEP);return{balls:t.balls,events:p.collisionEvents}};
 const a=run(),b=run(),distance=Math.hypot(a.balls[1].x-a.balls[0].x,a.balls[1].y-a.balls[0].y);
 assert.ok(distance>=36-1e-6);
 assert.ok(a.balls.every(finiteBall));
 assert.deepEqual(a,b);
});

test('high-speed moving balls cannot silently pass through one another',()=>{
 const t=table([ball(0,180,200,3600,0,13),ball(1,240,200,-3600,0,13)]),p=new Physics(t,{diagnostics:true});
 p.active=true;p.step(STEP);
 assert.ok(p.collisionEvents.some(event=>event.type==='BALL_BALL'));
 assert.ok(t.balls[0].vx<t.balls[1].vx);
 assert.ok(Math.hypot(t.balls[1].x-t.balls[0].x,t.balls[1].y-t.balls[0].y)>=26-1e-6);
});

test('simultaneous corner collision remains one gameplay cushion event',()=>{
 const t=table([ball(0,20,20,-900,-900)]),p=new Physics(t,{diagnostics:true});p.active=true;p.step(STEP);
 assert.equal(p.cushions,1);
 const event=p.collisionEvents.find(event=>event.type==='CUSHION');
 assert.deepEqual(event?.axes,['x','y']);
});

test('solver work is bounded and reports finite diagnostics',()=>{
 const t=table([ball(0,120,200,10000,0,13),ball(1,300,200,-10000,0,13)]),p=new Physics(t,{diagnostics:true});p.active=true;p.step(STEP);
 assert.ok(p.diagnostics.maxInternalSubsteps<=16);
 assert.ok(p.diagnostics.collisionChecks>0);
 assert.ok(t.balls.every(finiteBall));
});

test('positional correction alone is not counted as travelled cue path',()=>{
 const t=table([ball(0,200,200),ball(1,200,200)]),p=new Physics(t);p.active=true;p.step(STEP);
 assert.equal(p.distanceTravelled,0);
});

test('penetration correction is excluded from measured cue travel',()=>{
 const cue=ball(0,20,200,-900,0),t=table([cue]),p=new Physics(t);p.active=true;p.step(STEP);
 const uncorrected=900*STEP;
 assert.ok(p.distanceTravelled>0);
 assert.ok(p.distanceTravelled<uncorrected);
});

test('gameplay contact counters do not depend on internal substep count',()=>{
 const run=minimumInternalSubsteps=>{const t=table([ball(0,120,200,800,0),ball(1,180,200,0,0),ball(2,240,200,0,0)]),p=new Physics(t,{minimumInternalSubsteps});p.active=true;for(let i=0;i<80&&p.active;i++)p.step(STEP);return{contacts:[...p.contacts],contactOrder:p.contactOrder,firstCollision:p.firstCollision,objectContacts:p.objectContacts,cushions:p.cushions}};
 assert.deepEqual(run(1),run(4));
});

test('collision response does not create translational energy without spin or forces',()=>{
 const t=table([ball(0,160,200,1000,0),ball(1,220,200,-300,0)]),before=t.balls.reduce((sum,b)=>sum+b.vx*b.vx+b.vy*b.vy,0),p=new Physics(t);p.active=true;
 for(let i=0;i<20&&!p.contacts.has(1);i++)p.step(STEP);
 const after=t.balls.reduce((sum,b)=>sum+b.vx*b.vx+b.vy*b.vy,0);
 assert.ok(after<=before+1e-6);
});

test('moving-vs-moving frontal and grazing collisions are both detected',()=>{
 for(const y of [200,225.7]){
  const t=table([ball(0,170,200,2100,0,13),ball(1,230,y,-1200,0,13)]),p=new Physics(t,{diagnostics:true});p.active=true;
  for(let i=0;i<4;i++)p.step(STEP);
  assert.ok(p.collisionEvents.some(event=>event.type==='BALL_BALL'),`missing contact at y=${y}`);
  assert.ok(t.balls.every(finiteBall));
 }
});

test('snooker-size balls remain separated at the calibrated high-speed scale',()=>{
 const t=table([ball(0,130,200,2700,0,13),ball(1,185,200,-1300,0,13)]),p=new Physics(t,{diagnostics:true});p.active=true;
 for(let i=0;i<3;i++)p.step(STEP);
 assert.ok(p.collisionEvents.some(event=>event.type==='BALL_BALL'));
 assert.ok(Math.hypot(t.balls[1].x-t.balls[0].x,t.balls[1].y-t.balls[0].y)>=26-1e-6);
});

test('static circles resolve frontal, grazing, and coincident-center cases',()=>{
 const cases=[ball(0,170,200,2400,0),ball(0,170,243.8,2400,0),ball(0,250,200,900,0)];
 for(const [index,cue] of cases.entries()){
  const obstacle={x:index===2?250:220,y:200,r:26},t=table([cue],{obstacles:[obstacle]}),p=new Physics(t,{diagnostics:true});p.active=true;
  for(let i=0;i<5&&!p.collisionEvents.length;i++)p.step(index===2?0:STEP);
  assert.ok(p.collisionEvents.some(event=>event.type==='BUMPER'),`missing bumper case ${index}`);
  assert.ok(finiteBall(cue));
  assert.ok(Math.hypot(cue.x-obstacle.x,cue.y-obstacle.y)>=cue.r+obstacle.r-1e-6);
 }
});

test('Echo Rails resolve frontal, grazing, endpoint, and parallel contacts',()=>{
 const rail={a:{x:180,y:200},b:{x:360,y:200}},cases=[
  ball(0,260,150,0,2200),
  ball(0,382.8,170,0,2200),
  ball(0,180,200,900,0),
  ball(0,230,222.9,1200,0)
 ];
 for(const [index,cue] of cases.entries()){
  const t=table([cue],{rails:[rail]}),p=new Physics(t,{diagnostics:true});p.active=true;
  for(let i=0;i<8&&!p.collisionEvents.length;i++)p.step(index>=2?0:STEP);
  assert.ok(p.collisionEvents.some(event=>event.type==='ECHO_RAIL'),`missing rail case ${index}`);
  assert.ok(finiteBall(cue));
 }
});

test('high-speed wall impacts stay in bounds and do not gain energy',()=>{
 for(const velocity of [[-2800,0],[2800,700],[40,-2800],[-80,2800]]){
  const cue=ball(0,velocity[0]<0?20:velocity[0]>100?580:300,velocity[1]<0?20:velocity[1]>100?380:200,...velocity),t=table([cue]),before=len2(cue),p=new Physics(t,{diagnostics:true});p.active=true;p.step(STEP);
  assert.ok(cue.x-cue.r>=t.bounds.l-1e-9&&cue.x+cue.r<=t.bounds.r+1e-9&&cue.y-cue.r>=t.bounds.t-1e-9&&cue.y+cue.r<=t.bounds.b+1e-9);
  assert.ok(len2(cue)<=before+1e-6);
 }
});

test('three-ball chain has stable contact order without energy explosion',()=>{
 const t=table([ball(0,120,200,1800,0),ball(1,190,200),ball(2,230,200)]),before=kinetic(t.balls),p=new Physics(t,{diagnostics:true});p.active=true;
 for(let i=0;i<80&&p.contactOrder.length<2;i++)p.step(STEP);
 assert.deepEqual(p.contactOrder,[1]);
 assert.ok(p.objectContacts>=1);
 assert.ok(kinetic(t.balls)<=before+1e-5);
 assert.ok(t.balls.every(finiteBall));
});

test('cushion episodes do not multiply gameplay counts across forced substeps',()=>{
 const run=minimumInternalSubsteps=>{const t=table([ball(0,20,200,-900,0)]),p=new Physics(t,{minimumInternalSubsteps});p.active=true;p.step(STEP);return{cushions:p.cushions,cueBefore:p.cueCushionsBeforeContact}};
 assert.deepEqual(run(1),run(8));
 assert.deepEqual(run(8),{cushions:1,cueBefore:1});
});

test('follow, draw, and side spin preserve their qualitative collision directions',()=>{
 const run=contact=>{const t=table([ball(0,120,200),ball(1,210,200)]),p=new Physics(t);p.shoot(1200,0,contact,1);for(let i=0;i<80;i++)p.step(STEP);return{x:t.balls[0].x,y:t.balls[0].y}};
 const center=run({x:0,y:0}),follow=run({x:0,y:-1}),draw=run({x:0,y:1}),side=run({x:1,y:0});
 assert.ok(follow.x>center.x);assert.ok(draw.x<center.x);assert.ok(Math.abs(side.y-center.y)>1);
});

test('critical collision replay is deterministic across 100 runs',()=>{
 const run=()=>{const t=table([ball(0,160,180,2064.87,240),ball(1,220,200,-400,0),ball(2,280,220,-100,0)],{obstacles:[{x:430,y:240,r:34}],rails:[{a:{x:120,y:330},b:{x:480,y:330}}]}),p=new Physics(t,{diagnostics:true});p.active=true;for(let i=0;i<120;i++)p.step(STEP);return{balls:t.balls.map(({x,y,vx,vy})=>({x,y,vx,vy})),events:p.collisionEvents,counters:[p.cushions,p.objectCushions,p.objectContacts,p.firstCollision,...p.contactOrder]}};
 const expected=run();for(let i=1;i<100;i++)assert.deepEqual(run(),expected);
});

function kinetic(balls){return balls.reduce((sum,b)=>sum+len2(b),0)}
function len2(b){return b.vx*b.vx+b.vy*b.vy}
