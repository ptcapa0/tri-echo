import {clamp,len} from './math.js';
import {generateTable,respawnBall,respotBall,dailySeed,DIFFICULTY} from './generator.js';
import {Physics,STEP,echoFromPath,shotMetrics,powerFromPull} from './physics.js';
import {MODES,TABLE_STYLES,TRAINING_DISCIPLINES,TRICK_SHOTS,POWERS,parForTable,golfTerm,competitivePoints,trickPoints,freshPowerInventory,evaluateTrick} from './gameplay.js';
import {loadSave,save,exportSave,importSave} from './storage.js';
import {AudioFX} from './audio.js';

const $=s=>document.querySelector(s),canvas=$('#game'),ctx=canvas.getContext('2d',{alpha:false}),audio=new AudioFX();
let data=loadSave(),game=null,acc=0,last=performance.now(),drag=null,particles=[],toastTimer,paused=true;
let contact={x:0,y:0},contactPointer=null,movePointer=null,controlPos=data.settings.contactPos||{x:.76,y:.02};

class Game{
 constructor(){this.mode=data.mode in MODES?data.mode:'golf';this.info=MODES[this.mode];this.difficulty=data.difficulty;this.tableStyle=this.info.tableChoice?(data.tableStyle||'echo'):'snooker';this.trainingDiscipline=data.trainingDiscipline||'golf';this.trickDiscipline=data.trickDiscipline||'golf';this.seedBase=this.mode==='daily'?dailySeed():Date.now()>>>0;this.holeIndex=0;this.strokes=0;this.totalStrokes=0;this.totalPar=0;this.score=0;this.streak=0;this.results=[];this.inventory=freshPowerInventory();this.activePower=null;this.ruleState={phase:'open',reds:15,colourIndex:0};this.newHole()}
 adaptive(){const r=data.stats.recent||[],rate=r.length?r.filter(Boolean).length/r.length:.5;return rate>.72?2:rate<.34?-1:0}
 newHole(){
  const echoes=(this.table?.rails||[]).map(r=>({...r,life:r.life-1})).filter(r=>r.life>0),seed=(this.seedBase+Math.imul(this.holeIndex+1,2654435761))>>>0;
  const dims=this.mode==='daily'?{w:720,h:1120}:boardDimensions();
  let ballSet=this.info.kind==='american'?'american':this.info.kind==='british'?'british':'three',tableStyle=this.tableStyle;
  if(this.info.kind==='trick'){tableStyle='snooker';ballSet=this.trickDiscipline==='american'?'american':this.trickDiscipline==='british'?'british':'three'}
  if(this.info.kind==='training'){tableStyle=this.trainingDiscipline==='golf'?'echo':'snooker';ballSet=this.trainingDiscipline==='snooker'?'british':'three'}
  this.table=generateTable(seed,this.difficulty,this.adaptive(),dims.w,dims.h,{tableStyle,ballSet});this.table.rails=echoes;
  if(this.info.kind==='american')this.ruleState={group:null,phase:'open'};
  if(this.info.kind==='british')this.ruleState={phase:'red',colourIndex:0};
  if(this.info.kind==='classic'&&tableStyle==='echo')this.table.hole=null;
  this.trick=this.info.kind==='trick'?TRICK_SHOTS[this.holeIndex%TRICK_SHOTS.length]:null;
  this.hybridPhase=this.info.kind==='hybrid'?'carom':null;if(this.info.kind==='hybrid'&&this.table.hole)this.table.hole.disabled=true;this.par=this.info.kind==='classic'?1:parForTable(this.table,this.difficulty);this.strokes=0;
  this.shotProfile=shotMetrics(this.table,DIFFICULTY[this.difficulty].powerScale);this.physics=new Physics(this.table);this.holeStart=structuredClone(this.table);this.activePower=null;renderPowers();updateHUD();
 }
 shoot(vx,vy,powerRatio){
  if(this.physics.active)return;this.preShot=structuredClone(this.table);this.strokes++;this.totalStrokes++;data.stats.shots++;
  const modifiers={gravity:this.activePower==='gravity',phase:this.activePower==='phase'};this.physics.shoot(vx,vy,contact,powerRatio,modifiers);save(data);updateHUD();
 }
  finish(){
  const sunk=this.physics.pocketed[0]??null,scratch=sunk===0,carom=this.physics.contacts.size===2;
  const forged=this.activePower==='forge';if((forged||carom||(!scratch&&sunk))){const rail=echoFromPath(this.physics.path);if(rail){this.table.rails.push(rail);while(this.table.rails.length>DIFFICULTY[this.difficulty].rails)this.table.rails.shift()}}
  if(this.activePower&&this.activePower!=='rewind'){this.inventory[this.activePower]=0;this.activePower=null;renderPowers()}
  if(this.info.kind==='american'||this.info.kind==='british')return this.finishCueSport(scratch);
  if(this.info.kind==='trick')return this.finishTrick();
  if(this.info.kind==='training')return this.finishTraining(scratch,carom);
  if(this.info.kind==='classic')return this.finishClassic(carom);
  if(this.info.kind==='hybrid'&&this.hybridPhase==='carom'){
   if(carom){this.hybridPhase='pocket';if(this.table.hole)this.table.hole.disabled=false;this.streak++;audio.success();buzz([15,25,15]);showToast('FASE 2 · BOLSA');this.safeReset(sunk)}
   else this.handleMiss(sunk,'FALTA CARAMBOLA');return;
  }
  if(!scratch&&sunk>0)return this.completeHole();
  this.handleMiss(sunk,scratch?'FALTA · BRANCA':'CONTINUA');
 }
 finishTraining(scratch,carom){
  const success=this.trainingDiscipline==='classic'?carom:this.physics.pocketed.some(id=>id>0);
  if(success){this.score++;audio.success();showToast('CERTO · CONTINUA A TREINAR')}else showToast(scratch?'BRANCA · REPÕE':'AJUSTA E REPETE');
  for(const id of this.physics.pocketed){const b=this.table.balls.find(x=>x.id===id);if(b)respawnBall(this.table,b,this.seedBase+this.totalStrokes*71+id)}
  this.safeReset(null);updateHUD();
 }
 finishTrick(){
  const ok=evaluateTrick(this.trick,this.physics,contact);record(ok);
  if(ok){this.score+=trickPoints(this.strokes);this.streak++;audio.success();buzz([18,30,18]);showToast(`${this.trick.name.toUpperCase()} · ${this.strokes} TENT.`);this.holeIndex++;setTimeout(()=>this.newHole(),700)}
  else{showToast('AINDA NÃO · REPETE');this.table=structuredClone(this.holeStart);this.physics=new Physics(this.table);updateHUD()}
 }
 finishCueSport(scratch){
  const sunk=this.physics.pocketed.filter(id=>id>0),cue=this.table.balls[0];
  if(this.info.kind==='american'){
   let points=0,foul=scratch;const first=this.table.balls.find(x=>x.id===this.physics.firstCollision);
   if(!this.ruleState.group){const claimed=sunk.map(id=>this.table.balls.find(x=>x.id===id)).find(b=>b.role==='solid'||b.role==='stripe');if(claimed)this.ruleState.group=claimed.role}
   const group=this.ruleState.group;if(group&&first&&first.role!==group&&!(first.role==='eight'&&this.table.balls.filter(x=>x.role===group).every(x=>x.pocketed)))foul=true;
   for(const id of sunk){const b=this.table.balls.find(x=>x.id===id);if(b.role==='eight'){const cleared=group&&this.table.balls.filter(x=>x.role===group).every(x=>x.pocketed);if(cleared&&!scratch){showToast('8-BALL · MESA LIMPA');this.score+=8;return setTimeout(()=>this.newHole(),900)}foul=true;respotBall(this.table,b)}else if(!group||b.role===group)points++;else{foul=true;respotBall(this.table,b)}}
   this.score+=points;if(foul){respawnBall(this.table,cue,this.seedBase+this.totalStrokes*97);showToast('FALTA · BOLA NA MÃO')}else showToast(points?`+${points} BOLA${points>1?'S':''}`:'SEM BOLA');
  }else{
   let points=0,foul=scratch;const first=this.table.balls.find(x=>x.id===this.physics.firstCollision),reds=this.table.balls.filter(x=>x.role==='red'),redsRemain=reds.some(x=>!x.pocketed);
   const colours=['yellow','green','brown','blue','pink','black'],expected=this.ruleState.phase==='colours'?colours[this.ruleState.colourIndex]:this.ruleState.phase;
   if(first&&(expected==='red'?first.role!=='red':expected==='color'?first.role==='red':first.role!==expected))foul=true;
   const sunkBalls=sunk.map(id=>this.table.balls.find(x=>x.id===id));
   if(expected==='red'){
    const legal=sunkBalls.filter(b=>b.role==='red');points=legal.length;for(const b of sunkBalls.filter(b=>b.role!=='red')){foul=true;respotBall(this.table,b)}if(legal.length)this.ruleState.phase='color';
   }else if(expected==='color'){
    const legal=sunkBalls.filter(b=>b.role!=='red');if(legal.length){points=Math.max(...legal.map(b=>b.value));for(const b of legal)respotBall(this.table,b);this.ruleState.phase=redsRemain?'red':'colours';this.ruleState.colourIndex=0}for(const b of sunkBalls.filter(b=>b.role==='red'))foul=true;
   }else{
    const legal=sunkBalls.find(b=>b.role===expected);if(legal){points=legal.value;this.ruleState.colourIndex++;}for(const b of sunkBalls.filter(b=>b!==legal)){foul=true;if(b.role!=='red')respotBall(this.table,b)}
   }
   if(foul)points=0;this.score+=points;if(foul){respawnBall(this.table,cue,this.seedBase+this.totalStrokes*101);showToast('FALTA · SEM PONTOS')}else showToast(points?`BREAK +${points}`:'SEM PONTOS');
   if(this.table.balls.slice(1).every(x=>x.pocketed)){showToast(`FRAME · ${this.score} PONTOS`);return setTimeout(()=>this.newHole(),1000)}
  }
  this.safeReset(null);updateHUD();
 }
 finishClassic(ok){
  record(ok);if(ok){this.streak++;this.score++;audio.success();buzz([18,30,18]);showToast(`3 BOLAS ×${this.streak}`);this.holeIndex++;setTimeout(()=>this.newHole(),500)}else this.handleMiss(null,'TENTA OUTRA LINHA');
 }
 completeHole(){
  const term=golfTerm(this.strokes,this.par),delta=this.strokes-this.par;this.totalPar+=this.par;this.results.push({strokes:this.strokes,par:this.par,term});record(true);
  if(this.info.competitive)this.score+=competitivePoints({strokes:this.strokes,par:this.par,streak:this.streak,cushions:this.physics.cushions,accuracy:(this.physics.contacts.size+(this.physics.pocketed.length?1:0))/3});
  else this.score=this.totalStrokes-(this.totalPar);
  this.streak=this.strokes<=this.par?this.streak+1:0;audio.success();buzz([18,35,18]);const sunkBall=this.table.balls.find(b=>b.id===this.physics.pocketed[0]);if(sunkBall)burst(sunkBall.x,sunkBall.y,'#5cf3dc');showToast(`${term} · ${this.strokes} ${this.strokes===1?'TACADA':'TACADAS'}`);unlock();this.holeIndex++;
  if((this.mode==='tour'||this.mode==='daily')&&this.holeIndex>=6)setTimeout(()=>endGame(),850);else setTimeout(()=>this.newHole(),650);updateHUD();
 }
 handleMiss(sunk,label){
  record(false);if(this.inventory.rewind&&this.activePower==='rewind'){this.inventory.rewind=0;this.activePower=null;this.strokes--;this.totalStrokes--;this.table=structuredClone(this.preShot);this.physics=new Physics(this.table);showToast('REWIND · TACADA ANULADA');renderPowers();updateHUD();return}
  audio.fail();buzz(22);showToast(label);this.safeReset(sunk);
 }
 safeReset(sunk){setTimeout(()=>{if(sunk!==null)respawnBall(this.table,this.table.balls[sunk],(this.seedBase+this.totalStrokes*3571+sunk)>>>0);for(const b of this.table.balls){b.vx=b.vy=0;b.spinX=b.spinY=0}this.physics=new Physics(this.table);updateHUD()},data.settings.reducedMotion?0:260)}
 restartHole(){this.totalStrokes-=this.strokes;this.strokes=0;this.table=structuredClone(this.holeStart);if(this.info.kind==='classic')this.table.hole=null;this.hybridPhase=this.info.kind==='hybrid'?'carom':null;this.physics=new Physics(this.table);updateHUD();showToast('BURACO REINICIADO')}
}

