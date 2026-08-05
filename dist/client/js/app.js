import {clamp,len} from './math.js';
import {generateTable,relocateHole,respawnBall,dailySeed,DIFFICULTY} from './generator.js';
import {Physics,STEP,echoFromPath,shotMetrics,powerFromPull} from './physics.js';
import {loadSave,save,exportSave,importSave} from './storage.js';
import {AudioFX} from './audio.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#game'),ctx=canvas.getContext('2d',{alpha:false});
const audio=new AudioFX();
let data=loadSave(),game=null,acc=0,last=performance.now(),drag=null,particles=[],toastTimer,paused=false;
let contact={x:0,y:0},contactPointer=null;

const MODE_INFO={
 flow:'EMBOCA UMA COR · 3 FALHAS',zen:'EMBOCA UMA COR · SEM PRESSÃO',
 precision:'CUMPRE A CONDIÇÃO',rush:'EMBOCA RÁPIDO · +5s',daily:'DESAFIO DIÁRIO'
};

class Game{
 constructor(){
  this.mode=data.mode;this.difficulty=data.difficulty;this.score=0;this.streak=0;
  this.level=0;this.turn=0;this.failures=0;this.remaining=45;this.shotsLeft=2;
  this.seedBase=this.mode==='daily'?dailySeed():Date.now()>>>0;this.next();
 }
 adaptive(){const r=data.stats.recent||[],rate=r.length?r.filter(Boolean).length/r.length:.5;return rate>.7?2:rate<.35?-1:0}
 challenge(){
  const n=this.level,spin=['follow','draw','side'][n%3];
  if(this.mode==='zen')return{type:'open',label:'EMBOCA DOURADA OU ROSA'};
  if(this.mode==='precision'){
   const set=[
    {type:'target',targetId:n%2?1:2,label:`EMBOCA A ${n%2?'DOURADA':'ROSA'}`},
    {type:'bank',minCushions:2,label:'2 RESSALTOS ANTES DE EMBOCAR'},
    {type:'control',maxPower:.58,label:'FORÇA MÁXIMA 58%'},
    {type:'spin',spinAxis:spin,minSpin:.42,label:`USA EFEITO ${spinLabel(spin)}`}
   ];return set[n%set.length];
  }
  if(this.mode==='daily'){
   const k=(this.seedBase+n)%3;
   return k===0?{type:'target',targetId:(n%2)+1,label:`EMBOCA A BOLA ${(n%2)+1}`}:k===1?{type:'bank',minCushions:1,label:'EMBOCA APÓS 1 RESSALTO'}:{type:'control',maxPower:.72,label:'CONTROLO · FORÇA ATÉ 72%'};
  }
  if(this.mode==='rush'&&n>1&&n%3===0)return{type:'target',targetId:n%2?1:2,label:`RÁPIDO · BOLA ${n%2?1:2}`};
  if(this.mode==='flow'&&n>1&&n%4===0)return{type:'bank',minCushions:1,label:'ECO · USA 1 RESSALTO'};
  return{type:'open',label:'EMBOCA DOURADA OU ROSA'};
 }
 next(){
  const echoes=(this.table?.rails||[]).map(r=>({...r,life:r.life-1})).filter(r=>r.life>0);
  const seed=(this.seedBase+Math.imul(this.level+1,2654435761))>>>0;
  const board=this.mode==='daily'?{w:720,h:1120}:boardDimensions();this.table=generateTable(seed,this.difficulty,this.adaptive(),board.w,board.h);this.table.rails=echoes;
  this.shotProfile=shotMetrics(this.table,DIFFICULTY[this.difficulty].powerScale);
  this.physics=new Physics(this.table);this.shotsLeft=this.mode==='precision'?2:99;
  this.condition=this.challenge();this.level++;this.turn++;updateHUD();
 }
 shoot(vx,vy,powerRatio){
  if(this.physics.active)return;
  this.physics.shoot(vx,vy,contact,powerRatio);data.stats.shots++;
  if(this.mode==='precision')this.shotsLeft--;save(data);updateHUD();
 }
 conditionMet(sunkId){
  const c=this.condition;if(!sunkId)return false;
  if(c.targetId&&sunkId!==c.targetId)return false;
  if(c.minCushions&&this.physics.cushions<c.minCushions)return false;
  if(c.maxPower&&this.physics.shotPower>c.maxPower)return false;
  const spinAmount=Math.hypot(contact.x,contact.y);
  if(c.minSpin&&spinAmount<c.minSpin)return false;
  if(c.spinAxis==='follow'&&contact.y>-.32)return false;
  if(c.spinAxis==='draw'&&contact.y<.32)return false;
  if(c.spinAxis==='side'&&Math.abs(contact.x)<.38)return false;
  return true;
 }
 finish(){
  const sunkId=this.physics.pocketed[0]??null,scratch=sunkId===0;
  const ok=!scratch&&this.conditionMet(sunkId);
  record(ok);
  if(ok){
   this.streak++;const mult=1+Math.min(4,Math.floor(this.streak/3));
   const challengeBonus=this.condition.type==='open'?0:75;
   const bonus=100*mult+this.physics.cushions*15+challengeBonus;this.score+=bonus;
   if(this.mode==='rush')this.remaining=Math.min(60,this.remaining+5);
   const rail=echoFromPath(this.physics.path);if(rail){this.table.rails.push(rail);while(this.table.rails.length>DIFFICULTY[this.difficulty].rails)this.table.rails.shift()}
   audio.success();buzz([18,35,18]);burst(this.table.hole.x,this.table.hole.y,sunkId===1?'#ffca68':'#ff6d9e');
   showToast(`PORTAL +${bonus}`);unlock();
   if(this.mode==='zen')this.continueZen(sunkId,true);else setTimeout(()=>this.next(),650);
  }else{
   this.streak=0;this.failures+=(this.mode==='zen'||this.difficulty==='relaxed')?0:1;audio.fail();buzz(30);
   showToast(scratch?'FALTA · BRANCA NO PORTAL':sunkId?'CONDIÇÃO FALHOU':'NÃO EMBOCOU');
   if(this.mode==='zen')this.continueZen(sunkId,false);
   else if(this.difficulty==='relaxed')setTimeout(()=>this.resetPositions(),650);
   else if(this.mode==='precision'&&this.shotsLeft>0)setTimeout(()=>this.resetPositions(),650);
   else if((this.mode==='flow'||this.mode==='daily'||this.mode==='rush')&&this.failures<DIFFICULTY[this.difficulty].lives)setTimeout(()=>this.next(),650);
   else setTimeout(()=>endGame(),750);
  }
  updateHUD();
 }
 continueZen(sunkId,won){
  const advance=()=>{
   if(sunkId!==null)respawnBall(this.table,this.table.balls[sunkId],(this.seedBase+this.turn*7919+sunkId)>>>0);
   if(won)relocateHole(this.table,(this.seedBase+this.turn*104729)>>>0,DIFFICULTY[this.difficulty].pocket);
   this.physics=new Physics(this.table);this.turn++;this.level++;this.condition=this.challenge();updateHUD();
  };
  if(data.settings.reducedMotion)advance();else setTimeout(advance,260);
 }
 resetPositions(){for(const b of this.table.balls){if(b.pocketed)respawnBall(this.table,b,(this.seedBase+this.turn*3571+b.id)>>>0);b.vx=0;b.vy=0;b.spinX=0;b.spinY=0}this.physics=new Physics(this.table);updateHUD()}
}

