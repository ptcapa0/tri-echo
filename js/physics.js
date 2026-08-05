import {clamp,len,segmentClosest} from './math.js';
export const STEP=1/120;
export class Physics{
 constructor(table){this.load(table)}
 load(table){this.table=table;this.balls=table.balls;this.time=0;this.path=[];this.contacts=new Set;this.contactOrder=[];this.cushions=0;this.active=false;this.portalLock=0}
 shoot(vx,vy){const b=this.balls[0];b.vx=vx;b.vy=vy;this.time=0;this.path=[{x:b.x,y:b.y}];this.contacts.clear();this.contactOrder=[];this.cushions=0;this.active=true}
 step(dt=STEP){if(!this.active)return;this.time+=dt;const {bounds,frictionZone}=this.table;
  for(const b of this.balls){let drag=1.25;if(frictionZone&&b.x>frictionZone.x&&b.x<frictionZone.x+frictionZone.w&&b.y>frictionZone.y&&b.y<frictionZone.y+frictionZone.h)drag*=frictionZone.factor;b.vx*=Math.exp(-drag*dt);b.vy*=Math.exp(-drag*dt);b.x+=b.vx*dt;b.y+=b.vy*dt;this.wall(b,bounds);for(const o of this.table.obstacles)this.circleStatic(b,o,1.04);for(const rail of this.table.rails)this.rail(b,rail)}
  for(let i=0;i<this.balls.length;i++)for(let j=i+1;j<this.balls.length;j++)this.pair(this.balls[i],this.balls[j]);
  const cue=this.balls[0],last=this.path[this.path.length-1];if(!last||Math.hypot(cue.x-last.x,cue.y-last.y)>17)this.path.push({x:cue.x,y:cue.y});
  if(this.time>12||this.balls.every(b=>len(b.vx,b.vy)<5)){for(const b of this.balls){b.vx=0;b.vy=0}this.active=false;return true}return false
 }
 wall(b,z){let hit=false;if(b.x-b.r<z.l){b.x=z.l+b.r;b.vx=Math.abs(b.vx)*.92;hit=true}if(b.x+b.r>z.r){b.x=z.r-b.r;b.vx=-Math.abs(b.vx)*.92;hit=true}if(b.y-b.r<z.t){b.y=z.t+b.r;b.vy=Math.abs(b.vy)*.92;hit=true}if(b.y+b.r>z.b){b.y=z.b-b.r;b.vy=-Math.abs(b.vy)*.92;hit=true}if(hit&&b.id===0)this.cushions++}
 pair(a,b){let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),min=a.r+b.r;if(d>=min)return;if(d<.001){dx=1;dy=0;d=1}const nx=dx/d,ny=dy/d,over=min-d;a.x-=nx*over*.5;a.y-=ny*over*.5;b.x+=nx*over*.5;b.y+=ny*over*.5;const rel=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;if(rel<0){const imp=-rel*.97;a.vx-=imp*nx;a.vy-=imp*ny;b.vx+=imp*nx;b.vy+=imp*ny}const id=a.id===0?b.id:b.id===0?a.id:0;if(id&&!this.contacts.has(id)){this.contacts.add(id);this.contactOrder.push(id)}}
 circleStatic(b,o,bounce){let dx=b.x-o.x,dy=b.y-o.y,d=Math.hypot(dx,dy),min=b.r+o.r;if(d>=min)return;if(d<.001){dx=1;d=1}const nx=dx/d,ny=dy/d;b.x=o.x+nx*min;b.y=o.y+ny*min;const dot=b.vx*nx+b.vy*ny;if(dot<0){b.vx-=dot*(1+bounce)*nx;b.vy-=dot*(1+bounce)*ny}}
 rail(b,rail){const p=segmentClosest(b.x,b.y,rail.a,rail.b),dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy),min=b.r+5;if(d>=min||d<.001)return;const nx=dx/d,ny=dy/d;b.x=p.x+nx*min;b.y=p.y+ny*min;const dot=b.vx*nx+b.vy*ny;if(dot<0){b.vx-=dot*1.86*nx;b.vy-=dot*1.86*ny}}
}
export function echoFromPath(path){if(path.length<5)return null;let best=null,bestD=0;for(let i=0;i<path.length-3;i++){const j=Math.min(path.length-1,i+Math.max(3,Math.floor(path.length*.35)));const d=Math.hypot(path[j].x-path[i].x,path[j].y-path[i].y);if(d>bestD){bestD=d;best={a:{...path[i]},b:{...path[j]},life:3}}}return bestD>80?best:null}
