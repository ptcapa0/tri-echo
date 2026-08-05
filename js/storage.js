const KEY='triEchoSaveV1';
const defaults={best:{flow:0,zen:0,precision:0,rush:0,daily:0},bestStreak:0,dailies:[],achievements:[],stats:{shots:0,successes:0,recent:[]},settings:{sound:true,haptics:true,reducedMotion:false},mode:'flow',difficulty:'normal',tutorial:false};
export function loadSave(store=localStorage){try{return merge(JSON.parse(store.getItem(KEY)||'{}'))}catch{return structuredClone(defaults)}}
function merge(v){return{...structuredClone(defaults),...v,best:{...defaults.best,...v.best},stats:{...defaults.stats,...v.stats},settings:{...defaults.settings,...v.settings}}}
export function save(data,store=localStorage){store.setItem(KEY,JSON.stringify(data))}
export function exportSave(data){return new Blob([JSON.stringify(data,null,2)],{type:'application/json'})}
export async function importSave(file){const value=JSON.parse(await file.text());if(!value||typeof value!=='object'||!value.stats)throw Error('Ficheiro inválido');return merge(value)}
export {KEY};
