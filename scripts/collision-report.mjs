import {performance} from 'node:perf_hooks';
import {generateTable} from '../js/generator.js';
import {mulberry32,segmentClosest} from '../js/math.js';
import {calibrateShot} from '../js/physics-calibration.js';
import {MAX_INTERNAL_SUBSTEPS,Physics,STEP} from '../js/physics.js';

const argv=process.argv.slice(2),arg=name=>{const index=argv.indexOf(name);return index<0?null:argv[index+1]};
const seed=Number(arg('--seed')??1337)>>>0,cases=Math.max(100,Number(arg('--cases')??10000)|0),rng=mulberry32(seed);
const started=performance.now();
const types=['Ball-ball','Static circle','Echo Rail','Wall','Corner'];
const results=Object.fromEntries(types.map(type=>[type,{type,cases:0,before:0,after:0,maxPenetration:0,worst:null}]));
let nan=0,infinity=0,energyViolations=0,maxSubsteps=0,maxEvents=0,limitHits=0;

const ball=(id,x,y,vx=0,vy=0,r=18)=>({id,x,y,vx,vy,r,pocketed:false,spinX:0,spinY:0});
const table=(balls,{obstacles=[],rails=[],bounds={l:0,r:720,t:0,b:1120},traditional=false}={})=>({w:bounds.r,h:bounds.b,bounds,traditional,balls,obstacles,rails,frictionZone:null,pockets:[],hole:null,targetType:'none'});
const pointSegmentDistance=(p,a,b)=>{const q=segmentClosest(p.x,p.y,a,b);return Math.hypot(p.x-q.x,p.y-q.y)};
const orientation=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const segmentsCross=(a,b,c,d)=>{const ab1=orientation(a,b,c),ab2=orientation(a,b,d),cd1=orientation(c,d,a),cd2=orientation(c,d,b);return ab1*ab2<=0&&cd1*cd2<=0};
const segmentDistance=(a,b,c,d)=>segmentsCross(a,b,c,d)?0:Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
const sweptPointCircle=(start,end,center,r)=>pointSegmentDistance(center,start,end)<=r;
const sweptMovingCircles=(a0,a1,b0,b1,r)=>sweptPointCircle({x:b0.x-a0.x,y:b0.y-a0.y},{x:b1.x-a1.x,y:b1.y-a1.y},{x:0,y:0},r);
const kinetic=balls=>balls.reduce((sum,b)=>sum+b.vx*b.vx+b.vy*b.vy,0);
const finite=v=>Number.isFinite(v);
const note=(row,field,index,scenario)=>{row[field]++;if(!row.worst)row.worst={seed,index,scenario}};

function execute(type,t,index,oracle,beforeEndpointMiss,residual){
 const row=results[type];row.cases++;
 if(oracle&&beforeEndpointMiss)note(row,'before',index,{balls:structuredClone(t.balls),obstacles:t.obstacles,rails:t.rails});
 const before=kinetic(t.balls),physics=new Physics(t,{diagnostics:true});physics.active=true;physics.step(STEP);
 const expectedType=type==='Ball-ball'?'BALL_BALL':type==='Static circle'?'BUMPER':type==='Echo Rail'?'ECHO_RAIL':'CUSHION';
 const observed=physics.collisionEvents.some(event=>event.type===expectedType);
 if(oracle&&!observed)note(row,'after',index,{balls:structuredClone(t.balls),obstacles:t.obstacles,rails:t.rails});
 row.maxPenetration=Math.max(row.maxPenetration,residual(t));
 const values=t.balls.flatMap(b=>[b.x,b.y,b.vx,b.vy]);nan+=values.filter(Number.isNaN).length;infinity+=values.filter(v=>!finite(v)&&!Number.isNaN(v)).length;
 if(kinetic(t.balls)>before*(1+1e-8)+1e-5)energyViolations++;
 maxSubsteps=Math.max(maxSubsteps,physics.diagnostics.maxInternalSubsteps);maxEvents=Math.max(maxEvents,physics.diagnostics.maxCollisionEventsPerStep);limitHits+=physics.diagnostics.substepLimitHits;
}

