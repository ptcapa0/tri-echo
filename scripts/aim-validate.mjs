import {generateTable} from '../js/generator.js';
import {deriveAimPreview} from '../js/aim-preview.js';
import {estimateStoppingDistance} from '../js/physics-calibration.js';

const args=process.argv.slice(2),read=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:Number(args[i+1])},seed=read('--seed',1337),cases=read('--cases',2000);
let matches=0,mismatches=0,worst=0;
for(let i=0;i<cases;i++){
 const table=generateTable((seed+Math.imul(i+1,2654435761))>>>0,i%3===0?'relaxed':i%3===1?'normal':'hard',0,720,1120,{tableStyle:i%4?'echo':'snooker',ballSet:i%5?'three':'american',traditional:i%4===0});
 const cue=table.balls[0],angle=(i*2.399963229728653+seed*.001)%(Math.PI*2),speed=200+(i%9)*220,preview=deriveAimPreview({table,cueBall:cue,shotDirection:{x:Math.cos(angle),y:Math.sin(angle)},shotSpeed:speed,assistance:1,maxPhysicalTravel:estimateStoppingDistance(speed,{traditional:table.traditional})});
 if(!preview.firstHit||preview.firstHit.distance<=preview.physicalReach+1e-7)matches++;else{mismatches++;worst=Math.max(worst,preview.firstHit.distance-preview.physicalReach)}
}
console.table([{cases,matches,mismatches,worstPositionalError:worst,worstSeed:seed}]);
if(mismatches)process.exitCode=1;
