import {generateTable} from '../js/generator.js';
import {PHYSICS_PROFILE} from '../js/physics.js';
import {
 calibrateShot,
 computeGestureMetrics,
 legacyShotMetrics,
 simulateCushionEnvelope,
 simulateStoppingDistance
} from '../js/physics-calibration.js';

const virtualHeight=(width,height)=>Math.max(620,Math.min(1440,720*height/width));
const profiles=[
 {name:'360×800',viewport:[360,800]},
 {name:'390×844',viewport:[390,844]},
 {name:'412×915',viewport:[412,915]},
 {name:'430×932',viewport:[430,932]},
 {name:'Daily 720×1120',viewport:[720,1120],height:1120},
 {name:'Desktop 1024×800',viewport:[1024,800]},
 {name:'Snooker 720×1120',viewport:[720,1120],height:1120,options:{tableStyle:'snooker',ballSet:'british',traditional:true}}
];

const rows=[],lossRows=[];
for(const profile of profiles){
 const [viewportWidth,viewportHeight]=profile.viewport,tableHeight=profile.height??virtualHeight(viewportWidth,viewportHeight);
 const table=generateTable(41,'normal',0,720,tableHeight,{tableStyle:'echo',...profile.options});
 table.hole=null;table.pockets=[];table.obstacles=[];table.frictionZone=null;table.rails=[];
 const legacy=legacyShotMetrics(table),calibration=calibrateShot(table),measurement=simulateCushionEnvelope(table,calibration.maxSpeed);
 const stopping=simulateStoppingDistance(calibration.maxSpeed,{traditional:!!table.traditional,diameter:calibration.diameter}),gesture=computeGestureMetrics(viewportWidth,viewportHeight);
 rows.push({
  Profile:profile.name,
  Table:`720×${Math.round(tableHeight)} ${table.traditional?'traditional':'echo'}`,
  Diameter:+calibration.diameter.toFixed(1),
  FixedDt:PHYSICS_PROFILE.fixedDt.toFixed(5),
  OldMax:+legacy.maxSpeed.toFixed(1),
  NewMax:+calibration.maxSpeed.toFixed(1),
  Required:+calibration.requiredReach.toFixed(1),
  Actual:+measurement.distance.toFixed(1),
  StopDistance:+stopping.distance.toFixed(1),
  StopTime:+stopping.time.toFixed(2),
  StepDisp:+calibration.stepDisplacement.toFixed(2),
  StepRatio:+calibration.stepRatio.toFixed(3),
  Cushions:measurement.cushions,
  FullPullCss:+gesture.fullPullCss.toFixed(1)
 });
 lossRows.push({
  Profile:profile.name,
  ReachAt1:+(measurement.cushionEvents[0]?.distance??0).toFixed(1),
  Retained1:`${((measurement.cushionEvents[0]?.retained??0)*100).toFixed(1)}%`,
  ReachAt3:+(measurement.cushionEvents[2]?.distance??0).toFixed(1),
  Retained3:`${((measurement.cushionEvents[2]?.retained??0)*100).toFixed(1)}%`,
  MaxRequiredReachable:measurement.cushions>=calibration.maxCushions&&measurement.distance>=calibration.requiredReach
 });
}

console.log('TRI//ECHO physics calibration — measured with the production Physics stepper');
console.table(rows);
console.log('Cushion envelope (distance and per-impact speed retention)');
console.table(lossRows);
