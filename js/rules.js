import {dailySeed} from './generator.js';

export function deriveShotResult(physics){
 const pocketedIds=[...(physics.pocketed||[])];
 const contacts=physics.contacts instanceof Set?[...physics.contacts]:[...(physics.contacts||[])];
 return{
  pocketedIds,
  cuePocketed:pocketedIds.includes(0),
  objectPocketedIds:pocketedIds.filter(id=>id!==0),
  firstPocketedId:pocketedIds[0]??null,
  carom:contacts.length>=2,
  firstCollision:physics.firstCollision??null,
  contacts,
  cushions:physics.cushions||0
 };
}

export function fusionCaromSucceeded(result){return result.carom&&!result.cuePocketed}
export function shouldCreateEchoRail(result,{forged=false}={}){return forged||(!result.cuePocketed&&(result.carom||result.objectPocketedIds.length>0))}

export function dailyChallengeConfig(date=new Date()){
 return{seed:dailySeed(date),difficulty:'normal',tableStyle:'echo',adaptive:0,width:720,height:1120};
}

export function snapshotRuleState(ruleState,hybridPhase){return{ruleState:structuredClone(ruleState),hybridPhase}}
export function restoreRuleState(snapshot){return{ruleState:structuredClone(snapshot.ruleState),hybridPhase:snapshot.hybridPhase}}
export function applySoundSetting(audio,settings){audio.enabled=settings.sound!==false;return audio.enabled}
export function recordHoleResult(data,ok){data.stats.successes+=ok?1:0;data.stats.recent=[...(data.stats.recent||[]),ok].slice(-12);return data}
export function markDailyCompleted(data,dayKey){if(data.dailies.includes(dayKey))return false;data.dailies.push(dayKey);return true}
export function completeDailyRun(data,{mode,holeIndex,dayKey,totalHoles=6}){return mode==='daily'&&holeIndex>=totalHoles?markDailyCompleted(data,dayKey):false}

export class InteractionGate{
 constructor(){this.locked=false;this.reason=null}
 lock(reason){this.locked=true;this.reason=reason;return false}
 unlock(){this.locked=false;this.reason=null;return true}
 canAccept(paused=false,physicsActive=false){return !paused&&!this.locked&&!physicsActive}
}

const HOLE_START_FIELDS=['table','score','streak','totalStrokes','totalPar','results','inventory','activePower','ruleState','hybridPhase','strokes','holeIndex'];
export function captureHoleStartState(game){return Object.fromEntries(HOLE_START_FIELDS.map(key=>[key,structuredClone(game[key])]))}
export function restoreHoleStartState(game,snapshot){for(const key of HOLE_START_FIELDS)game[key]=structuredClone(snapshot[key]);return game}

export class RoundTaskController{
 constructor(setTimer=(callback,delay)=>setTimeout(callback,delay),clearTimer=timer=>clearTimeout(timer)){this.setTimer=setTimer;this.clearTimer=clearTimer;this.epoch=0;this.timers=new Set()}
 beginRound(){for(const timer of this.timers)this.clearTimer(timer);this.timers.clear();return++this.epoch}
 schedule(delay,callback){
  const epoch=this.epoch;let timer;
  timer=this.setTimer(()=>{this.timers.delete(timer);if(epoch===this.epoch)callback()},delay);
  this.timers.add(timer);return timer;
 }
}
