import {clamp,segmentClosest} from './math.js';
import {calibrateShot,estimateTableStoppingDistance} from './physics-calibration.js';
import {deriveAimPreview} from './aim-preview.js';
import {MAX_SUBSTEP_DISPLACEMENT_RATIO} from './physics.js';

export const FAIRNESS=Object.freeze({SAMPLES:24,MIN_OPEN:6,MAX_ATTEMPTS:8,EXIT:72,EPSILON:1e-6,bands:Object.freeze({relaxed:[0,.72],normal:[.04,.9],hard:[.12,1],adaptive:[.06,.96]}),margins:Object.freeze({relaxed:.14,normal:.075,hard:.03,adaptive:.06})});
const finite=value=>Number.isFinite(value),unit=(a,b)=>{const x=b.x-a.x,y=b.y-a.y,m=Math.hypot(x,y);return m?{x:x/m,y:y/m,m}:null},point=(a,d,u)=>({x:a.x+d*u.x,y:a.y+d*u.y});
const pointSegmentDistance=(p,a,b)=>{const q=segmentClosest(p.x,p.y,a,b);return Math.hypot(p.x-q.x,p.y-q.y)};
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const between=(value,a,b)=>value>=Math.min(a,b)-FAIRNESS.EPSILON&&value<=Math.max(a,b)+FAIRNESS.EPSILON;
function segmentsIntersect(a,b,c,d){const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b),opposite=(x,y)=>x>FAIRNESS.EPSILON&&y<-FAIRNESS.EPSILON||x<-FAIRNESS.EPSILON&&y>FAIRNESS.EPSILON;if(opposite(abC,abD)&&opposite(cdA,cdB))return true;return(Math.abs(abC)<=FAIRNESS.EPSILON&&between(c.x,a.x,b.x)&&between(c.y,a.y,b.y))||(Math.abs(abD)<=FAIRNESS.EPSILON&&between(d.x,a.x,b.x)&&between(d.y,a.y,b.y))||(Math.abs(cdA)<=FAIRNESS.EPSILON&&between(a.x,c.x,d.x)&&between(a.y,c.y,d.y))||(Math.abs(cdB)<=FAIRNESS.EPSILON&&between(b.x,c.x,d.x)&&between(b.y,c.y,d.y))}
function segmentDistance(a,b,c,d){return segmentsIntersect(a,b,c,d)?0:Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b))}
function inside(table,p,r){const b=table.bounds;return p.x-r>=b.l&&p.x+r<=b.r&&p.y-r>=b.t&&p.y+r<=b.b}
function segmentClear(a,b,r,table,{ignore=[]}={}){
 const ignored=new Set(ignore);
 for(const ball of table.balls||[]){if(ignored.has(ball)||ball.pocketed)continue;if(pointSegmentDistance(ball,a,b)<r+ball.r-FAIRNESS.EPSILON)return{clear:false,kind:'ball',id:ball.id}}
 for(const obstacle of table.obstacles||[])if(pointSegmentDistance(obstacle,a,b)<r+obstacle.r-FAIRNESS.EPSILON)return{clear:false,kind:'bumper'};
 for(const [id,rail] of (table.rails||[]).entries())if(segmentDistance(a,b,rail.a,rail.b)<r+(rail.radius??5)-FAIRNESS.EPSILON)return{clear:false,kind:'echo-rail',id};
 return{clear:true};
}
function staticValid(table){
 if(!table||!table.bounds||!Array.isArray(table.balls)||table.balls.length<3||!table.balls.every(ball=>finite(ball.x)&&finite(ball.y)&&finite(ball.r)&&inside(table,ball,ball.r)))return false;
 for(let i=0;i<table.balls.length;i++)for(let j=i+1;j<table.balls.length;j++)if(Math.hypot(table.balls[i].x-table.balls[j].x,table.balls[i].y-table.balls[j].y)<table.balls[i].r+table.balls[j].r-FAIRNESS.EPSILON)return false;
 return table.obstacles.every(o=>finite(o.x)&&finite(o.y)&&finite(o.r)&&inside(table,o,o.r))&&(table.rails||[]).every(rail=>finite(rail.a?.x)&&finite(rail.a?.y)&&finite(rail.b?.x)&&finite(rail.b?.y)&&finite(rail.radius??5))&&table.balls.every(ball=>(table.rails||[]).every(rail=>pointSegmentDistance(ball,rail.a,rail.b)>=ball.r+(rail.radius??5)-FAIRNESS.EPSILON));
}
function reachFor(table,cue,direction,speed){return estimateTableStoppingDistance({table,cueBall:cue,shotDirection:direction,initialSpeed:speed})}
function cueAccess(table,cue,speed){let open=0;for(let i=0;i<FAIRNESS.SAMPLES;i++){const d={x:Math.cos(Math.PI*2*i/FAIRNESS.SAMPLES),y:Math.sin(Math.PI*2*i/FAIRNESS.SAMPLES)},reach=reachFor(table,cue,d,speed),end=point(cue,Math.min(FAIRNESS.EXIT,reach),d);if(inside(table,end,cue.r)&&segmentClear(cue,end,cue.r,table,{ignore:[cue]}).clear)open++}return open}
function targetsFor(table){return table.hole?[table.hole]:table.pockets||[]}
function portalRoute(table,cue,object,target,speed){
 const out=unit(object,target);if(!out)return null;const ghost=point(object,-(cue.r+object.r),out),contactReserve=Math.min(cue.r,object.r)*MAX_SUBSTEP_DISPLACEMENT_RATIO,aimCenter=point(ghost,contactReserve,out),shot=unit(cue,aimCenter);if(!shot||!inside(table,ghost,cue.r))return null;
 const reach=reachFor(table,cue,shot,speed);if(shot.m>reach)return null;
 if(!segmentClear(cue,aimCenter,cue.r,table,{ignore:[cue,object]}).clear||!segmentClear(object,target,object.r,table,{ignore:[object]}).clear)return null;
 const preview=deriveAimPreview({table,cueBall:cue,shotDirection:shot,shotSpeed:speed,assistance:1,maxPhysicalTravel:reach});if(preview.firstHit?.type!=='BALL'||preview.firstHit.id!==object.id)return null;
 const cueDistance=preview.firstHit.distance,margin=Math.min(1,Math.max(0,(reach-cueDistance)/Math.max(1,reach))*2);
 return{objectId:object.id,targetId:target.id??'portal',ghost,aimCenter,contactReserve,shotDirection:{x:shot.x,y:shot.y},cueDistance,physicalReach:reach,objectDistance:out.m,margin};
}
export function analyzeTableFairness(table,{difficulty='normal',adaptive=0}={}){
 const reasons=[];if(!staticValid(table))return{accepted:false,physicallyFeasible:false,difficultyMatched:false,difficultyScore:1,metrics:{},reasons:['INVALID_STATIC_GEOMETRY'],witness:null};
 const cue=table.balls[0],speed=calibrateShot(table).maxSpeed,openDirections=cueAccess(table,cue,speed);if(openDirections<FAIRNESS.MIN_OPEN)reasons.push('NO_CUE_EXIT');
 const objects=table.balls.slice(1).filter(ball=>!ball.pocketed),direct=objects.filter(object=>{const d=unit(cue,object);return d&&d.m<=reachFor(table,cue,d,speed)+cue.r+object.r&&segmentClear(cue,object,cue.r,table,{ignore:[cue,object]}).clear});if(!direct.length)reasons.push('NO_OBJECT_ACCESS');
 const routes=(table.targetType==='portal'||table.targetType==='pockets')?objects.flatMap(object=>targetsFor(table).map(target=>portalRoute(table,cue,object,target,speed)).filter(Boolean)):[];
 const witness=routes.sort((a,b)=>b.margin-a.margin||a.objectId-b.objectId)[0]||null;if((table.targetType==='portal'||table.targetType==='pockets')&&!witness)reasons.push('NO_TARGET_ROUTE');
 const margin=witness?.margin??(direct.length?openDirections/FAIRNESS.SAMPLES:0),reachRatio=witness?witness.cueDistance/witness.physicalReach:1,score=clamp(.42*(1-openDirections/FAIRNESS.SAMPLES)+.34*reachRatio+.24*(1-margin),0,1),band=FAIRNESS.bands[difficulty]||FAIRNESS.bands.normal,minMargin=FAIRNESS.margins[difficulty]||FAIRNESS.margins.normal;
 const physicallyFeasible=!reasons.some(reason=>!['LOW_SOLUTION_MARGIN','DIFFICULTY_OUT_OF_BAND'].includes(reason));if(margin<minMargin)reasons.push('LOW_SOLUTION_MARGIN');const difficultyMatched=score>=band[0]&&score<=band[1]&&margin>=minMargin;if(!difficultyMatched)reasons.push('DIFFICULTY_OUT_OF_BAND');
 return{accepted:physicallyFeasible&&difficultyMatched,physicallyFeasible,difficultyMatched,difficultyScore:score,metrics:{openDirections,directObjects:direct.length,targetRoutes:routes.length,solutionMargin:margin,reachRatio,adaptive},reasons,witness};
}
