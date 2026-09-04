import {clamp,len,segmentClosest} from './math.js';

export const STEP=1/180;
export const BASE_DRAG=.42;
export const MAX_INTERNAL_SUBSTEPS=16;
export const MAX_SUBSTEP_DISPLACEMENT_RATIO=.05;
export const COLLISION_EPSILON_RATIO=1e-8;
const NUMERIC_EPSILON=1e-9;
const MAX_EXTERNAL_ACCELERATION=2400;
export const PHYSICS_PROFILE=Object.freeze({
 fixedDt:STEP,
 stopSpeed:5,
 maxShotTime:18,
 maxSafeStepRatio:.65,
 echo:Object.freeze({drag:BASE_DRAG,rollingResistance:18,cushionRestitution:.94,cushionTangentRetention:.985}),
 traditional:Object.freeze({drag:.34,rollingResistance:15,cushionRestitution:.94,cushionTangentRetention:.985})
});

const pairKey=(a,b)=>a.id<b.id?`${a.id}:${b.id}`:`${b.id}:${a.id}`;
const stableSign=id=>(Number(id)&1)?-1:1;

export class Physics{
 constructor(table,options={}){this.options=options;this.load(table)}

 load(table){
  this.table=table;this.balls=table.balls;this.time=0;this.path=[];
  this.contacts=new Set();this.contactOrder=[];this.cushions=0;this.active=false;
  this.distanceTravelled=0;this.pocketed=[];this.shotPower=0;this.modifiers={};this.firstCollision=null;
  this.cueCushionsBeforeContact=0;this.objectCushions=0;this.objectContacts=0;
  this.ballContactEpisodes=new Set();this.wallContactEpisodes=new Set();this.colliderContactEpisodes=new Set();
  this.objectContactPairs=new Set();
  this.sliceTravel=new Map();this.sliceCorrection=new Map();
  this.collisionEvents=[];this.stepIndex=0;
  this.diagnostics={maxInternalSubsteps:0,maxCollisionEventsPerStep:0,collisionChecks:0,substepLimitHits:0};
  for(const b of this.balls){b.pocketed=!!b.pocketed;b.spinX=0;b.spinY=0}
 }

 shoot(vx,vy,contact={x:0,y:0},powerRatio=0,modifiers={}){
  const b=this.balls[0];b.vx=vx;b.vy=vy;b.pocketed=false;
  b.spinX=clamp(contact.x,-1,1);b.spinY=clamp(-contact.y,-1,1);
  this.time=0;this.path=[{x:b.x,y:b.y}];this.contacts.clear();this.contactOrder=[];
  this.cushions=0;this.cueCushionsBeforeContact=0;this.objectCushions=0;this.objectContacts=0;
  this.distanceTravelled=0;this.pocketed=[];this.shotPower=powerRatio;this.modifiers=modifiers;this.firstCollision=null;this.active=true;
  this.ballContactEpisodes.clear();this.wallContactEpisodes.clear();this.colliderContactEpisodes.clear();this.objectContactPairs.clear();this.collisionEvents=[];this.stepIndex=0;
  this.diagnostics={maxInternalSubsteps:0,maxCollisionEventsPerStep:0,collisionChecks:0,substepLimitHits:0};
 }

 internalSubsteps(dt){
  const live=this.balls.filter(b=>!b.pocketed);if(!live.length||dt<=0)return 1;
  let fastest=0,second=0,minDiameter=Infinity;
  for(const b of live){const speed=len(b.vx,b.vy);if(speed>fastest){second=fastest;fastest=speed}else if(speed>second)second=speed;minDiameter=Math.min(minDiameter,b.r*2)}
  const relativeEnvelope=fastest+(live.length>1?second:0)+MAX_EXTERNAL_ACCELERATION*dt;
  const requested=Math.ceil(relativeEnvelope*dt/(minDiameter*MAX_SUBSTEP_DISPLACEMENT_RATIO));
  const minimum=Math.max(1,this.options.minimumInternalSubsteps||1),limit=Math.max(1,this.options.maxInternalSubsteps||MAX_INTERNAL_SUBSTEPS);
  if(requested>limit)this.diagnostics.substepLimitHits++;
  return Math.min(limit,Math.max(minimum,requested,1));
 }

