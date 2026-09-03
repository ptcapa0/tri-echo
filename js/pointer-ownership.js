export class GameplayPointerOwner{
 constructor(){this.pointerId=null}
 acquire(pointerId,allowed=true){
  if(!allowed||this.pointerId!==null)return false;
  this.pointerId=pointerId;
  return true;
 }
 owns(pointerId){return this.pointerId!==null&&this.pointerId===pointerId}
 release(pointerId){
  if(!this.owns(pointerId))return false;
  this.pointerId=null;
  return true;
 }
 clear(){const pointerId=this.pointerId;this.pointerId=null;return pointerId}
}
