import {mulberry32,dist,hashString} from './math.js';

export const DIFFICULTY={
  relaxed:{preview:1.0,powerScale:1,obstacles:[0,1],lives:5,rails:3,margin:70,pocket:38},
  normal:{preview:.62,powerScale:1.03,obstacles:[1,2],lives:3,rails:3,margin:58,pocket:34},
  hard:{preview:.34,powerScale:1.06,obstacles:[2,3],lives:2,rails:2,margin:48,pocket:30},
  adaptive:{preview:.58,powerScale:1.03,obstacles:[1,3],lives:3,rails:3,margin:56,pocket:34}
};
export function dailySeed(date=new Date()){return hashString(`tri-echo-v1:${date.getUTCFullYear()}-${date.getUTCMonth()+1}-${date.getUTCDate()}`)}
function point(rng,w,h,margin){return{x:margin+rng()*(w-2*margin),y:margin+rng()*(h-2*margin)}}
function clear(p,balls,obs,space=54){return balls.every(b=>dist(p,b)>space)&&obs.every(o=>Math.hypot(p.x-o.x,p.y-o.y)>o.r+space)}
export function generateTable(seed,difficulty='normal',adaptive=0,w=720,h=1120){
 const rng=mulberry32(seed),base=DIFFICULTY[difficulty]||DIFFICULTY.normal;
 const tier=difficulty==='adaptive'?Math.max(-1,Math.min(2,adaptive)):0;
 const margin=base.margin, balls=[]; let guard=0;
 while(balls.length<3&&guard++<500){const p=point(rng,w,h,margin);if(clear(p,balls,[],125))balls.push({...p,vx:0,vy:0,r:18,id:balls.length})}
 if(balls.length<3)balls.splice(0,3,{x:w*.25,y:h*.72,vx:0,vy:0,r:18,id:0},{x:w*.72,y:h*.28,vx:0,vy:0,r:18,id:1},{x:w*.28,y:h*.28,vx:0,vy:0,r:18,id:2});
 const range=base.obstacles, count=Math.max(0,Math.floor(range[0]+rng()*(range[1]-range[0]+1)+tier)); const obstacles=[];
 for(let i=0,tries=0;i<count&&tries++<120;){const p=point(rng,w,h,95),r=26+rng()*20;if(clear(p,balls,obstacles,78)){obstacles.push({...p,r,type:'bumper'});i++}}
 const frictionZone=(difficulty!=='relaxed'&&rng()>.55)?{x:w*(.2+rng()*.35),y:h*(.25+rng()*.35),w:120+rng()*100,h:130+rng()*180,factor:rng()>.5?.62:1.5}:null;
 const table={seed,w,h,balls,obstacles,frictionZone,rails:[],bounds:{l:24,r:w-24,t:24,b:h-24},hole:null};
 relocateHole(table,seed^0x9e3779b9,base.pocket);
 return table;
}
export function relocateHole(table,seed,r=table.hole?.r||34){
 const rng=mulberry32(seed),b=table.bounds,pad=r+34;let chosen=null;
 for(let tries=0;tries<300;tries++){
  const p={x:b.l+pad+rng()*(b.r-b.l-pad*2),y:b.t+pad+rng()*(b.b-b.t-pad*2)};
  const ballSafe=table.balls.every(ball=>ball.pocketed||dist(p,ball)>r+ball.r+85);
  const obstacleSafe=table.obstacles.every(o=>dist(p,o)>r+o.r+48);
  if(ballSafe&&obstacleSafe){chosen=p;break}
 }
 table.hole={...(chosen||{x:(b.l+b.r)/2,y:(b.t+b.b)/2}),r};return table.hole;
}
export function respawnBall(table,ball,seed){
 const rng=mulberry32(seed),b=table.bounds,margin=ball.r+45;
 for(let tries=0;tries<300;tries++){
  const p={x:b.l+margin+rng()*(b.r-b.l-margin*2),y:b.t+margin+rng()*(b.b-b.t-margin*2)};
  if(table.balls.every(other=>other===ball||other.pocketed||dist(p,other)>ball.r+other.r+75)&&table.obstacles.every(o=>dist(p,o)>ball.r+o.r+35)&&dist(p,table.hole)>ball.r+table.hole.r+90){Object.assign(ball,p,{vx:0,vy:0,pocketed:false,spinX:0,spinY:0});return true}
 }
 Object.assign(ball,{x:b.l+margin,y:b.b-margin,vx:0,vy:0,pocketed:false,spinX:0,spinY:0});return false;
}
export function tableIsValid(table){if(table.balls.length!==3||!table.hole)return false;const b=table.bounds;return table.hole.x-table.hole.r>b.l&&table.hole.x+table.hole.r<b.r&&table.hole.y-table.hole.r>b.t&&table.hole.y+table.hole.r<b.b&&table.balls.every((p,i)=>p.x-p.r>b.l&&p.x+p.r<b.r&&p.y-p.r>b.t&&p.y+p.r<b.b&&dist(p,table.hole)>p.r+table.hole.r+20&&table.balls.every((q,j)=>i===j||dist(p,q)>p.r+q.r+20)&&table.obstacles.every(o=>dist(p,o)>p.r+o.r+18));}