 step(dt=STEP){
  if(!this.active)return false;
  this.time+=dt;this.stepIndex++;
  const substeps=this.internalSubsteps(dt),sliceDt=dt/substeps;
  this.diagnostics.maxInternalSubsteps=Math.max(this.diagnostics.maxInternalSubsteps,substeps);
  const eventsBefore=this.collisionEvents.length;
  for(let substep=0;substep<substeps;substep++)this.integrateSlice(sliceDt,substep);
  this.diagnostics.maxCollisionEventsPerStep=Math.max(this.diagnostics.maxCollisionEventsPerStep,this.collisionEvents.length-eventsBefore);
  const cue=this.balls[0],last=this.path[this.path.length-1];
  if(!cue.pocketed&&(!last||Math.hypot(cue.x-last.x,cue.y-last.y)>17))this.path.push({x:cue.x,y:cue.y});
  const live=this.balls.filter(b=>!b.pocketed);
  if(this.time>PHYSICS_PROFILE.maxShotTime||live.every(b=>len(b.vx,b.vy)<PHYSICS_PROFILE.stopSpeed)){
   for(const b of live){b.vx=0;b.vy=0}
   this.active=false;return true;
  }
  return false;
 }

 integrateSlice(dt,substep){
  const {bounds,frictionZone}=this.table,seenWalls=new Set(),seenPairs=new Set(),seenColliders=new Set();
  this.sliceTravel.clear();this.sliceCorrection.clear();
  for(const b of this.balls){
   if(b.pocketed)continue;
   this.pocketPull(b,dt);
   const profile=this.table.traditional?PHYSICS_PROFILE.traditional:PHYSICS_PROFILE.echo;
   let drag=profile.drag;
   if(frictionZone&&b.x>frictionZone.x&&b.x<frictionZone.x+frictionZone.w&&b.y>frictionZone.y&&b.y<frictionZone.y+frictionZone.h)drag*=frictionZone.factor;
   const speed=len(b.vx,b.vy),rollingResistance=profile.rollingResistance,rolling=Math.max(0,1-rollingResistance*dt/Math.max(speed,rollingResistance));
   b.vx*=Math.exp(-drag*dt)*rolling;b.vy*=Math.exp(-drag*dt)*rolling;
   b.spinX*=Math.exp(-.62*dt);b.spinY*=Math.exp(-.7*dt);
   const dx=b.vx*dt,dy=b.vy*dt;b.x+=dx;b.y+=dy;this.sliceTravel.set(b,Math.hypot(dx,dy));
   this.capturePocket(b);
   if(b.pocketed)continue;
   this.wall(b,bounds,seenWalls,substep);
   if(!this.modifiers.phase)for(let i=0;i<this.table.obstacles.length;i++)this.circleStatic(b,this.table.obstacles[i],.96,`bumper:${i}`,seenColliders,substep);
   for(let i=0;i<this.table.rails.length;i++)this.rail(b,this.table.rails[i],i,seenColliders,substep);
   this.capturePocket(b);
  }
  for(let i=0;i<this.balls.length;i++)for(let j=i+1;j<this.balls.length;j++)if(!this.balls[i].pocketed&&!this.balls[j].pocketed)this.pair(this.balls[i],this.balls[j],seenPairs,substep);
  const cue=this.balls[0];this.distanceTravelled+=Math.max(0,(this.sliceTravel.get(cue)||0)-(this.sliceCorrection.get(cue)||0));
  this.wallContactEpisodes=seenWalls;this.ballContactEpisodes=seenPairs;this.colliderContactEpisodes=seenColliders;
 }

 addCorrection(ball,distance){this.sliceCorrection.set(ball,(this.sliceCorrection.get(ball)||0)+Math.max(0,distance))}

 recordCollision(type,payload){if(this.options.diagnostics)this.collisionEvents.push({type,time:this.time,step:this.stepIndex,...payload})}

 pocketPull(b,dt){
  const targets=[...(this.table.pockets||[]),...(this.table.hole&&!this.table.hole.disabled?[this.table.hole]:[])];
  let h=null,best=Infinity;for(const target of targets){const d=Math.hypot(target.x-b.x,target.y-b.y);if(d<best){best=d;h=target}}
  if(!h)return;const dx=h.x-b.x,dy=h.y-b.y,d=best,reach=h.r+b.r*1.55;if(d>reach||d<.001)return;
  const strength=(1-d/reach)*(this.table.traditional?980:1280)*(this.modifiers.gravity?1.85:1);b.vx+=dx/d*strength*dt;b.vy+=dy/d*strength*dt;
 }

