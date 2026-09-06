import {mulberry32} from '../js/math.js';
import {pocketTrajectory} from '../tests/helpers/pocket-trajectories.js';
import {generateTable} from '../js/generator.js';
import {Physics,STEP,MAX_INTERNAL_SUBSTEPS} from '../js/physics.js';
import {calibrateShot} from '../js/physics-calibration.js';
const arg=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:Number(process.argv[index+1])};
const seed=arg('--seed',1337),cases=arg('--cases',10000);
if(!Number.isInteger(seed)||!Number.isInteger(cases)||cases<1)throw new Error('Expected integer --seed and positive --cases');
const rng=mulberry32(seed),profiles=['american','snooker','classic'],rows={},failures=[],started=performance.now();
let maxSubsteps=0,maxEnergyRatio=0,maxResidualOverlap=0;
for(let i=0;i<cases;i++){
 const profile=profiles[i%3],pocketIndex=Math.floor(i/3)%6,radius=[13,15,18][Math.floor(i/18)%3];
 const config={profile,pocketIndex,radius,offset:(rng()*2-1)*1.1,angle:(rng()*2-1)*.45,speed:100+rng()*2300,spin:rng()*2-1};
 const r=pocketTrajectory(config),type=r.pocket.type,key=`${profile}/${type}`;
 const row=rows[key]??={Profile:profile,Type:type,Cases:0,Pots:0,'Jaw rejects':0,Rattles:0,Escapes:0,'Invalid captures':0,'Silent jaw misses':0};
 row.Cases++;row.Pots+=+r.pot;row['Jaw rejects']+=+r.jawReject;row.Rattles+=+r.rattle;row.Escapes+=+r.escape;row['Invalid captures']+=r.invalidCaptures;row['Silent jaw misses']+=r.silentJawMisses;
 maxSubsteps=Math.max(maxSubsteps,r.physics.diagnostics.maxInternalSubsteps);maxEnergyRatio=Math.max(maxEnergyRatio,r.maxEnergyRatio);maxResidualOverlap=Math.max(maxResidualOverlap,r.maxResidualOverlap);
 if(r.maxResidualOverlap>radius*2*.05||!r.finite||r.invalidCaptures||r.silentJawMisses||r.maxEnergyRatio>1+1e-8||r.physics.diagnostics.maxInternalSubsteps>MAX_INTERNAL_SUBSTEPS)failures.push({index:i,seed,...config,finite:r.finite,invalid:r.invalidCaptures,misses:r.silentJawMisses,energy:r.maxEnergyRatio,overlap:r.maxResidualOverlap});
}
console.log(`TRI//ECHO pockets — seed ${seed}; ${cases} deterministic trajectories`);console.table(Object.values(rows));
// Sweep equal inputs, report the continuous central acceptance window rather
// than counting disconnected rattle pots as a wider opening.
const windows=[];
for(const profile of profiles)for(const pocketIndex of [0,2])for(const speed of [110,600,2400]){
 let positive=0,negative=0;
 for(const sign of [-1,1])for(let i=0;i<=100;i++){
  const offset=sign*i*.01,r=pocketTrajectory({profile,pocketIndex,speed,offset,radius:{american:15,snooker:13,classic:18}[profile]});
  if(!r.pot)break;if(sign>0)positive=offset;else negative=offset;
 }
 windows.push({profile,type:pocketIndex===0?'corner':'side',speed,'central width / diameter':+(positive-negative).toFixed(2)});
}
console.log('Acceptance at normal incidence; offsets sampled every 0.01 diameter');console.table(windows);
const racks=[];
for(const ballSet of ['american','british']){
 const t=generateTable(seed,'normal',0,720,1120,{ballSet,traditional:true,tableStyle:'snooker'}),p=new Physics(t,{diagnostics:true}),speed=calibrateShot(t).maxSpeed,times=[];
 p.shoot(0,-speed);let steps=0;
 while(p.active&&steps++<3300){const start=performance.now();p.step(STEP);times.push(performance.now()-start)}
 times.sort((a,b)=>a-b);const finite=t.balls.every(b=>[b.x,b.y,b.vx,b.vy].every(Number.isFinite));
 racks.push({balls:t.balls.length,steps,finite,checks:p.diagnostics.collisionChecks,maxSubsteps:p.diagnostics.maxInternalSubsteps,'p95 step ms':+times[Math.floor(times.length*.95)].toFixed(3),'max step ms':+times.at(-1).toFixed(3)});
 if(!finite||steps>=3300||p.diagnostics.maxInternalSubsteps>16)failures.push({rack:ballSet});
}
console.log('Production racks with physical pockets (local timing, not mobile hardware)');console.table(racks);
console.log(JSON.stringify({seed,cases,failures:failures.length,maxSubsteps,maxEnergyRatio,maxResidualOverlap,elapsedMs:+(performance.now()-started).toFixed(1),reproductions:failures.slice(0,10)},null,2));
if(failures.length)process.exitCode=1;
