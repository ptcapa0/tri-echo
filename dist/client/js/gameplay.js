export const MODES={
 golf:{label:'Portal Golf',kind:'portal',competitive:false,description:'Conta tacadas até embocar. Sem limite.'},
 classic:{label:'Carambola Clássica',kind:'classic',competitive:false,description:'A branca toca nas outras duas. Sem portal.'},
 hybrid:{label:'Fusion',kind:'hybrid',competitive:false,description:'Completa a carambola e depois emboca.'},
 tour:{label:'Echo Tour',kind:'portal',competitive:true,description:'Seis buracos, par, série e cinco poderes.'},
 daily:{label:'Daily Golf',kind:'portal',competitive:true,description:'A mesma volta diária para todos.'}
};
export const POWERS={
 trace:{icon:'⌁',name:'Traço Longo',description:'Estende a previsão desta tacada.'},
 gravity:{icon:'◉',name:'Lente',description:'Amplia suavemente a atração do portal.'},
 phase:{icon:'◇',name:'Fase',description:'A bola atravessa bumpers nesta tacada.'},
 forge:{icon:'╱',name:'Forja Echo',description:'Grava um Echo Rail mesmo sem vitória.'},
 rewind:{icon:'↶',name:'Rewind',description:'Anula uma tacada falhada.'}
};
export function parForTable(table,difficulty='normal'){
 const obstacleCost=Math.min(2,Math.floor((table.obstacles?.length||0)/2));
 const zoneCost=table.frictionZone?1:0,difficultyCost=difficulty==='hard'?1:0;
 return Math.max(2,Math.min(5,2+obstacleCost+zoneCost+difficultyCost));
}
export function golfTerm(strokes,par){const d=strokes-par;return d<=-2?'EAGLE':d===-1?'BIRDIE':d===0?'PAR':d===1?'BOGEY':`+${d}`}
export function competitivePoints({strokes,par,streak=0,cushions=0,accuracy=0}){
 const underPar=(par-strokes)*140,clean=Math.round(Math.max(0,accuracy)*120),chain=Math.min(400,streak*55);
 return Math.max(100,500+underPar+clean+chain+cushions*20);
}
export function freshPowerInventory(){return Object.fromEntries(Object.keys(POWERS).map(key=>[key,1]))}