function record(ok){data.stats.successes+=ok?1:0;data.stats.recent=[...(data.stats.recent||[]),ok].slice(-12);if(game.mode==='daily'&&ok){const d=new Date().toISOString().slice(0,10);if(!data.dailies.includes(d))data.dailies.push(d)}save(data)}
function boardDimensions(){const r=$('#stage').getBoundingClientRect();return{w:720,h:clamp(720*r.height/Math.max(1,r.width),620,1440)}}
function unlock(){if(game.streak>=3)addAchievement('Portal Triplo','Emboca 3 vezes seguidas');if(game.physics.cushions>=3)addAchievement('Geómetra','Emboca após 3 ressaltos');if(data.stats.successes>=25)addAchievement('Ressonância','Completa 25 desafios')}
function addAchievement(id,desc){if(data.achievements.some(a=>a.id===id))return;data.achievements.push({id,desc,date:new Date().toISOString()});save(data);showToast(`CONQUISTA · ${id}`)}
function resize(){const r=$('#stage').getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);canvas.style.width=`${r.width}px`;canvas.style.height=`${r.height}px`;ctx.setTransform(dpr,0,0,dpr,0,0)}
function map(e){const r=canvas.getBoundingClientRect(),t=game.table;return{x:(e.clientX-r.left)/r.width*t.w,y:(e.clientY-r.top)/r.height*t.h}}
function down(e){if(!game||game.physics.active||paused)return;audio.unlock();const p=map(e),b=game.table.balls[0];if(Math.hypot(p.x-b.x,p.y-b.y)<95){drag={start:{x:b.x,y:b.y},p,id:e.pointerId,maxed:false};canvas.setPointerCapture(e.pointerId);if(!data.tutorial)coach(1)}}
function move(e){if(!drag||e.pointerId!==drag.id)return;drag.p=map(e);const d=Math.hypot(drag.start.x-drag.p.x,drag.start.y-drag.p.y),power=powerFromPull(d,game.shotProfile);if(power.ratio===1&&!drag.maxed){drag.maxed=true;buzz(8);audio.tone(520,.035,'sine',.025)}else if(power.ratio<.96)drag.maxed=false}
function up(e){if(!drag||e.pointerId!==drag.id)return;const dx=drag.start.x-drag.p.x,dy=drag.start.y-drag.p.y,d=Math.hypot(dx,dy),power=powerFromPull(d,game.shotProfile);drag=null;if(!power.speed)return;game.shoot(dx/d*power.speed,dy/d*power.speed,power.ratio);audio.hit(power.ratio);if(!data.tutorial){coach(3);data.tutorial=true;save(data);setTimeout(()=>$('#tutorial').classList.add('hidden'),2300)}}

