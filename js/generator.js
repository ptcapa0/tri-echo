import {mulberry32,dist,hashString} from './math.js';
export const DIFFICULTY={
 relaxed:{preview:1,obstacles:[0,1],lives:5,rails:3,margin:70,pocket:40},
 normal:{preview:.62,obstacles:[1,2],lives:3,rails:3,margin:58,pocket:36},
 hard:{preview:.34,obstacles:[2,3],lives:2,rails:2,margin:48,pocket:32},
 adaptive:{preview:.58,obstacles:[1,3],lives:3,rails:3,margin:56,pocket:36}
};
export function dailySeed(date=new Date()){return hashString(`tri-echo-v4:${date.getUTCFullYear()}-${date.getUTCMonth()+1}-${date.getUTCDate()}`)}
const ball=(x,y,id,r=18,extra={})=>({x,y,vx:0,vy:0,r,id,pocketed:false,...extra});
function point(rng,w,h,margin){return{x:margin+rng()*(w-2*margin),y:margin+rng()*(h-2*margin)}}
function clear(p,balls,obs,space=54){return balls.every(b=>dist(p,b)>space)&&obs.every(o=>Math.hypot(p.x-o.x,p.y-o.y)>o.r+space)}
export function sixPockets(bounds,r=31){
 const {l,r:rr,t,b}=bounds,m=(t+b)/2;
 return [{x:l,y:t,r},{x:rr,y:t,r},{x:l,y:m,r:r*.9},{x:rr,y:m,r:r*.9},{x:l,y:b,r},{x:rr,y:b,r}];
}