function record(ok){data.stats.successes+=ok?1:0;data.stats.recent=[...(data.stats.recent||[]),ok].slice(-12);if(game.mode==='daily'&&ok){const d=new Date().toISOString().slice(0,10);if(!data.dailies.includes(d))data.dailies.push(d)}save(data)}
function unlock(){if(game.results.some(r=>r.strokes<r.par))addAchievement('Birdie','Termina abaixo do par');if(game.streak>=3)addAchievement('Linha Quente','Três buracos ao par ou melhor');if(game.physics.cushions>=3)addAchievement('Geómetra','Emboca após três ressaltos')}
function addAchievement(id,desc){if(data.achievements.some(a=>a.id===id))return;data.achievements.push({id,desc,date:new Date().toISOString()});save(data);showToast(`CONQUISTA · ${id}`)}
function boardDimensions(){const r=$('#stage').getBoundingClientRect();return{w:720,h:clamp(720*r.height/Math.max(1,r.width),620,1440)}}
function resize(){const r=$('#stage').getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);canvas.style.width=`${r.width}px`;canvas.style.height=`${r.height}px`;placeContact()}
function map(e){const r=canvas.getBoundingClientRect(),t=game.table;return{x:(e.clientX-r.left)/r.width*t.w,y:(e.clientY-r.top)/r.height*t.h}}
function down(e){if(!game||game.physics.active||paused)return;audio.unlock();const p=map(e),b=game.table.balls[0];if(Math.hypot(p.x-b.x,p.y-b.y)<100){drag={start:{x:b.x,y:b.y},p,id:e.pointerId,maxed:false};canvas.setPointerCapture(e.pointerId);if(!data.tutorial)coach(1)}}
function move(e){if(!drag||e.pointerId!==drag.id)return;drag.p=map(e);const power=powerFromPull(Math.hypot(drag.start.x-drag.p.x,drag.start.y-drag.p.y),game.shotProfile);if(power.ratio===1&&!drag.maxed){drag.maxed=true;buzz(7);audio.tone(520,.035,'sine',.025)}else if(power.ratio<.96)drag.maxed=false}
function up(e){if(!drag||e.pointerId!==drag.id)return;const dx=drag.start.x-drag.p.x,dy=drag.start.y-drag.p.y,d=Math.hypot(dx,dy),power=powerFromPull(d,game.shotProfile);drag=null;if(!power.speed)return;game.shoot(dx/d*power.speed,dy/d*power.speed,power.ratio);audio.hit(power.ratio);if(!data.tutorial){coach(3);data.tutorial=true;save(data);setTimeout(()=>$('#tutorial').classList.add('hidden'),2200)}}
function setContact(e){const r=$('#cueFace').getBoundingClientRect(),radius=r.width*.37;contact.x=clamp((e.clientX-r.left-r.width/2)/radius,-1,1);contact.y=clamp((e.clientY-r.top-r.height/2)/radius,-1,1);const m=Math.hypot(contact.x,contact.y);if(m>1){contact.x/=m;contact.y/=m}updateContactUI();if(!data.tutorial)coach(2)}
function contactDown(e){if(!game||game.physics.active||paused)return;e.preventDefault();e.stopPropagation();contactPointer=e.pointerId;$('#cueFace').setPointerCapture(e.pointerId);setContact(e);buzz(4)}
function contactMove(e){if(e.pointerId===contactPointer)setContact(e)}function contactUp(e){if(e.pointerId===contactPointer)contactPointer=null}
function updateContactUI(){const travel=$('#cueFace').clientWidth*.44;$('#contactDot').style.transform=`translate(calc(-50% + ${contact.x*travel}px),calc(-50% + ${contact.y*travel}px))`;let label='CENTRO';if(Math.hypot(contact.x,contact.y)>.2){const v=contact.y<-.35?'SEGUIR':contact.y>.35?'RECUO':'',h=contact.x<-.35?'ESQ':contact.x>.35?'DIR':'';label=[v,h].filter(Boolean).join('+')||'EFEITO'}$('#spinLabel').textContent=label}
function moveControlDown(e){if(!game||paused)return;e.preventDefault();e.stopPropagation();movePointer=e.pointerId;$('#moveContact').setPointerCapture(e.pointerId)}
function moveControl(e){if(e.pointerId!==movePointer)return;const stage=$('#stage').getBoundingClientRect(),box=$('#contactControl').getBoundingClientRect();controlPos={x:clamp((e.clientX-stage.left-box.width/2)/(stage.width-box.width),0,1),y:clamp((e.clientY-stage.top-box.height/2)/(stage.height-box.height),0,1)};placeContact()}
function moveControlUp(e){if(e.pointerId!==movePointer)return;movePointer=null;data.settings.contactPos=controlPos;save(data)}
function placeContact(){const stage=$('#stage'),control=$('#contactControl');if(!stage||!control)return;const x=controlPos.x*Math.max(0,stage.clientWidth-control.offsetWidth),y=controlPos.y*Math.max(0,stage.clientHeight-control.offsetHeight);control.style.left=`${x}px`;control.style.top=`${y}px`}
function coach(n){const t=['','APONTAR + FORÇA','IMPACTO MÓVEL','JOGA AO PAR'],d=['','Puxa a partir da branca','Ajusta o efeito; usa MOVER para libertar a mesa','Cada tentativa conta como uma tacada'];$('#coachTitle').textContent=t[n];$('#coachText').textContent=d[n];$('#tutorial').classList.remove('hidden')}

