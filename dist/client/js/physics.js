import {clamp,len,segmentClosest} from './math.js';

export const STEP=1/180;
export const BASE_DRAG=.42;

export function shotMetrics(table,powerScale=1){
 const b=table.bounds,diameter=(table.balls[0]?.r||18)*2;
 const playableLong=Math.max(b.r-b.l,b.b-b.t)-diameter;
 const minimumControlDistance=diameter*3;
 const guaranteedPath=playableLong*3+minimumControlDistance;
 const maxSpeed=clamp(guaranteedPath*.88*powerScale,2400,3300);
 return{diameter,playableLong,minimumControlDistance,guaranteedPath,maxSpeed,fullPull:clamp(diameter*5.25,165,220),deadZone:diameter*.58};
}

export function powerFromPull(distance,metrics){
 if(distance<=metrics.deadZone)return{speed:0,ratio:0};
 const ratio=clamp((distance-metrics.deadZone)/(metrics.fullPull-metrics.deadZone),0,1);
 return{speed:95+(metrics.maxSpeed-95)*Math.pow(ratio,1.55),ratio};
}

export class Physics{
 constructor(table){this.load(table)}

 load(table){
  this.table=table;this.balls=table.balls;this.time=0;this.path=[];
  this.contacts=new Set();this.contactOrder=[];this.cushions=0;this.active=false;
  this.distanceTravelled=0;this.pocketed=[];this.shotPower=0;this.modifiers={};this.firstCollision=null;
  this.cueCushionsBeforeContact=0;this.objectCushions=0;this.objectContacts=0;
  for(const b of this.balls){b.pocketed=!!b.pocketed;b.spinX=0;b.spinY=0}
 }

 shoot(vx,vy,contact={x:0,y:0},powerRatio=0,modifiers={}){
  const b=this.balls[0];b.vx=vx;b.vy=vy;b.pocketed=false;
  b.spinX=clamp(contact.x,-1,1);b.spinY=clamp(-contact.y,-1,1);
  this.time=0;this.path=[{x:b.x,y:b.y}];this.contacts.clear();this.contactOrder=[];
   this.cushions=0;this.cueCushionsBeforeContact=0;this.objectCushions=0;this.objectContacts=0;
   this.distanceTravelled=0;this.pocketed=[];this.shotPower=powerRatio;this.modifiers=modifiers;this.firstCollision=null;this.active=true;
 }

 step(dt=STEP){
  if(!this.active)return false;
  this.time+=dt;
  const {bounds,frictionZone}=this.table;
  for(const b of this.balls){
   if(b.pocketed)continue;
   this.pocketPull(b,dt);
   let drag=this.table.traditional?.34:BASE_DRAG;
   if(frictionZone&&b.x>frictionZone.x&&b.x<frictionZone.x+frictionZone.w&&b.y>frictionZone.y&&b.y<frictionZone.y+frictionZone.h)drag*=frictionZone.factor;
   const speed=len(b.vx,b.vy),rollingResistance=this.table.traditional?15:18,rolling=Math.max(0,1-rollingResistance*dt/Math.max(speed,rollingResistance));
   b.vx*=Math.exp(-drag*dt)*rolling;b.vy*=Math.exp(-drag*dt)*rolling;
   b.spinX*=Math.exp(-.62*dt);b.spinY*=Math.exp(-.7*dt);
   const ox=b.x,oy=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;
   if(b.id===0)this.distanceTravelled+=Math.hypot(b.x-ox,b.y-oy);
   this.capturePocket(b);
   if(b.pocketed)continue;
   this.wall(b,bounds);
   if(!this.modifiers.phase)for(const o of this.table.obstacles)this.circleStatic(b,o,.96);
   for(const rail of this.table.rails)this.rail(b,rail);
   this.capturePocket(b);
  }
  for(let i=0;i<this.balls.length;i++)for(let j=i+1;j<this.balls.length;j++)if(!this.balls[i].pocketed&&!this.balls[j].pocketed)this.pair(this.balls[i],this.balls[j]);
  const cue=this.balls[0],last=this.path[this.path.length-1];
  if(!cue.pocketed&&(!last||Math.hypot(cue.x-last.x,cue.y-last.y)>17))this.path.push({x:cue.x,y:cue.y});
  const live=this.balls.filter(b=>!b.pocketed);
  if(this.time>18||live.every(b=>len(b.vx,b.vy)<5)){
   for(const b of live){b.vx=0;b.vy=0}
   this.active=false;return true;
  }
  return false;
 }

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

 wall(b,z){
  let axis='';
  if(b.x-b.r<z.l){b.x=z.l+b.r;b.vx=Math.abs(b.vx)*.94;axis='v'}
  if(b.x+b.r>z.r){b.x=z.r-b.r;b.vx=-Math.abs(b.vx)*.94;axis='v'}
  if(b.y-b.r<z.t){b.y=z.t+b.r;b.vy=Math.abs(b.vy)*.94;axis='h'}
  if(b.y+b.r>z.b){b.y=z.b-b.r;b.vy=-Math.abs(b.vy)*.94;axis='h'}
  if(axis){
   if(axis==='v')b.vy*=.985;else b.vx*=.985;
   if(axis==='v')b.vy+=b.spinX*Math.abs(b.vx)*.16;
   else b.vx-=b.spinX*Math.abs(b.vy)*.16;
   b.spinX*=-.72;
   if(b.id===0){this.cushions++;if(this.firstCollision===null)this.cueCushionsBeforeContact++}
   else this.objectCushions++;
  }
 }

 pair(a,b){
  let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r;
  if(d>=min)return;if(d<.001){dx=1;dy=0;d=1}
  const nx=dx/d,ny=dy/d,over=min-d;a.x-=nx*over*.5;a.y-=ny*over*.5;b.x+=nx*over*.5;b.y+=ny*over*.5;
  const rel=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
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
  const id=a.id===0?b.id:b.id===0?a.id:0;
  if(id&&!this.contacts.has(id)){this.contacts.add(id);this.contactOrder.push(id);if(this.firstCollision===null)this.firstCollision=id}
  if(a.id!==0&&b.id!==0)this.objectContacts++;
 }

 circleStatic(b,o,bounce){
  let dx=b.x-o.x,dy=b.y-o.y,d=Math.hypot(dx,dy),min=b.r+o.r;if(d>=min)return;
  if(d<.001){dx=1;d=1}const nx=dx/d,ny=dy/d;b.x=o.x+nx*min;b.y=o.y+ny*min;
  const dot=b.vx*nx+b.vy*ny;if(dot<0){b.vx-=dot*(1+bounce)*nx;b.vy-=dot*(1+bounce)*ny}
 }

 rail(b,rail){
  const p=segmentClosest(b.x,b.y,rail.a,rail.b),dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy),min=b.r+5;
  if(d>=min||d<.001)return;const nx=dx/d,ny=dy/d;b.x=p.x+nx*min;b.y=p.y+ny*min;
  const dot=b.vx*nx+b.vy*ny;if(dot<0){b.vx-=dot*1.9*nx;b.vy-=dot*1.9*ny}
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
