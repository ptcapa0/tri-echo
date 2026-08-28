import {clamp,len} from './math.js';
import {Physics,PHYSICS_PROFILE,STEP} from './physics.js';

export const MAX_REQUIRED_CUSHIONS=3;
const SAFETY_RESERVE_DIAMETERS=3;
const SOLVER_TOLERANCE=.01;
const POWER_EXPONENT=1.55;
const cache=new Map();

function ballDiameter(table){return (table.balls[0]?.r||18)*2}
function profileFor(table){return table.traditional?PHYSICS_PROFILE.traditional:PHYSICS_PROFILE.echo}

export function legacyShotMetrics(table,legacyScale=1.03){
 const diameter=ballDiameter(table),bounds=table.bounds;
 const playableLong=Math.max(bounds.r-bounds.l,bounds.b-bounds.t)-diameter;
 const requiredReach=playableLong*MAX_REQUIRED_CUSHIONS+diameter*SAFETY_RESERVE_DIAMETERS;
 return{maxSpeed:clamp(requiredReach*.88*legacyScale,2400,3300),requiredReach};
}

function freeTable({traditional=false,diameter=36,initialSpeed=0}){
 const radius=diameter/2,width=Math.max(10000,initialSpeed*PHYSICS_PROFILE.maxShotTime+2000);
 return{w:width,h:1000,bounds:{l:0,r:width,t:0,b:1000},traditional,balls:[{id:0,x:1000,y:500,vx:0,vy:0,r:radius,pocketed:false}],obstacles:[],frictionZone:null,rails:[],pockets:[],hole:null,targetType:'none'};
}

export function simulateStoppingDistance(initialSpeed,{traditional=false,diameter=36,sampleInterval=.25}={}){
 const table=freeTable({traditional,diameter,initialSpeed}),physics=new Physics(table),velocitySamples=[{time:0,speed:initialSpeed}];
 let nextSample=sampleInterval;
 physics.shoot(initialSpeed,0);
 while(physics.active){
  physics.step(STEP);
  if(physics.time+STEP/2>=nextSample){velocitySamples.push({time:physics.time,speed:len(physics.balls[0].vx,physics.balls[0].vy)});nextSample+=sampleInterval}
 }
 if(velocitySamples.at(-1).time!==physics.time)velocitySamples.push({time:physics.time,speed:0});
 return{initialSpeed,distance:physics.distanceTravelled,time:physics.time,velocitySamples};
}

function laneTable(table){
 const bounds={...table.bounds},diameter=ballDiameter(table),radius=diameter/2,vertical=(bounds.b-bounds.t)>=(bounds.r-bounds.l);
 const cue={id:0,x:vertical?(bounds.l+bounds.r)/2:bounds.l+radius,y:vertical?bounds.t+radius:(bounds.t+bounds.b)/2,vx:0,vy:0,r:radius,pocketed:false};
 return{w:table.w,h:table.h,bounds,traditional:!!table.traditional,balls:[cue],obstacles:[],frictionZone:null,rails:[],pockets:[],hole:null,targetType:'none',vertical};
}

export function simulateCushionEnvelope(table,initialSpeed){
 const lane=laneTable(table),physics=new Physics(lane),cushionEvents=[];
 let priorCushions=0,maxStep=0,previous={x:physics.balls[0].x,y:physics.balls[0].y};
 physics.shoot(lane.vertical?0:initialSpeed,lane.vertical?initialSpeed:0);
 while(physics.active){
  const speedBefore=len(physics.balls[0].vx,physics.balls[0].vy);
  physics.step(STEP);
  const cue=physics.balls[0],speedAfter=len(cue.vx,cue.vy);
  maxStep=Math.max(maxStep,Math.hypot(cue.x-previous.x,cue.y-previous.y));previous={x:cue.x,y:cue.y};
  if(physics.cushions>priorCushions){cushionEvents.push({index:physics.cushions,distance:physics.distanceTravelled,speedBefore,speedAfter,retained:speedBefore?speedAfter/speedBefore:0});priorCushions=physics.cushions}
 }
 return{initialSpeed,distance:physics.distanceTravelled,time:physics.time,cushions:physics.cushions,cushionEvents,maxStep};
}