function renderPowers(){const root=$('#powers');if(!game?.info.competitive){root.classList.add('hidden');root.innerHTML='';return}root.classList.remove('hidden');root.innerHTML=Object.entries(POWERS).map(([key,p])=>`<button class="power ${game.activePower===key?'active':''}" data-power="${key}" title="${p.name}: ${p.description}" ${game.inventory[key]?'':'disabled'}>${p.icon}<small>${game.inventory[key]||0}</small></button>`).join('');for(const b of root.querySelectorAll('.power'))b.onclick=()=>{if(game.physics.active)return;const key=b.dataset.power;game.activePower=game.activePower===key?null:key;renderPowers();showToast(game.activePower?POWERS[key].name.toUpperCase():'PODER CANCELADO')}}
function update(dt){if(paused||!game)return;if(game.physics.active){acc+=dt;let n=0;while(acc>=STEP&&n++<18){if(game.physics.step(STEP)){game.finish();acc=0;break}acc-=STEP}}for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.life-=dt}particles=particles.filter(p=>p.life>0)}
function render(){if(!game)return;const W=canvas.clientWidth,H=canvas.clientHeight,t=game.table,dpr=Math.min(2,devicePixelRatio||1),sx=W/t.w,sy=H/t.h;ctx.setTransform(dpr*sx,0,0,dpr*sy,0,0);ctx.fillStyle=t.tableStyle==='snooker'?'#09261f':'#071a21';ctx.fillRect(0,0,t.w,t.h);ctx.strokeStyle=t.tableStyle==='snooker'?'#b98752':'#31535a';ctx.lineWidth=t.tableStyle==='snooker'?12:4;ctx.strokeRect(t.bounds.l,t.bounds.t,t.bounds.r-t.bounds.l,t.bounds.b-t.bounds.t);ctx.globalAlpha=.08;ctx.strokeStyle='#5cf3dc';for(let y=120;y<t.h;y+=120){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(t.w,y);ctx.stroke()}ctx.globalAlpha=1;if(t.hole)drawHole(t.hole,game.hybridPhase!=='carom');for(const p of t.pockets||[])drawPocket(p);if(t.frictionZone){ctx.fillStyle=t.frictionZone.factor>1?'#ffca6815':'#5cf3dc12';ctx.strokeStyle=t.frictionZone.factor>1?'#ffca6860':'#5cf3dc60';roundRect(t.frictionZone.x,t.frictionZone.y,t.frictionZone.w,t.frictionZone.h,18,true,true)}for(const r of t.rails){ctx.strokeStyle='#5cf3dc88';ctx.shadowColor='#5cf3dc';ctx.shadowBlur=13;ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(r.a.x,r.a.y);ctx.lineTo(r.b.x,r.b.y);ctx.stroke();ctx.shadowBlur=0}for(const o of t.obstacles){ctx.fillStyle='#18343d';ctx.strokeStyle='#ffca68';ctx.lineWidth=4;ctx.beginPath();ctx.arc(o.x,o.y,o.r,0,Math.PI*2);ctx.fill();ctx.stroke()}if(drag)drawAim(t);for(const b of t.balls)drawBall(b);for(const p of particles){ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.c;ctx.fillRect(p.x,p.y,5,5)}ctx.globalAlpha=1}
function drawPocket(p){ctx.save();ctx.fillStyle='#010304';ctx.shadowColor='#000';ctx.shadowBlur=12;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#d2a875';ctx.lineWidth=3;ctx.stroke();ctx.restore()}
function drawBall(b){if(b.pocketed)return;let c=b.color||(['#ecffff','#ffca68','#ff6d9e'][b.id]||'#ffca68');if(b.role==='solid')c=['','#f0d332','#3078df','#e43b3b','#7b48ad','#ef7728','#31a66c','#7a271f'][b.number]||c;if(b.role==='stripe')c=['#f0d332','#3078df','#e43b3b','#7b48ad','#ef7728','#31a66c','#7a271f'][b.number-9]||'#eee';if(b.role==='eight')c='#17191c';ctx.shadowColor=c;ctx.shadowBlur=12;const g=ctx.createRadialGradient(b.x-b.r*.3,b.y-b.r*.4,2,b.x,b.y,b.r);g.addColorStop(0,'#fff');g.addColorStop(.24,c);g.addColorStop(1,'#10242b');ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;if(b.number){ctx.fillStyle='#f7f3e8';ctx.beginPath();ctx.arc(b.x,b.y,b.r*.43,0,Math.PI*2);ctx.fill();ctx.fillStyle='#071117';ctx.font=`bold ${b.r*.62}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(b.number,b.x,b.y+.5)}}
function drawHole(h,active=true){ctx.save();ctx.globalAlpha=active?1:.28;const pulse=data.settings.reducedMotion?0:Math.sin(performance.now()/280)*2;ctx.shadowColor='#5cf3dc';ctx.shadowBlur=18+pulse;ctx.strokeStyle='#78ffe7';ctx.lineWidth=4;ctx.fillStyle='#010507';ctx.beginPath();ctx.arc(h.x,h.y,h.r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#ffffff44';ctx.lineWidth=2;ctx.beginPath();ctx.arc(h.x,h.y,h.r*.62,0,Math.PI*2);ctx.stroke();ctx.restore()}
function drawAim(t){const b=t.balls[0],dx=b.x-drag.p.x,dy=b.y-drag.p.y,d=Math.hypot(dx,dy)||1,power=powerFromPull(d,game.shotProfile),pow=power.ratio;let reach=(290+310*pow)*DIFFICULTY[game.difficulty].preview;if(game.activePower==='trace')reach*=2.25;const ux=dx/d,uy=dy/d,hit=rayWall(b.x,b.y,ux,uy,reach,t.bounds,b.r);ctx.setLineDash([11,9]);ctx.strokeStyle='#efffffb8';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(hit.x,hit.y);if(hit.remaining>0&&(game.difficulty==='relaxed'||game.activePower==='trace')){const rx=hit.axis==='v'?-ux:ux,ry=hit.axis==='h'?-uy:uy;ctx.lineTo(hit.x+rx*hit.remaining,hit.y+ry*hit.remaining)}ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle=pow>.82?'#ffca68':'#5cf3dc';ctx.lineWidth=7;ctx.beginPath();ctx.arc(b.x,b.y,b.r+14,-Math.PI/2,-Math.PI/2+Math.PI*2*pow);ctx.stroke()}
function rayWall(x,y,ux,uy,reach,z,r){const tx=ux>0?(z.r-r-x)/ux:ux<0?(z.l+r-x)/ux:Infinity,ty=uy>0?(z.b-r-y)/uy:uy<0?(z.t+r-y)/uy:Infinity,t=Math.min(reach,tx,ty);return{x:x+ux*t,y:y+uy*t,remaining:reach-t,axis:tx<ty?'v':'h'}}
function roundRect(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill)ctx.fill();if(stroke)ctx.stroke()}function burst(x,y,c){if(data.settings.reducedMotion)return;for(let i=0;i<20;i++){const a=Math.random()*Math.PI*2,s=50+Math.random()*140;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.5+Math.random()*.4,c})}}function loop(now){const dt=Math.min(.05,(now-last)/1000);last=now;update(dt);render();requestAnimationFrame(loop)}function buzz(p){if(data.settings.haptics&&navigator.vibrate)navigator.vibrate(p)}function showToast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),950)}
function updateHUD(){if(!game)return;const kind=game.info.kind;
 if(kind==='american'||kind==='british'){$('#scoreLabel').textContent='PONTOS';$('#score').textContent=game.score;$('#streakLabel').textContent='TACADAS';$('#streak').textContent=game.totalStrokes;$('#statusLabel').textContent=kind==='american'?'RESTANTES':'MESA';$('#status').textContent=game.table.balls.slice(1).filter(b=>!b.pocketed).length;$('#objective').textContent=kind==='american'?(game.ruleState.group?`${game.ruleState.group==='solid'?'LISAS':'RISCADAS'} · DEPOIS BOLA 8`:'MESA ABERTA · ESCOLHE O GRUPO'):(game.ruleState.phase==='red'?'VERMELHA':game.ruleState.phase==='color'?'QUALQUER COR':`COR · ${['AMARELA','VERDE','CASTANHA','AZUL','ROSA','PRETA'][game.ruleState.colourIndex]||'FRAME'}`);return}
 if(kind==='trick'){$('#scoreLabel').textContent='PONTOS';$('#score').textContent=game.score;$('#streakLabel').textContent='TENTATIVAS';$('#streak').textContent=game.strokes;$('#statusLabel').textContent='DESAFIO';$('#status').textContent=game.holeIndex+1;$('#objective').textContent=`${game.trick.name.toUpperCase()} · ${game.trick.hint}`;return}
 if(kind==='training'){$('#scoreLabel').textContent='CERTAS';$('#score').textContent=game.score;$('#streakLabel').textContent='TACADAS';$('#streak').textContent=game.totalStrokes;$('#statusLabel').textContent='TREINO';$('#status').textContent='∞';$('#objective').textContent=`TREINO · ${TRAINING_DISCIPLINES[game.trainingDiscipline]}`;return}
 if(kind==='classic'){$('#scoreLabel').textContent='3 BOLAS';$('#score').textContent=game.score;$('#streakLabel').textContent='SÉRIE';$('#streak').textContent=game.streak;$('#statusLabel').textContent='TACADAS';$('#status').textContent=game.totalStrokes;$('#objective').textContent='A BRANCA TOCA NAS DUAS BOLAS';return}
 $('#scoreLabel').textContent=game.info.competitive?'PONTOS':'RESULTADO';$('#score').textContent=game.info.competitive?game.score:formatDelta(game.score);$('#streakLabel').textContent='TACADAS';$('#streak').textContent=game.strokes;$('#statusLabel').textContent='PAR';$('#status').textContent=game.par;$('#objective').textContent=game.hybridPhase==='carom'?'FASE 1 · BILHAR DE 3 BOLAS':`OBJETIVO ${game.holeIndex+1} · EMBOCA UMA COR`}
function formatDelta(n){return n===0?'E':n>0?`+${n}`:String(n)}
function start(){data.mode=$('#mode').value;data.difficulty=$('#difficulty').value;data.tableStyle=$('#tableStyle').value;data.trainingDiscipline=$('#trainingDiscipline').value;data.trickDiscipline=$('#trickDiscipline').value;save(data);contact={x:0,y:0};game=new Game();renderPowers();updateHUD();updateContactUI();placeContact();$('#contactControl').classList.remove('hidden');$('#menu').close();paused=false;if(!data.tutorial)coach(1)}
function endGame(){if(!game)return;data.best[game.mode]=Math.max(data.best[game.mode]||0,game.score);data.bestStreak=Math.max(data.bestStreak,game.streak);save(data);showToast(`VOLTA · ${game.score} PONTOS`);setTimeout(()=>{$('#menu').showModal();paused=true},800)}
function openSettings(){paused=true;$('#sound').checked=data.settings.sound;$('#haptics').checked=data.settings.haptics;$('#reduced').checked=data.settings.reducedMotion;$('#settings').showModal()}

canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',()=>drag=null);$('#cueFace').addEventListener('pointerdown',contactDown);$('#cueFace').addEventListener('pointermove',contactMove);$('#cueFace').addEventListener('pointerup',contactUp);$('#moveContact').addEventListener('pointerdown',moveControlDown);$('#moveContact').addEventListener('pointermove',moveControl);$('#moveContact').addEventListener('pointerup',moveControlUp);window.addEventListener('resize',resize);
$('#playBtn').onclick=start;$('#settingsBtn').onclick=openSettings;$('#openSettings').onclick=openSettings;$('#homeBtn').onclick=()=>{paused=true;$('#menu').showModal()};$('#retryBtn').onclick=()=>game&&!game.physics.active&&game.restartHole();for(const b of document.querySelectorAll('dialog .close'))b.onclick=()=>{b.closest('dialog').close();paused=$('#menu').open};
$('#mode').innerHTML=Object.entries(MODES).map(([key,m])=>`<option value="${key}">${m.label}</option>`).join('');$('#mode').value=data.mode in MODES?data.mode:'golf';$('#difficulty').value=data.difficulty;$('#tableStyle').value=data.tableStyle||'echo';$('#trainingDiscipline').value=data.trainingDiscipline||'golf';$('#trickDiscipline').value=data.trickDiscipline||'golf';function modeCopy(){const m=MODES[$('#mode').value];$('#modeDescription').textContent=m.description;$('#tableStyleRow').classList.toggle('hidden',!m.tableChoice);$('#trainingRow').classList.toggle('hidden',m.kind!=='training');$('#trickRow').classList.toggle('hidden',m.kind!=='trick')}$('#mode').onchange=modeCopy;modeCopy();
$('#progressBtn').onclick=()=>{const a=data.achievements.map(x=>`✓ ${x.id}`).join('<br>')||'Ainda sem conquistas';$('#stats').innerHTML=`Tacadas: ${data.stats.shots}<br>Objetivos: ${data.stats.successes}<br>Melhor série: ${data.bestStreak}<hr>${a}`;$('#progress').showModal()};$('#tutorialBtn').onclick=()=>{data.tutorial=false;save(data);$('#settings').close();paused=false;coach(1)};$('#sound').onchange=e=>{data.settings.sound=e.target.checked;audio.enabled=e.target.checked;save(data)};$('#haptics').onchange=e=>{data.settings.haptics=e.target.checked;save(data)};$('#reduced').onchange=e=>{data.settings.reducedMotion=e.target.checked;save(data)};$('#exportBtn').onclick=()=>{const u=URL.createObjectURL(exportSave(data)),a=document.createElement('a');a.href=u;a.download='tri-echo-progress.json';a.click();URL.revokeObjectURL(u)};$('#importFile').onchange=async e=>{try{data=await importSave(e.target.files[0]);save(data);showToast('PROGRESSO IMPORTADO')}catch{showToast('FICHEIRO INVÁLIDO')}};
window.__TRI_ECHO__={state:()=>game&&({mode:game.mode,tableStyle:game.table.tableStyle,balls:game.table.balls.length,pockets:game.table.pockets?.length||0,trick:game.trick?.id||null,active:game.physics.active,score:game.score,strokes:game.strokes,par:game.par,hybridPhase:game.hybridPhase,cue:{x:game.table.balls[0].x/game.table.w,y:game.table.balls[0].y/game.table.h},hole:game.table.hole&&{x:game.table.hole.x/game.table.w,y:game.table.hole.y/game.table.h,r:game.table.hole.r},contact:{...contact},controlPos:{...controlPos},activePower:game.activePower,inventory:{...game.inventory},cueSpeed:len(game.table.balls[0].vx,game.table.balls[0].vy),maxSpeed:game.shotProfile.maxSpeed,cushions:game.physics.cushions,contacts:game.physics.contacts.size,pocketed:[...game.physics.pocketed],rails:game.table.rails.length})};document.addEventListener('visibilitychange',()=>paused=document.hidden||$('#menu').open||$('#settings').open||$('#progress').open);if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));resize();updateContactUI();$('#menu').showModal();requestAnimationFrame(loop);
