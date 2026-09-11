import {clamp,segmentClosest} from './math.js';
import {calibrateShot,estimateTableStoppingDistance} from './physics-calibration.js';

export const FAIRNESS=Object.freeze({SAMPLES:24,MIN_OPEN:6,MAX_ATTEMPTS:8,EXIT:72,EPSILON:1e-6,bands:Object.freeze({relaxed:[0,.72],normal:[.04,.9],hard:[.12,1],adaptive:[.06,.96]}),margins:Object.freeze({relaxed:.14,normal:.075,hard:.03,adaptive:.06})});
const finite=value=>Number.isFinite(value);
const unit=(from,to)=>{const x=to.x-from.x,y=to.y-from.y,m=Math.hypot(x,y);return m?{x:x/m,y:y/m,m}:null};
const point=(origin,distance,direction)=>({x:origin.x+direction.x*distance,y:origin.y+direction.y*distance});
function inside(table,p,r){const b=table.bounds;return p.x-r>=b.l&&p.x+r<=b.r&&p.y-r>=b.t&&p.y+r<=b.b}
function segmentClear(a,b,r,table,{ignore=[]}={}){
 const ignored=new Set(ignore),distance=Math.hypot(b.x-a.x,b.y-a.y);
 for(const ball of table.balls||[]){if(ignored.has(ball)||ball.pocketed)continue;const q=segmentClosest(ball.x,ball.y,a,b);if(Math.hypot(ball.x-q.x,ball.y-q.y)<r+ball.r-FAIRNESS.EPSILON)return{clear:false,clearance:0,kind:'ball',id:ball.id}}
 for(const obstacle of table.obstacles||[]){const q=segmentClosest(obstacle.x,obstacle.y,a,b);if(Math.hypot(obstacle.x-q.x,obstacle.y-q.y)<r+obstacle.r-FAIRNESS.EPSILON)return{clear:false,clearance:0,kind:'bumper'}}
 for(const rail of table.rails||[]){const q=segmentClosest((a.x+b.x)/2,(a.y+b.y)/2,rail.a,rail.b);if(Math.hypot(q.x-(a.x+b.x)/2,q.y-(a.y+b.y)/2)<r+(rail.radius??5)-FAIRNESS.EPSILON)return{clear:false,clearance:0,kind:'echo-rail'}}
 return{clear:true,clearance:distance};
}
function staticValid(table){
 if(!table||!table.bounds||!Array.isArray(table.balls)||table.balls.length<3||!table.balls.every(ball=>finite(ball.x)&&finite(ball.y)&&finite(ball.r)&&inside(table,ball,ball.r)))return false;
 for(let i=0;i<table.balls.length;i++)for(let j=i+1;j<table.balls.length;j++)if(Math.hypot(table.balls[i].x-table.balls[j].x,table.balls[i].y-table.balls[j].y)<table.balls[i].r+table.balls[j].r-FAIRNESS.EPSILON)return false;
 return table.obstacles.every(o=>finite(o.x)&&finite(o.y)&&finite(o.r)&&inside(table,o,o.r));
}
function cueAccess(table,cue,reach){
 let open=0;
 for(let i=0;i<FAIRNESS.SAMPLES;i++){
  const angle=Math.PI*2*i/FAIRNESS.SAMPLES,direction={x:Math.cos(angle),y:Math.sin(angle)},end=point(cue,Math.min(FAIRNESS.EXIT,reach),direction);
  if(inside(table,end,cue.r)&&segmentClear(cue,end,cue.r,table,{ignore:[cue]}).clear)open++;
 }
 return open;
}
function portalRoute(table,cue,object,target,reach){
 const out=unit(object,target);if(!out)return null;
 const ghost=point(object,-(cue.r+object.r),out);
 if(!inside(table,ghost,cue.r))return null;
 const objectPath=segmentClear(object,target,object.r,table,{ignore:[object]});
 const cuePath=segmentClear(cue,object,cue.r,table,{ignore:[cue,object]});
 const incoming=unit(cue,object);if(!objectPath.clear||!cuePath.clear||!incoming)return null;
 // A cue need not start on the exact full-ball ghost ray: physically plausible
 // cut contacts retain an impulse toward the target while preserving a bounded
 // angular corridor. The ghost remains a legal contact-space guardrail.
 const alignment=incoming.x*out.x+incoming.y*out.y;
 if(alignment<-.2)return null;
 const cueDistance=Math.hypot(object.x-cue.x)-(cue.r+object.r);
 if(cueDistance>reach)return null;
 return{cueDistance,alignment,margin:Math.min(1,(alignment+.2)/1.2),objectDistance:out.m};
}
function targetsFor(table){return table.hole?[table.hole]:table.pockets||[]}
export function analyzeTableFairness(table,{difficulty='normal',adaptive=0}={}){
 const reasons=[];if(!staticValid(table))return{accepted:false,feasible:false,difficultyScore:1,metrics:{},reasons:['INVALID_STATIC_GEOMETRY']};
 const cue=table.balls[0],profile=calibrateShot(table),reach=estimateTableStoppingDistance({table,cueBall:cue,shotDirection:{x:1,y:0},initialSpeed:profile.maxSpeed});
 const openDirections=cueAccess(table,cue,reach);if(openDirections<FAIRNESS.MIN_OPEN)reasons.push('NO_CUE_EXIT');
 const objects=table.balls.slice(1).filter(ball=>!ball.pocketed),direct=objects.filter(object=>segmentClear(cue,object,cue.r,table,{ignore:[cue,object]}).clear&&Math.hypot(object.x-cue.x,object.y-cue.y)<=reach+object.r+cue.r);
 if(!direct.length)reasons.push('NO_OBJECT_ACCESS');
 let routes=[];const targets=targetsFor(table);
 if(table.targetType==='portal'||table.targetType==='pockets'){
  routes=objects.flatMap(object=>targets.map(target=>portalRoute(table,cue,object,target,reach)).filter(Boolean));
  if(!routes.length)reasons.push('NO_TARGET_ROUTE');
 }
 const best=routes.sort((a,b)=>b.margin-a.margin)[0],margin=best?.margin??(direct.length?openDirections/FAIRNESS.SAMPLES:0),reachRatio=best?best.cueDistance/reach:direct[0]?Math.hypot(direct[0].x-cue.x,direct[0].y-cue.y)/reach:1;
 const score=clamp(.42*(1-openDirections/FAIRNESS.SAMPLES)+.34*clamp(reachRatio,0,1)+.24*(1-margin),0,1),band=FAIRNESS.bands[difficulty]||FAIRNESS.bands.normal,minMargin=FAIRNESS.margins[difficulty]||FAIRNESS.margins.normal;
 if(margin<minMargin)reasons.push('LOW_SOLUTION_MARGIN');
 if(score<band[0]||score>band[1])reasons.push('DIFFICULTY_OUT_OF_BAND');
 return{accepted:reasons.length===0,feasible:!reasons.some(reason=>reason!=='DIFFICULTY_OUT_OF_BAND'&&reason!=='LOW_SOLUTION_MARGIN'),difficultyScore:score,metrics:{openDirections,directObjects:direct.length,targetRoutes:routes.length,physicalReach:reach,reachRatio,solutionMargin:margin,adaptive},reasons};
}
