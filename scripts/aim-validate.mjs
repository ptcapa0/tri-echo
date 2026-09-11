import {deriveAimPreview} from '../js/aim-preview.js';
import {Physics,STEP} from '../js/physics.js';
import {estimateTableStoppingDistance} from '../js/physics-calibration.js';

const args=process.argv.slice(2),read=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:Number(args[i+1])},seed=read('--seed',1337),cases=read('--cases',2000);
const random=(initial=>()=>{let value=initial>>>0;value+=0x6D2B79F5;let t=value;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296})(seed);
const directionFor=angle=>({x:Math.cos(angle),y:Math.sin(angle)});
function makeTable({direction,mode,factor}){
 const cue={id:0,x:10000,y:10000,vx:0,vy:0,r:18,pocketed:false},normal={x:-direction.y,y:direction.x};let frictionZone=null;
 if(mode==='inside')frictionZone={x:500,y:500,w:19000,h:19000,factor};
 if(mode==='enter'){const center={x:cue.x+direction.x*900,y:cue.y+direction.y*900};frictionZone={x:center.x-500,y:center.y-500,w:1000,h:1000,factor}}
 if(mode==='exit'){const center={x:cue.x-direction.x*120,y:cue.y-direction.y*120};frictionZone={x:center.x-500,y:center.y-500,w:1000,h:1000,factor}}
 if(mode==='miss'){const center={x:cue.x+direction.x*900+normal.x*1400,y:cue.y+direction.y*900+normal.y*1400};frictionZone={x:center.x-350,y:center.y-350,w:700,h:700,factor}}
 return{w:20000,h:20000,bounds:{l:0,r:20000,t:0,b:20000},traditional:false,balls:[cue],obstacles:[],rails:[],pockets:[],hole:null,targetType:'none',frictionZone};
}
function physicsDistance(table,speed,direction){const physics=new Physics(structuredClone(table));physics.shoot(direction.x*speed,direction.y*speed);while(physics.active)physics.step(STEP);return physics.distanceTravelled}
function firstContact(table,speed,direction,targetDistance){const world=structuredClone(table),cue=world.balls[0];world.balls.push({id:'target',x:cue.x+direction.x*(targetDistance+36),y:cue.y+direction.y*(targetDistance+36),vx:0,vy:0,r:18,pocketed:false});const physics=new Physics(world);physics.shoot(direction.x*speed,direction.y*speed);while(physics.active)physics.step(STEP);return physics.contactOrder[0]??null}

let passes=0,mismatches=0,worstAbsoluteError=0,worstRelativeError=0,repro=null,contactMismatches=0;
const modes=['none','inside','enter','exit','miss'];
for(let index=0;index<cases;index++){
 const mode=modes[index%modes.length],factor=index%2?1.5:.62,angle=random()*Math.PI*2,direction=directionFor(angle),speed=120+random()*1800,table=makeTable({direction,mode,factor}),cue=table.balls[0],predicted=estimateTableStoppingDistance({table,cueBall:cue,shotDirection:direction,initialSpeed:speed}),actual=physicsDistance(table,speed,direction),absoluteError=Math.abs(predicted-actual),relativeError=actual?absoluteError/actual:0,tolerance=Math.max(actual*.03,18),reachableDistance=actual*.5,unreachableDistance=actual+72;
 const previewAt=distance=>deriveAimPreview({table:{...table,balls:[cue,{id:'target',x:cue.x+direction.x*(distance+36),y:cue.y+direction.y*(distance+36),r:18,pocketed:false}]},cueBall:cue,shotDirection:direction,shotSpeed:speed,assistance:1,maxPhysicalTravel:predicted});
 const contactsMatch=firstContact(table,speed,direction,reachableDistance)==='target'&&firstContact(table,speed,direction,unreachableDistance)===null&&previewAt(reachableDistance).firstHit?.id==='target'&&previewAt(unreachableDistance).firstHit?.id!=='target';
 if(absoluteError<=tolerance&&contactsMatch)passes++;else{mismatches++;if(!contactsMatch)contactMismatches++}
 if(absoluteError>worstAbsoluteError){worstAbsoluteError=absoluteError;worstRelativeError=relativeError;repro={seed,index,mode,factor,angle,speed,predicted,actual,absoluteError,relativeError,tolerance,contactsMatch}}
}
console.table([{cases,passes,mismatches,contactMismatches,worstAbsoluteError:+worstAbsoluteError.toFixed(3),worstRelativeErrorPct:+(worstRelativeError*100).toFixed(3),repro:repro?`${repro.seed}:${repro.index}:${repro.mode}`:'none'}]);
if(repro)console.log('worst repro',JSON.stringify(repro));
if(mismatches)process.exitCode=1;
