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