function threeBalls(rng,w,h,margin){
 const balls=[];let guard=0;
 while(balls.length<3&&guard++<500){const p=point(rng,w,h,margin);if(clear(p,balls,[],125))balls.push(ball(p.x,p.y,balls.length))}
 return balls.length===3?balls:[ball(w*.25,h*.72,0),ball(w*.72,h*.28,1),ball(w*.28,h*.28,2)];
}
function americanBalls(w,h){
 const balls=[ball(w*.5,h*.76,0,15,{role:'cue',color:'#efffff'})],r=15,dy=r*1.78,startY=h*.27;
 const rack=[1,9,2,3,8,10,11,4,12,5,6,13,7,14,15];let index=0;
 for(let row=0;row<5;row++)for(let col=0;col<=row;col++){const n=rack[index++],x=w*.5+(col-row/2)*r*2.05,y=startY+row*dy;balls.push(ball(x,y,n,r,{number:n,role:n===8?'eight':n<8?'solid':'stripe'}))}
 return balls;
}
function britishBalls(w,h){
 const colors={yellow:'#f4d43a',green:'#35b96c',brown:'#8b552e',blue:'#4194ed',pink:'#ff86ad',black:'#171b20'};
 const balls=[ball(w*.5,h*.78,0,13,{role:'cue',color:'#efffff'})],r=13,startY=h*.3;let id=1;
 for(let row=0;row<5;row++)for(let col=0;col<=row;col++)balls.push(ball(w*.5+(col-row/2)*r*2.08,startY+row*r*1.8,id++,r,{role:'red',value:1,color:'#e33b4f'}));
 const spots=[['yellow',2,w*.32,h*.72],['green',3,w*.68,h*.72],['brown',4,w*.5,h*.72],['blue',5,w*.5,h*.5],['pink',6,w*.5,h*.25],['black',7,w*.5,h*.12]];
 for(const [role,value,x,y] of spots)balls.push(ball(x,y,id++,r,{role,value,color:colors[role],spot:{x,y}}));
 return balls;
}
export function generateTable(seed,difficulty='normal',adaptive=0,w=720,h=1120,options={}){
 const rng=mulberry32(seed),base=DIFFICULTY[difficulty]||DIFFICULTY.normal,tier=difficulty==='adaptive'?Math.max(-1,Math.min(2,adaptive)):0;
 const tableStyle=options.tableStyle||'echo',ballSet=options.ballSet||'three',traditional=!!options.traditional,bounds={l:24,r:w-24,t:24,b:h-24};
 const balls=ballSet==='american'?americanBalls(w,h):ballSet==='british'?britishBalls(w,h):threeBalls(rng,w,h,base.margin);
 const purist=traditional||ballSet!=='three',range=base.obstacles,count=purist?0:Math.max(0,Math.floor(range[0]+rng()*(range[1]-range[0]+1)+tier)),obstacles=[];
 for(let i=0,tries=0;i<count&&tries++<120;){const p=point(rng,w,h,95),r=26+rng()*20;if(clear(p,balls,obstacles,78)){obstacles.push({...p,r,type:'bumper'});i++}}
 const frictionZone=!purist&&difficulty!=='relaxed'&&rng()>.55?{x:w*(.2+rng()*.35),y:h*(.25+rng()*.35),w:120+rng()*100,h:130+rng()*180,factor:rng()>.5?.62:1.5}:null;
 const targetType=options.targetType||(tableStyle==='snooker'||ballSet!=='three'||purist?'pockets':'portal');
 const table={seed,w,h,balls,obstacles,frictionZone,rails:[],bounds,hole:null,pockets:[],tableStyle,ballSet,traditional,targetType};
 if(targetType==='pockets')table.pockets=sixPockets(bounds,ballSet==='british'?30:33);
 else if(targetType==='portal')relocateHole(table,seed^0x9e3779b9,base.pocket);
 return table;
}
export function relocateHole(table,seed,r=table.hole?.r||34){
 const rng=mulberry32(seed),b=table.bounds,pad=r+34;let chosen=null;
 for(let tries=0;tries<300;tries++){const p={x:b.l+pad+rng()*(b.r-b.l-pad*2),y:b.t+pad+rng()*(b.b-b.t-pad*2)};if(table.balls.every(ball=>ball.pocketed||dist(p,ball)>r+ball.r+85)&&table.obstacles.every(o=>dist(p,o)>r+o.r+48)){chosen=p;break}}
 table.hole={...(chosen||{x:(b.l+b.r)/2,y:(b.t+b.b)/2}),r};return table.hole;
}
function safeFromTargets(table,p,ball){const targets=[...(table.pockets||[]),...(table.hole?[table.hole]:[])];return targets.every(h=>dist(p,h)>ball.r+h.r+55)}
export function respawnBall(table,ball,seed){
 const rng=mulberry32(seed),b=table.bounds,margin=ball.r+45;
 for(let tries=0;tries<300;tries++){const p={x:b.l+margin+rng()*(b.r-b.l-margin*2),y:b.t+margin+rng()*(b.b-b.t-margin*2)};if(table.balls.every(other=>other===ball||other.pocketed||dist(p,other)>ball.r+other.r+45)&&table.obstacles.every(o=>dist(p,o)>ball.r+o.r+35)&&safeFromTargets(table,p,ball)){Object.assign(ball,p,{vx:0,vy:0,pocketed:false,spinX:0,spinY:0});return true}}
 Object.assign(ball,{x:b.l+margin,y:b.b-margin,vx:0,vy:0,pocketed:false,spinX:0,spinY:0});return false;
}
function legalBallPosition(table,ball,p){
 const b=table.bounds;if(p.x-ball.r<b.l||p.x+ball.r>b.r||p.y-ball.r<b.t||p.y+ball.r>b.b)return false;
 return table.balls.every(other=>other===ball||other.pocketed||dist(p,other)>=ball.r+other.r+2)&&table.obstacles.every(o=>dist(p,o)>=ball.r+o.r+8)&&safeFromTargets(table,p,ball);
}
export function respotBall(table,ball){
 const origin=ball.spot||{x:(table.bounds.l+table.bounds.r)/2,y:(table.bounds.t+table.bounds.b)*.25},step=ball.r*2+6;
 const candidates=[origin];
 for(let ring=1;ring<=16;ring++)for(let y=-ring;y<=ring;y++)for(let x=-ring;x<=ring;x++)if(Math.max(Math.abs(x),Math.abs(y))===ring)candidates.push({x:origin.x+x*step,y:origin.y+y*step});
 const p=candidates.find(candidate=>legalBallPosition(table,ball,candidate));if(!p)return false;
 Object.assign(ball,p,{vx:0,vy:0,pocketed:false,spinX:0,spinY:0});return true;
}
export function tableIsValid(table){
 const b=table.bounds,targets=[...(table.pockets||[]),...(table.hole?[table.hole]:[])];if(table.balls.length<3||(targets.length===0&&table.targetType!=='none'))return false;
 return table.balls.every((p,i)=>p.x-p.r>=b.l&&p.x+p.r<=b.r&&p.y-p.r>=b.t&&p.y+p.r<=b.b&&table.balls.every((q,j)=>i===j||dist(p,q)>p.r+q.r-1)&&table.obstacles.every(o=>dist(p,o)>p.r+o.r+8));
}
