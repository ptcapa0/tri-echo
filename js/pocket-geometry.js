import {segmentClosest} from './math.js';

// Design ratios in ball diameters, independent of difficulty and shot energy.
// Mouths admit roughly two balls; throats admit one ball plus clearance.
export const POCKET_PROFILES=Object.freeze({
 american:Object.freeze({corner:2.2,side:2.4,throat:1.4}),
 snooker:Object.freeze({corner:2,side:2.15,throat:1.25}),
 classic:Object.freeze({corner:2.1,side:2.3,throat:1.35})
});
export function pocketPoint(p,lateral,depth){
 return{x:p.mouth.x+p.tangent.x*lateral+p.outward.x*depth,y:p.mouth.y+p.tangent.y*lateral+p.outward.y*depth};
}
export function pocketCoordinates(p,b){
 const dx=b.x-p.mouth.x,dy=b.y-p.mouth.y;
 return{lateral:dx*p.tangent.x+dy*p.tangent.y,depth:dx*p.outward.x+dy*p.outward.y};
}
export function createPocketGeometry(bounds,diameter,profileName='classic'){
 const profile=POCKET_PROFILES[profileName];if(!profile)throw new RangeError(`Unknown pocket profile: ${profileName}`);
 const {l,r,t,b}=bounds,m=(t+b)/2,cornerCut=profile.corner*diameter/Math.SQRT2;
 const pockets=[],segments=[],radius=diameter*.06;
 const add=(a,b,part,pocketId=null,side=0)=>segments.push({a,b,radius,box:{l:Math.min(a.x,b.x)-radius,r:Math.max(a.x,b.x)+radius,t:Math.min(a.y,b.y)-radius,b:Math.max(a.y,b.y)+radius},part,pocketId,contactId:pocketId===null?`cushion:${segments.length}`:`pocket:${pocketId}:${side}`});
 function pocket(type,x,y,nx,ny){
  const width=profile[type]*diameter,throatWidth=profile.throat*diameter;
  // Corner shelf must extend beyond the original corner, not end on the cloth.
  const captureDepth=(type==='corner'?width/2+diameter*.6:diameter*.85);
  const p={id:pockets.length,type,mouth:{x,y},outward:{x:nx,y:ny},tangent:{x:-ny,y:nx},width,throatWidth,captureDepth,shelfDepth:captureDepth-diameter*.25,radius};
  const back=captureDepth+diameter; // Enclosed fail-safe behind the capture boundary.
  p.outline=[pocketPoint(p,-width/2,0),pocketPoint(p,width/2,0),pocketPoint(p,throatWidth/2,p.shelfDepth),pocketPoint(p,throatWidth/2,back),pocketPoint(p,-throatWidth/2,back),pocketPoint(p,-throatWidth/2,p.shelfDepth)];
  Object.assign(p,pocketPoint(p,0,captureDepth),{r:throatWidth/2});
  for(const side of [-1,1]){
   add(pocketPoint(p,side*width/2,0),pocketPoint(p,side*throatWidth/2,p.shelfDepth),'jaw',p.id,side);
   add(pocketPoint(p,side*throatWidth/2,p.shelfDepth),pocketPoint(p,side*throatWidth/2,back),'throat',p.id,side);
  }
  add(pocketPoint(p,-throatWidth/2,back),pocketPoint(p,throatWidth/2,back),'back',p.id,0);
  pockets.push(p);
 }
 const q=1/Math.SQRT2,c=cornerCut;
 pocket('corner',l+c/2,t+c/2,-q,-q);pocket('corner',r-c/2,t+c/2,q,-q);
 pocket('side',l,m,-1,0);pocket('side',r,m,1,0);
 pocket('corner',l+c/2,b-c/2,-q,q);pocket('corner',r-c/2,b-c/2,q,q);
 const s=profile.side*diameter/2;
 add({x:l+c,y:t},{x:r-c,y:t},'cushion');add({x:l+c,y:b},{x:r-c,y:b},'cushion');
 for(const x of [l,r]){add({x,y:t+c},{x,y:m-s},'cushion');add({x,y:m+s},{x,y:b-c},'cushion')}
 return{profile:profileName,diameter,pockets,segments};
}

// Only actual motion through the mouth authorizes capture. Position correction
// and spawning inside a shelf cannot manufacture a pot.
export function crossedPocketMouth(p,from,to,ballRadius){
 const a=pocketCoordinates(p,from),b=pocketCoordinates(p,to);
 if(a.depth>0||b.depth<=0)return false;
 const fraction=-a.depth/(b.depth-a.depth),lateral=a.lateral+(b.lateral-a.lateral)*fraction;
 return Math.abs(lateral)<=p.width/2-p.radius-ballRadius;
}
export function inPocketCapture(p,b){
 const c=pocketCoordinates(p,b);
 return c.depth>=p.captureDepth&&Math.abs(c.lateral)<=p.throatWidth/2-p.radius-b.r+1e-7;
}
export function safeFromPocketGeometry(geometry,position,ballRadius){
 if(!geometry)return true;
 for(const p of geometry.pockets){const c=pocketCoordinates(p,position);if(c.depth>-ballRadius&&Math.abs(c.lateral)<p.width/2+ballRadius)return false}
 return geometry.segments.every(s=>{const q=segmentClosest(position.x,position.y,s.a,s.b);return Math.hypot(position.x-q.x,position.y-q.y)>=ballRadius+s.radius});
}