function setContact(e){
 const face=$('#cueFace'),r=face.getBoundingClientRect(),radius=r.width*.37;
 contact.x=clamp((e.clientX-(r.left+r.width/2))/radius,-1,1);contact.y=clamp((e.clientY-(r.top+r.height/2))/radius,-1,1);
 const m=Math.hypot(contact.x,contact.y);if(m>1){contact.x/=m;contact.y/=m}updateContactUI();
 if(!data.tutorial)coach(2);
}
function contactDown(e){if(!game||game.physics.active||paused)return;e.preventDefault();e.stopPropagation();audio.unlock();contactPointer=e.pointerId;$('#cueFace').setPointerCapture(e.pointerId);setContact(e);buzz(5)}
function contactMove(e){if(e.pointerId===contactPointer)setContact(e)}
function contactUp(e){if(e.pointerId===contactPointer)contactPointer=null}
function updateContactUI(){
 $('#contactDot').style.transform=`translate(calc(-50% + ${contact.x*30}px),calc(-50% + ${contact.y*30}px))`;
 let label='CENTRO';if(Math.hypot(contact.x,contact.y)>.2){const v=contact.y<-.35?'SEGUIR':contact.y>.35?'RECUO':'';const h=contact.x<-.35?'ESQUERDA':contact.x>.35?'DIREITA':'';label=[v,h].filter(Boolean).join(' + ')||'EFEITO'}$('#spinLabel').textContent=label;
}
function spinLabel(axis){return axis==='follow'?'SEGUIR':axis==='draw'?'RECUO':'LATERAL'}
function coach(n){const titles=['','APONTAR + FORÇA','PONTO DE IMPACTO','EMBOCA UMA COR'];const text=['','Arrasta a partir da branca e puxa para trás','Move o ponto no controlo circular para dar efeito','Dourada ou rosa no portal completa a jogada'];$('#coachTitle').textContent=titles[n];$('#coachText').textContent=text[n];$('#tutorial').classList.remove('hidden')}

