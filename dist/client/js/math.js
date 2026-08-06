export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const len=(x,y)=>Math.hypot(x,y);
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function mulberry32(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
export function hashString(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
export function segmentClosest(px,py,a,b){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy||1;const t=clamp(((px-a.x)*dx+(py-a.y)*dy)/l,0,1);return{x:a.x+dx*t,y:a.y+dy*t,t}}
