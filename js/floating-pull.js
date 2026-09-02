import {mapPullToPower} from './physics-calibration.js';

export function deriveFloatingPull({originScreen,currentScreen,gestureProfile,worldScale={x:1,y:1}}){
 const pullX=currentScreen.x-originScreen.x,pullY=currentScreen.y-originScreen.y;
 const distanceCss=Math.hypot(pullX,pullY);
 const power=mapPullToPower(distanceCss,gestureProfile);
 const shotX=-pullX*worldScale.x,shotY=-pullY*worldScale.y;
 const directionLength=Math.hypot(shotX,shotY);
 return{
  distanceCss,
  normalizedPull:power.effectivePull,
  normalizedPower:power.normalizedPower,
  speed:power.speed,
  shotDirection:directionLength?{x:shotX/directionLength,y:shotY/directionLength}:{x:0,y:0}
 };
}