 capturePocket(b){
  if(b.pocketed)return;const targets=[...(this.table.pockets||[]),...(this.table.hole&&!this.table.hole.disabled?[this.table.hole]:[])];
  const h=targets.find(x=>Math.hypot(b.x-x.x,b.y-x.y)<x.r*.86);if(!h)return;
  b.x=h.x;b.y=h.y;b.vx=0;b.vy=0;b.pocketed=true;this.pocketed.push(b.id);
 }

 wall(b,z,seen=new Set(),substep=0){
  const profile=this.table.traditional?PHYSICS_PROFILE.traditional:PHYSICS_PROFILE.echo,axes=[],before=len(b.vx,b.vy),px=b.x,py=b.y;
  if(b.x-b.r<z.l){b.x=z.l+b.r;b.vx=Math.abs(b.vx)*profile.cushionRestitution;axes.push('x')}
  if(b.x+b.r>z.r){b.x=z.r-b.r;b.vx=-Math.abs(b.vx)*profile.cushionRestitution;axes.push('x')}
  if(b.y-b.r<z.t){b.y=z.t+b.r;b.vy=Math.abs(b.vy)*profile.cushionRestitution;axes.push('y')}
  if(b.y+b.r>z.b){b.y=z.b-b.r;b.vy=-Math.abs(b.vy)*profile.cushionRestitution;axes.push('y')}
  if(!axes.length)return false;
  this.addCorrection(b,Math.hypot(b.x-px,b.y-py));
  const axis=axes.at(-1)==='x'?'v':'h';
  if(axis==='v')b.vy*=profile.cushionTangentRetention;else b.vx*=profile.cushionTangentRetention;
  if(axis==='v')b.vy+=b.spinX*Math.abs(b.vx)*.16;else b.vx-=b.spinX*Math.abs(b.vy)*.16;
  b.spinX*=-.72;
  const key=`wall:${b.id}`;seen.add(key);
  if(!this.wallContactEpisodes.has(key)){
   if(b.id===0){this.cushions++;if(this.firstCollision===null)this.cueCushionsBeforeContact++}else this.objectCushions++;
   this.recordCollision('CUSHION',{substep,ballId:b.id,axes:[...new Set(axes)],speedBefore:before,speedAfter:len(b.vx,b.vy)});
  }
  return true;
 }

 pair(a,b,seen=new Set(),substep=0){
  this.diagnostics.collisionChecks++;
  let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r;if(d>=min)return false;
  let nx,ny;
  if(d<min*COLLISION_EPSILON_RATIO){const rvx=b.vx-a.vx,rvy=b.vy-a.vy,relative=len(rvx,rvy);if(relative>NUMERIC_EPSILON){nx=-rvx/relative;ny=-rvy/relative}else{nx=stableSign(a.id-b.id);ny=0}d=0}
  else{nx=dx/d;ny=dy/d}
  const over=min-d;a.x-=nx*over*.5;a.y-=ny*over*.5;b.x+=nx*over*.5;b.y+=ny*over*.5;this.addCorrection(a,over*.5);this.addCorrection(b,over*.5);
  const rel=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny,beforeA=len(a.vx,a.vy),beforeB=len(b.vx,b.vy);
  if(rel<0){
   const imp=-rel*.985;a.vx-=imp*nx;a.vy-=imp*ny;b.vx+=imp*nx;b.vy+=imp*ny;
   const cue=a.id===0?a:b.id===0?b:null;
   if(cue){
    const dir=a.id===0?1:-1,fx=nx*dir,fy=ny*dir,tx=-fy,ty=fx;
    cue.vx+=fx*imp*cue.spinY*.3+tx*imp*cue.spinX*.11;
    cue.vy+=fy*imp*cue.spinY*.3+ty*imp*cue.spinX*.11;
    const target=cue===a?b:a;target.vx-=tx*imp*cue.spinX*.045;target.vy-=ty*imp*cue.spinX*.045;
    cue.spinY*=.44;cue.spinX*=.64;
   }
   const tx=-ny,ty=nx,relT=(b.vx-a.vx)*tx+(b.vy-a.vy)*ty,jt=relT*.028;
   a.vx+=jt*tx;a.vy+=jt*ty;b.vx-=jt*tx;b.vy-=jt*ty;
   a.spinX=clamp(a.spinX+relT*.0007,-1,1);b.spinX=clamp(b.spinX-relT*.0007,-1,1);
  }
  const key=pairKey(a,b),isNew=!this.ballContactEpisodes.has(key);seen.add(key);
  if(isNew){
   const id=a.id===0?b.id:b.id===0?a.id:0;
   if(id&&!this.contacts.has(id)){this.contacts.add(id);this.contactOrder.push(id);if(this.firstCollision===null)this.firstCollision=id}
   if(a.id!==0&&b.id!==0&&!this.objectContactPairs.has(key)){this.objectContactPairs.add(key);this.objectContacts++}
   this.recordCollision('BALL_BALL',{substep,ballIds:[a.id,b.id],normal:{x:nx,y:ny},relativeNormalSpeed:rel,penetration:over,speedBefore:[beforeA,beforeB],speedAfter:[len(a.vx,a.vy),len(b.vx,b.vy)]});
  }
  return true;
 }

