export const MODES={
 golf:{label:'Table Golf',kind:'portal',competitive:false,tableChoice:true,description:'Conta tacadas até embocar. Escolhe portal móvel ou seis bolsas.'},
 classic:{label:'Bilhar de 3 bolas',kind:'classic',competitive:false,tableChoice:true,description:'A branca toca nas outras duas; em mesa snooker, as bolsas também contam.'},
 hybrid:{label:'Fusion',kind:'hybrid',competitive:false,tableChoice:true,description:'Completa a carambola e depois emboca.'},
 tour:{label:'Echo Tour',kind:'portal',competitive:true,tableChoice:true,description:'Seis desafios, par, série e cinco poderes.'},
 daily:{label:'Daily Golf',kind:'portal',competitive:true,tableChoice:true,description:'A mesma volta diária para todos.'},
 american:{label:'Pool americano · 8-ball',kind:'american',competitive:false,tableChoice:false,description:'15 bolas: limpa o teu grupo e termina na bola 8.'},
 british:{label:'Snooker britânico',kind:'british',competitive:false,tableChoice:false,description:'15 vermelhas e seis cores na sequência tradicional.'},
 trick:{label:'Trick Shot',kind:'trick',competitive:true,tableChoice:false,description:'Completa uma jogada artística com o menor número de tentativas.'},
 training:{label:'Treino',kind:'training',competitive:false,tableChoice:false,description:'Treino sem penalização para Table Golf, 3 bolas ou Snooker.'}
};
export const TABLE_STYLES={echo:{label:'Mesa Echo · portal móvel'},snooker:{label:'Mesa Snooker · 6 bolsas'}};
export const TRAINING_DISCIPLINES={golf:'Table Golf',classic:'Bilhar de 3 bolas',snooker:'Snooker'};
export const TRICK_SHOTS=[
 {id:'bank',name:'Tabela vencedora',hint:'Emboca uma bola depois de ela tocar numa tabela.',requirement:'bank'},
 {id:'kick',name:'Kick Shot',hint:'A branca toca numa tabela antes da primeira bola.',requirement:'kick'},
 {id:'combo',name:'Combinação',hint:'Faz uma bola empurrar outra para uma bolsa.',requirement:'combo'},
 {id:'follow',name:'Seguimento',hint:'Emboca usando impacto acima do centro.',requirement:'follow'},
 {id:'draw',name:'Recuo',hint:'Emboca usando impacto abaixo do centro.',requirement:'draw'},
 {id:'carom',name:'Duplo beijo',hint:'Faz a branca tocar nas duas bolas numa tacada.',requirement:'carom'}
];
export const POWERS={
 trace:{icon:'⌁',name:'Traço Longo',description:'Estende a previsão desta tacada.'},
 gravity:{icon:'◉',name:'Lente',description:'Amplia suavemente a atração da bolsa ou portal.'},
 phase:{icon:'◇',name:'Fase',description:'A bola atravessa bumpers nesta tacada.'},
 forge:{icon:'╱',name:'Forja Echo',description:'Grava um Echo Rail mesmo sem vitória.'},
 rewind:{icon:'↶',name:'Rewind',description:'Anula uma tacada falhada.'}
};
export function parForTable(table,difficulty='normal'){
 const obstacleCost=Math.min(2,Math.floor((table.obstacles?.length||0)/2));
 const zoneCost=table.frictionZone?1:0,difficultyCost=difficulty==='hard'?1:0;
 return Math.max(2,Math.min(6,2+obstacleCost+zoneCost+difficultyCost+(table.tableStyle==='snooker'?1:0)));
}
export function golfTerm(strokes,par){const d=strokes-par;return d<=-2?'EAGLE':d===-1?'BIRDIE':d===0?'PAR':d===1?'BOGEY':`+${d}`}
export function competitivePoints({strokes,par,streak=0,cushions=0,accuracy=0}){
 const underPar=(par-strokes)*140,clean=Math.round(Math.max(0,accuracy)*120),chain=Math.min(400,streak*55);
 return Math.max(100,500+underPar+clean+chain+cushions*20);
}
export function trickPoints(attempts){return Math.max(100,1200-(attempts-1)*140)}
export function freshPowerInventory(){return Object.fromEntries(Object.keys(POWERS).map(key=>[key,1]))}
export function evaluateTrick(trick,physics,contact){
 const coloured=physics.pocketed.some(id=>id>0),carom=physics.contacts.size>=2;
 if(trick.requirement==='bank')return coloured&&physics.objectCushions>0;
 if(trick.requirement==='kick')return coloured&&physics.cueCushionsBeforeContact>0;
 if(trick.requirement==='combo')return coloured&&physics.objectContacts>0;
 if(trick.requirement==='follow')return coloured&&contact.y<-.35;
 if(trick.requirement==='draw')return coloured&&contact.y>.35;
 return carom;
}