for(let index=0;index<cases;index++){
 const type=types[index%types.length],r=rng()<.35?13:18;
 if(type==='Ball-ball'){
  const min=r*2,length=6+rng()*(r===13?8:16),depth=.08+rng()*Math.min(.9,length*length/(8*min)*.72),offset=min-depth;
  const a0={x:360+length/4,y:560-offset/2},b0={x:360-length/4,y:560+offset/2},relative=length/STEP;
  const balls=[ball(0,a0.x,a0.y,-relative/2,0,r),ball(1,b0.x,b0.y,relative/2,0,r)],a1={x:a0.x-relative/2*STEP,y:a0.y},b1={x:b0.x+relative/2*STEP,y:b0.y};
  const oracle=sweptMovingCircles(a0,a1,b0,b1,min),endpoint=Math.hypot(b1.x-a1.x,b1.y-a1.y)<min;
  execute(type,table(balls),index,oracle,oracle&&!endpoint,t=>Math.max(0,min-Math.hypot(t.balls[1].x-t.balls[0].x,t.balls[1].y-t.balls[0].y)));
 }else if(type==='Static circle'){
  const obstacle={x:360,y:560,r:26+rng()*20},min=r+obstacle.r,length=5+rng()*(r===13?2:6),depth=.05+rng()*Math.min(.35,length*length/(8*min)*.72),offset=min-depth;
  const start={x:360-length/2,y:560+offset},end={x:360+length/2,y:start.y},b=ball(0,start.x,start.y,length/STEP,0,r),oracle=sweptPointCircle(start,end,obstacle,min),endpoint=Math.hypot(end.x-obstacle.x,end.y-obstacle.y)<min;
  execute(type,table([b],{obstacles:[obstacle]}),index,oracle,oracle&&!endpoint,t=>Math.max(0,min-Math.hypot(t.balls[0].x-obstacle.x,t.balls[0].y-obstacle.y)));
 }else if(type==='Echo Rail'){
  const rail={a:{x:200,y:560},b:{x:360,y:560}},min=r+5,length=5+rng()*(r===13?2:6),depth=.05+rng()*Math.min(.4,length*length/(8*min)*.72),offset=min-depth;
  const start={x:360+offset,y:560-length/2},end={x:start.x,y:560+length/2},b=ball(0,start.x,start.y,0,length/STEP,r),oracle=segmentDistance(start,end,rail.a,rail.b)<=min,endpoint=pointSegmentDistance(end,rail.a,rail.b)<min;
  execute(type,table([b],{rails:[rail]}),index,oracle,oracle&&!endpoint,t=>Math.max(0,min-pointSegmentDistance(t.balls[0],rail.a,rail.b)));
 }else if(type==='Wall'){
  const speed=400+rng()*2400,angle=(rng()-.5)*Math.PI*.5,b=ball(0,r+speed*STEP*.2,300,-Math.cos(angle)*speed,Math.sin(angle)*speed,r),end={x:b.x+b.vx*STEP,y:b.y+b.vy*STEP},oracle=end.x-r<0;
  execute(type,table([b]),index,oracle,oracle&&end.x-r>=0,t=>Math.max(0,t.bounds.l-(t.balls[0].x-r)));
 }else{
  const speed=500+rng()*2300,b=ball(0,r+speed*STEP*.4,r+speed*STEP*.4,-speed/Math.SQRT2,-speed/Math.SQRT2,r),end={x:b.x+b.vx*STEP,y:b.y+b.vy*STEP},oracle=end.x-r<0&&end.y-r<0;
  execute(type,table([b]),index,oracle,false,t=>Math.max(0,t.bounds.l-(t.balls[0].x-r),t.bounds.t-(t.balls[0].y-r)));
 }
}

