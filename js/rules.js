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
 return{dayKey:date.toISOString().slice(0,10),seed:dailySeed(date),difficulty:'normal',tableStyle:'echo',adaptive:0,width:720,height:1120};
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
 constructor(setTimer=(callback,delay)=>setTimeout(callback,delay),clearTimer=timer=>clearTimeout(timer),now=()=>performance.now()){
  this.setTimer=setTimer;this.clearTimer=clearTimer;this.now=now;this.epoch=0;this.timers=new Set();this.tasks=new Set();this.suspended=false;
 }
 disarm(task){
  task.arm=null;
  if(task.timer!==null){this.clearTimer(task.timer);this.timers.delete(task.timer);task.timer=null}
 }
 beginRound(){for(const task of this.tasks)this.disarm(task);this.tasks.clear();return++this.epoch}
 arm(task){
  const arm={};task.arm=arm;task.deadline=this.now()+task.remaining;
  task.timer=this.setTimer(()=>{
   if(task.arm!==arm||task.epoch!==this.epoch||this.suspended||!this.tasks.has(task))return;
   this.timers.delete(task.timer);task.timer=null;task.arm=null;this.tasks.delete(task);task.callback();
  },task.remaining);
  this.timers.add(task.timer);
 }
 schedule(delay,callback){
  const task={epoch:this.epoch,callback,remaining:Math.max(0,delay),deadline:0,timer:null,arm:null};
  this.tasks.add(task);if(!this.suspended)this.arm(task);return task;
 }
 suspend(){
  if(this.suspended)return;this.suspended=true;
  for(const task of this.tasks){task.remaining=Math.max(0,task.deadline-this.now());this.disarm(task)}
 }
 resume(){
  if(!this.suspended)return;this.suspended=false;
  for(const task of this.tasks)this.arm(task);
 }
}