 circleStatic(b,o,bounce,key='bumper',seen=new Set(),substep=0){
  this.diagnostics.collisionChecks++;
  let dx=b.x-o.x,dy=b.y-o.y,d=Math.hypot(dx,dy),min=b.r+o.r;if(d>=min)return false;
  let nx,ny;if(d<min*COLLISION_EPSILON_RATIO){const speed=len(b.vx,b.vy);if(speed>NUMERIC_EPSILON){nx=-b.vx/speed;ny=-b.vy/speed}else{nx=stableSign(b.id);ny=0}d=0}else{nx=dx/d;ny=dy/d}
  const penetration=min-d,before=len(b.vx,b.vy);b.x=o.x+nx*min;b.y=o.y+ny*min;this.addCorrection(b,penetration);
  const dot=b.vx*nx+b.vy*ny;if(dot<0){b.vx-=dot*(1+bounce)*nx;b.vy-=dot*(1+bounce)*ny}
  const episode=`${key}:${b.id}`,isNew=!this.colliderContactEpisodes.has(episode);seen.add(episode);
  if(isNew)this.recordCollision('BUMPER',{substep,ballId:b.id,colliderId:key,normal:{x:nx,y:ny},relativeNormalSpeed:dot,penetration,speedBefore:before,speedAfter:len(b.vx,b.vy)});
  return true;
 }

 rail(b,rail,index=0,seen=new Set(),substep=0){
  this.diagnostics.collisionChecks++;
  const p=segmentClosest(b.x,b.y,rail.a,rail.b);let dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy),min=b.r+5;if(d>=min)return false;
  let nx,ny;
  if(d<min*COLLISION_EPSILON_RATIO){
   const sx=rail.b.x-rail.a.x,sy=rail.b.y-rail.a.y,sl=len(sx,sy);
   if(sl>NUMERIC_EPSILON){nx=-sy/sl;ny=sx/sl;const incidence=b.vx*nx+b.vy*ny;if(incidence>0){nx=-nx;ny=-ny}else if(Math.abs(incidence)<NUMERIC_EPSILON&&stableSign(b.id+index)<0){nx=-nx;ny=-ny}}
   else{const speed=len(b.vx,b.vy);if(speed>NUMERIC_EPSILON){nx=-b.vx/speed;ny=-b.vy/speed}else{nx=stableSign(b.id+index);ny=0}}
   d=0;
  }else{nx=dx/d;ny=dy/d}
  const penetration=min-d,before=len(b.vx,b.vy);b.x=p.x+nx*min;b.y=p.y+ny*min;this.addCorrection(b,penetration);
  const dot=b.vx*nx+b.vy*ny;if(dot<0){b.vx-=dot*1.9*nx;b.vy-=dot*1.9*ny}
  const episode=`rail:${index}:${b.id}`,isNew=!this.colliderContactEpisodes.has(episode);seen.add(episode);
  if(isNew)this.recordCollision('ECHO_RAIL',{substep,ballId:b.id,colliderId:index,normal:{x:nx,y:ny},relativeNormalSpeed:dot,penetration,speedBefore:before,speedAfter:len(b.vx,b.vy)});
  return true;
 }
}

export function echoFromPath(path){
 if(path.length<5)return null;let best=null,bestD=0;
 for(let i=0;i<path.length-3;i++){
  const j=Math.min(path.length-1,i+Math.max(3,Math.floor(path.length*.35)));
  const d=Math.hypot(path[j].x-path[i].x,path[j].y-path[i].y);
  if(d>bestD){bestD=d;best={a:{...path[i]},b:{...path[j]},life:3}}
 }
 return bestD>80?best:null;
}