function runtimeEnvelope(){
 const profiles=[{name:'Echo mobile',height:1440},{name:'Daily',height:1120},{name:'Traditional/Snooker',height:1120,traditional:true,r:13},{name:'Desktop',height:620}],rows=[];
 let maxInitial=0,maxBall=0,maxRelative=0,maxStep=0,maxRelativeStep=0;
 for(const profile of profiles){
  const source=generateTable(41,'normal',0,720,profile.height,{tableStyle:profile.traditional?'snooker':'echo',ballSet:profile.traditional?'british':'three',traditional:!!profile.traditional}),radius=profile.r||18;
  source.balls=[ball(0,360,profile.height*.72,0,0,radius),ball(1,360,profile.height*.46,0,0,radius),ball(2,360,profile.height*.25,0,0,radius)];source.obstacles=[];source.rails=[];source.pockets=[];source.hole=null;source.frictionZone=null;
  const calibration=calibrateShot(source),physics=new Physics(source,{diagnostics:true});physics.shoot(0,-calibration.maxSpeed,{x:1,y:-1},1);maxInitial=Math.max(maxInitial,calibration.maxSpeed);
  let previous=source.balls.map(b=>({x:b.x,y:b.y}));
  while(physics.active){
   physics.step(STEP);const speeds=source.balls.map(b=>Math.hypot(b.vx,b.vy));maxBall=Math.max(maxBall,...speeds);
   for(let i=0;i<speeds.length;i++)for(let j=i+1;j<speeds.length;j++)maxRelative=Math.max(maxRelative,Math.hypot(source.balls[i].vx-source.balls[j].vx,source.balls[i].vy-source.balls[j].vy));
   for(let i=0;i<source.balls.length;i++)maxStep=Math.max(maxStep,Math.hypot(source.balls[i].x-previous[i].x,source.balls[i].y-previous[i].y));
   maxRelativeStep=Math.max(maxRelativeStep,maxRelative*STEP);previous=source.balls.map(b=>({x:b.x,y:b.y}));
  }
  rows.push({Profile:profile.name,MaxSpeed:+calibration.maxSpeed.toFixed(2),RequiredReach:+calibration.requiredReach.toFixed(1),MeasuredReach:+calibration.measuredReach.toFixed(1),StepRatio:+calibration.stepRatio.toFixed(3)});
 }
 return{rows,maxInitial,maxBall,maxRelative,maxStep,maxRelativeStep};
}

function rackStress(ballSet,count){
 const source=generateTable(91,'normal',0,720,1120,{tableStyle:'snooker',ballSet,traditional:true});source.pockets=[];source.hole=null;
 const physics=new Physics(source,{diagnostics:true}),speed=calibrateShot(source).maxSpeed;physics.shoot(0,-speed,{x:0,y:0},1);
 let steps=0;while(physics.active&&steps++<4000)physics.step(STEP);
 return{balls:source.balls.length,steps,finite:source.balls.every(b=>[b.x,b.y,b.vx,b.vy].every(Number.isFinite)),maxSubsteps:physics.diagnostics.maxInternalSubsteps,checks:physics.diagnostics.collisionChecks,events:physics.collisionEvents.length,bounded:steps<4000&&physics.diagnostics.maxInternalSubsteps<=MAX_INTERNAL_SUBSTEPS,expected:count};
}

const envelope=runtimeEnvelope(),pool=rackStress('american',16),snooker=rackStress('british',22),elapsed=performance.now()-started;
console.log(`TRI//ECHO collision integrity — seed ${seed}, cases ${cases}`);
console.table(Object.values(results).map(row=>({Type:row.type,Cases:row.cases,'Misses before':row.before,'Misses after':row.after,'Max penetration after':+row.maxPenetration.toFixed(8),'Worst seed':row.worst?.seed??'-','Worst case':row.worst?.index??'-'})));
console.log('Runtime velocity envelope');
console.table([{MaxInitial:+envelope.maxInitial.toFixed(2),MaxObservedBall:+envelope.maxBall.toFixed(2),MaxObservedRelative:+envelope.maxRelative.toFixed(2),MaxStepDisplacement:+envelope.maxStep.toFixed(4),MaxRelativeStepDisplacement:+envelope.maxRelativeStep.toFixed(4)}]);
console.log('Calibration after collision solver');console.table(envelope.rows);
console.log('Rack stress');console.table([pool,snooker]);
console.log({nan,infinity,energyViolations,maxSubsteps,maxEvents,limitHits,elapsedMs:+elapsed.toFixed(1)});
if(Object.values(results).some(row=>row.after)||nan||infinity||energyViolations||!pool.bounded||!snooker.bounded)process.exitCode=1;