function update(dt){
 if(paused||!game)return;
 if(game.mode==='rush'){game.remaining-=dt;$('#status').textContent=Math.max(0,Math.ceil(game.remaining));if(game.remaining<=0){game.remaining=0;endGame();return}}
 if(game.physics.active){acc+=dt;let n=0;while(acc>=STEP&&n++<18){if(game.physics.step(STEP)){game.finish();acc=0;break}acc-=STEP}}
 for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt}particles=particles.filter(p=>p.life>0);
}
function render(){
 if(!game)return;const W=canvas.clientWidth,H=canvas.clientHeight,sx=W/game.table.w,sy=H/game.table.h,dpr=Math.min(2,devicePixelRatio||1);
 ctx.setTransform(dpr*sx,0,0,dpr*sy,0,0);const t=game.table;
 ctx.fillStyle='#071a21';ctx.fillRect(0,0,t.w,t.h);ctx.strokeStyle='#31535a';ctx.lineWidth=4;ctx.strokeRect(t.bounds.l,t.bounds.t,t.bounds.r-t.bounds.l,t.bounds.b-t.bounds.t);
 ctx.globalAlpha=.12;ctx.strokeStyle='#5cf3dc';ctx.lineWidth=1;for(let y=120;y<t.h;y+=120){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(t.w,y);ctx.stroke()}ctx.globalAlpha=1;
 drawHole(t.hole);
 if(t.frictionZone){ctx.fillStyle=t.frictionZone.factor>1?'#ffca6815':'#5cf3dc12';ctx.strokeStyle=t.frictionZone.factor>1?'#ffca6860':'#5cf3dc60';roundRect(t.frictionZone.x,t.frictionZone.y,t.frictionZone.w,t.frictionZone.h,18,true,true);ctx.fillStyle='#9ab1b3';ctx.font='18px system-ui';ctx.fillText(t.frictionZone.factor>1?'SLOW':'GLIDE',t.frictionZone.x+12,t.frictionZone.y+27)}
 for(const r of t.rails){ctx.strokeStyle='#5cf3dc88';ctx.shadowColor='#5cf3dc';ctx.shadowBlur=14;ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(r.a.x,r.a.y);ctx.lineTo(r.b.x,r.b.y);ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#cafff0aa';ctx.lineWidth=2;ctx.stroke()}
 for(const o of t.obstacles){ctx.fillStyle='#172e37';ctx.strokeStyle='#ffca68';ctx.lineWidth=4;ctx.beginPath();ctx.arc(o.x,o.y,o.r,0,Math.PI*2);ctx.fill();ctx.stroke()}
 if(drag)drawAim(t);
 const colors=['#ecffff','#ffca68','#ff6d9e'];for(const b of t.balls){if(b.pocketed)continue;ctx.shadowColor=colors[b.id];ctx.shadowBlur=18;const g=ctx.createRadialGradient(b.x-6,b.y-8,2,b.x,b.y,b.r);g.addColorStop(0,'#fff');g.addColorStop(.22,colors[b.id]);g.addColorStop(1,'#16303a');ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;if(b.id){ctx.fillStyle='#071a21';ctx.font='bold 14px system-ui';ctx.textAlign='center';ctx.fillText(String(b.id),b.x,b.y+5);ctx.textAlign='left'}}
 for(const p of particles){ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.c;ctx.fillRect(p.x,p.y,5,5)}ctx.globalAlpha=1;
}
function drawHole(h){if(!h)return;const pulse=data.settings.reducedMotion?0:Math.sin(performance.now()/280)*3;ctx.save();ctx.shadowColor='#5cf3dc';ctx.shadowBlur=18+pulse;ctx.strokeStyle='#78ffe7';ctx.lineWidth=4;ctx.fillStyle='#010507';ctx.beginPath();ctx.arc(h.x,h.y,h.r+pulse*.2,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#ffffff44';ctx.lineWidth=2;ctx.beginPath();ctx.arc(h.x,h.y,h.r*.64,0,Math.PI*2);ctx.stroke();ctx.restore()}
function drawAim(t){const b=t.balls[0],dx=b.x-drag.p.x,dy=b.y-drag.p.y,d=Math.hypot(dx,dy)||1,power=powerFromPull(d,game.shotProfile),pow=power.ratio,preview=DIFFICULTY[game.difficulty].preview;ctx.setLineDash([12,10]);ctx.strokeStyle='#efffffaa';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x+dx/d*(210+170*pow)*preview,b.y+dy/d*(210+170*pow)*preview);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle=pow>.82?'#ffca68':'#5cf3dc';ctx.lineWidth=7;ctx.beginPath();ctx.arc(b.x,b.y,b.r+14,-Math.PI/2,-Math.PI/2+Math.PI*2*pow);ctx.stroke();ctx.fillStyle='#efffff';ctx.font='bold 16px system-ui';ctx.textAlign='center';ctx.fillText(pow===1?'MAX':`${Math.round(pow*100)}%`,b.x,b.y-b.r-24);ctx.textAlign='left'}
function roundRect(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill)ctx.fill();if(stroke)ctx.stroke()}
function burst(x,y,c){if(data.settings.reducedMotion)return;for(let i=0;i<22;i++){const a=Math.random()*Math.PI*2,s=50+Math.random()*140;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.5+Math.random()*.4,c})}}
function loop(now){const dt=Math.min(.05,(now-last)/1000);last=now;update(dt);render();requestAnimationFrame(loop)}
function buzz(pattern){if(data.settings.haptics&&navigator.vibrate)navigator.vibrate(pattern)}
function showToast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),900)}
function updateHUD(){if(!game)return;$('#score').textContent=game.score;$('#streak').textContent=game.streak;let label='VIDAS',value='●'.repeat(Math.max(0,DIFFICULTY[game.difficulty].lives-game.failures));if(game.mode==='zen'){label='PORTAIS';value=game.streak}if(game.mode==='precision'){label='JOGADAS';value=game.shotsLeft}if(game.mode==='rush'){label='TEMPO';value=Math.ceil(game.remaining)}$('#statusLabel').textContent=label;$('#status').textContent=value;$('#objective').textContent=game.condition?.label||MODE_INFO[game.mode]}
function start(){data.mode=$('#mode').value;data.difficulty=$('#difficulty').value;save(data);contact={x:0,y:0};updateContactUI();game=new Game();$('#contactControl').classList.remove('hidden');$('#menu').close();paused=false;if(!data.tutorial)coach(1)}
function endGame(){if(!game)return;const m=game.mode;data.best[m]=Math.max(data.best[m]||0,game.score);data.bestStreak=Math.max(data.bestStreak,game.streak);save(data);showToast(`FIM · ${game.score}`);setTimeout(()=>{$('#contactControl').classList.add('hidden');$('#menu').showModal();paused=true},700)}
function openSettings(){paused=true;audio.enabled=data.settings.sound;$('#sound').checked=data.settings.sound;$('#haptics').checked=data.settings.haptics;$('#reduced').checked=data.settings.reducedMotion;$('#settings').showModal()}

canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',()=>drag=null);
$('#cueFace').addEventListener('pointerdown',contactDown);$('#cueFace').addEventListener('pointermove',contactMove);$('#cueFace').addEventListener('pointerup',contactUp);$('#cueFace').addEventListener('pointercancel',contactUp);$('#cueFace').addEventListener('dblclick',()=>{contact={x:0,y:0};updateContactUI()});
window.addEventListener('resize',resize);$('#playBtn').onclick=start;$('#settingsBtn').onclick=openSettings;$('#openSettings').onclick=openSettings;$('#homeBtn').onclick=()=>{paused=true;$('#contactControl').classList.add('hidden');$('#menu').showModal()};$('#retryBtn').onclick=()=>game&&!game.physics.active&&game.next();
for(const b of document.querySelectorAll('dialog .close'))b.onclick=()=>{b.closest('dialog').close();paused=$('#menu').open};
$('#mode').value=data.mode;$('#difficulty').value=data.difficulty;
$('#progressBtn').onclick=()=>{const a=data.achievements.map(x=>`✓ ${x.id}`).join('<br>')||'Ainda sem conquistas';$('#stats').innerHTML=`Jogadas: ${data.stats.shots}<br>Desafios: ${data.stats.successes}<br>Melhor série: ${data.bestStreak}<hr>${a}`;$('#progress').showModal()};
$('#tutorialBtn').onclick=()=>{data.tutorial=false;save(data);$('#settings').close();paused=false;coach(1)};
$('#sound').onchange=e=>{data.settings.sound=e.target.checked;audio.enabled=e.target.checked;save(data)};$('#haptics').onchange=e=>{data.settings.haptics=e.target.checked;save(data)};$('#reduced').onchange=e=>{data.settings.reducedMotion=e.target.checked;save(data)};
$('#exportBtn').onclick=()=>{const u=URL.createObjectURL(exportSave(data)),a=document.createElement('a');a.href=u;a.download='tri-echo-progress.json';a.click();URL.revokeObjectURL(u)};
$('#importFile').onchange=async e=>{try{data=await importSave(e.target.files[0]);save(data);showToast('PROGRESSO IMPORTADO')}catch{showToast('FICHEIRO INVÁLIDO')}};
window.__TRI_ECHO__={state:()=>game&&({active:game.physics.active,score:game.score,cue:{x:game.table.balls[0].x/game.table.w,y:game.table.balls[0].y/game.table.h},hole:{x:game.table.hole.x/game.table.w,y:game.table.hole.y/game.table.h,r:game.table.hole.r},contact:{...contact},cueSpeed:len(game.table.balls[0].vx,game.table.balls[0].vy),maxSpeed:game.shotProfile.maxSpeed,fullPull:game.shotProfile.fullPull,guaranteedPath:game.shotProfile.guaranteedPath,distanceTravelled:game.physics.distanceTravelled,cushions:game.physics.cushions,pocketed:[...game.physics.pocketed],rails:game.table.rails.length,condition:game.condition})};
document.addEventListener('visibilitychange',()=>paused=document.hidden||$('#menu').open||$('#settings').open||$('#progress').open);if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));resize();updateContactUI();$('#menu').showModal();paused=true;requestAnimationFrame(loop);