export function computeShotRequirement(table){
 const diameter=ballDiameter(table),bounds=table.bounds;
 const playableLong=Math.max(bounds.r-bounds.l,bounds.b-bounds.t)-diameter;
 const challengeDistance=playableLong*MAX_REQUIRED_CUSHIONS;
 const reserveDistance=diameter*SAFETY_RESERVE_DIAMETERS;
 const safetyMargin=diameter/2;
 return{ballDiameter:diameter,playableLong,maxCushions:MAX_REQUIRED_CUSHIONS,challengeDistance,reserveDistance,safetyMargin,requiredReach:challengeDistance+reserveDistance+safetyMargin};
}

function satisfies(measurement,requirement){return measurement.cushions>=requirement.maxCushions&&measurement.distance>=requirement.requiredReach}

export function solveInitialSpeedForRequirement(table,requirement=computeShotRequirement(table)){
 const safeMaximum=requirement.ballDiameter*PHYSICS_PROFILE.maxSafeStepRatio/STEP;
 const safeMeasurement=simulateCushionEnvelope(table,safeMaximum);
 if(!satisfies(safeMeasurement,requirement))throw new RangeError(`Shot requirement exceeds the fixed-step safety envelope (${safeMeasurement.distance.toFixed(1)} < ${requirement.requiredReach.toFixed(1)})`);
 let low=0,high=safeMaximum;
 for(let i=0;i<36;i++){
  const middle=(low+high)/2,measurement=simulateCushionEnvelope(table,middle);
  if(satisfies(measurement,requirement))high=middle;else low=middle;
 }
 const speed=Math.ceil(high/SOLVER_TOLERANCE)*SOLVER_TOLERANCE;
 return{speed,measurement:simulateCushionEnvelope(table,speed),safeMaximum,tolerance:SOLVER_TOLERANCE};
}

export function calibrateShot(table){
 const requirement=computeShotRequirement(table),bounds=table.bounds;
 const key=[bounds.r-bounds.l,bounds.b-bounds.t,requirement.ballDiameter,table.traditional?1:0].join(':');
 if(cache.has(key))return{...cache.get(key)};
 const solved=solveInitialSpeedForRequirement(table,requirement),stopping=simulateStoppingDistance(solved.speed,{traditional:!!table.traditional,diameter:requirement.ballDiameter});
 const result={diameter:requirement.ballDiameter,playableLong:requirement.playableLong,maxCushions:requirement.maxCushions,reserveDistance:requirement.reserveDistance,safetyMargin:requirement.safetyMargin,requiredReach:requirement.requiredReach,maxSpeed:solved.speed,measuredReach:solved.measurement.distance,stoppingDistance:stopping.distance,stoppingTime:stopping.time,stepDisplacement:solved.speed*STEP,stepRatio:solved.speed*STEP/requirement.ballDiameter,profile:profileFor(table)};
 cache.set(key,result);return{...result};
}

export function computeGestureMetrics(width,height){
 const shortDimension=Math.min(width,height);
 return{fullPullCss:clamp(shortDimension*.4,140,180),deadZoneCss:clamp(shortDimension*.035,12,18)};
}

export function powerCurve(effectivePull){return Math.pow(clamp(effectivePull,0,1),POWER_EXPONENT)}

export function mapPullToPower(distance,{maxSpeed,fullPullCss,deadZoneCss}){
 if(distance<=deadZoneCss)return{speed:0,normalizedPower:0,effectivePull:0};
 const effectivePull=clamp((distance-deadZoneCss)/(fullPullCss-deadZoneCss),0,1),normalizedPower=powerCurve(effectivePull);
 return{speed:maxSpeed*normalizedPower,normalizedPower,effectivePull};
}

export function crossedPowerThreshold(previous,current){
 if(current<=previous)return null;
 const crossed=[.25,.5,.75,1].filter(threshold=>previous<threshold&&current>=threshold);
 return crossed.at(-1)??null;
}
