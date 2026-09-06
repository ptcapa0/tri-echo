import {createPocketGeometry,pocketPoint,pocketCoordinates} from '../../js/pocket-geometry.js';
import {segmentClosest} from '../../js/math.js';
import {Physics,STEP} from '../../js/physics.js';

export function pocketTrajectory({profile='american',pocketIndex=0,radius=15,offset=0,angle=0,speed=300,spin=0,minimumInternalSubsteps=1,maxSteps=900}={}){
 const diameter=radius*2,geometry=createPocketGeometry({l:100,r:772,t:100,b:1172},diameter,profile),pocket=geometry.pockets[pocketIndex];
 const direction={x:pocket.outward.x*Math.cos(angle)+pocket.tangent.x*Math.sin(angle),y:pocket.outward.y*Math.cos(angle)+pocket.tangent.y*Math.sin(angle)};
 const start=pocketPoint(pocket,(offset-2*Math.tan(angle))*diameter,-2*diameter);
 const ball={...start,id:0,r:radius,vx:0,vy:0,pocketed:false};
 const table={w:872,h:1272,bounds:{l:100,r:772,t:100,b:1172},balls:[ball],traditional:true,pocketModel:'physical',pocketGeometry:geometry,pockets:geometry.pockets,hole:null,rails:[],obstacles:[],frictionZone:null};
 const physics=new Physics(table,{diagnostics:true,minimumInternalSubsteps});physics.shoot(direction.x*speed,direction.y*speed,{x:spin,y:0});
 let steps=0,finite=true,maxEnergyRatio=0,silentJawMisses=0,maxResidualOverlap=0;
 // Observe every production microstep. The independent plane-crossing oracle
 // detects a center crossing a finite solid jaw without being rejected.
 const integrate=physics.integrateSlice.bind(physics);
 physics.integrateSlice=(dt,substep)=>{
  const before={x:ball.x,y:ball.y},energy=ball.vx**2+ball.vy**2;
  integrate(dt,substep);
  finite&&=[ball.x,ball.y,ball.vx,ball.vy].every(Number.isFinite);
  if(energy>1e-9)maxEnergyRatio=Math.max(maxEnergyRatio,(ball.vx**2+ball.vy**2)/energy);
  for(const s of geometry.segments){
   if(!ball.pocketed){const closest=segmentClosest(ball.x,ball.y,s.a,s.b);maxResidualOverlap=Math.max(maxResidualOverlap,ball.r+s.radius-Math.hypot(ball.x-closest.x,ball.y-closest.y))}
   const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,length=Math.hypot(dx,dy);
   const a=((before.x-s.a.x)*dy-(before.y-s.a.y)*dx)/length;
   const b=((ball.x-s.a.x)*dy-(ball.y-s.a.y)*dx)/length;
   if(a*b>=0)continue;
   const fraction=a/(a-b),x=before.x+(ball.x-before.x)*fraction,y=before.y+(ball.y-before.y)*fraction;
   const along=((x-s.a.x)*dx+(y-s.a.y)*dy)/(length*length);
   if(along>1e-6&&along<1-1e-6)silentJawMisses++;
  }
 };
 while(physics.active&&steps++<maxSteps){physics.step(STEP);const c=pocketCoordinates(pocket,ball);if(!ball.pocketed&&c.depth<-3*diameter)break}
 const events=physics.collisionEvents,jaws=events.filter(e=>e.type==='CUSHION'&&['jaw','throat'].includes(e.part));
 const capture=events.find(e=>e.type==='POCKET_CAPTURE');
 const entry=capture&&events.find(e=>e.type==='POCKET_ENTRY'&&e.pocketId===capture.pocketId);
 let invalidCaptures=0;
 if(ball.pocketed){
  const p=geometry.pockets[capture?.pocketId],z=table.bounds;
  const stillOnCloth=ball.x>=z.l&&ball.x<=z.r&&ball.y>=z.t&&ball.y<=z.b;
  if(!capture||!entry||events.indexOf(entry)>events.indexOf(capture)||stillOnCloth||!p)invalidCaptures++;
 }
 return{table,ball,pocket,physics,steps,finite,maxEnergyRatio,maxResidualOverlap,silentJawMisses,invalidCaptures,pot:ball.pocketed,jawReject:!ball.pocketed&&jaws.length>0,rattle:jaws.length>=2,escape:events.some(e=>e.type==='POCKET_ESCAPE'),jaws:jaws.length};
}
