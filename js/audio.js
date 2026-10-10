export class AudioFX{
 constructor(){this.ctx=null;this.enabled=true;this.paused=false;this.successTimer=null}
 unlock(){
  if(!this.enabled)return;this.paused=false;
  try{if(!this.ctx)this.ctx=new (window.AudioContext||window.webkitAudioContext)();Promise.resolve(this.ctx.resume()).catch(()=>{})}catch{}
 }
 suspend(){
  this.paused=true;clearTimeout(this.successTimer);this.successTimer=null;
  if(this.ctx)try{Promise.resolve(this.ctx.suspend()).catch(()=>{})}catch{}
 }
 tone(freq=300,dur=.06,type='sine',gain=.07){
  if(!this.enabled||this.paused||!this.ctx)return;
  try{const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(freq,this.ctx.currentTime);g.gain.setValueAtTime(gain,this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+dur);o.connect(g).connect(this.ctx.destination);o.start();o.stop(this.ctx.currentTime+dur)}catch{}
 }
 hit(power=1){this.tone(170+power*90,.05,'triangle',.035)}
 success(){this.tone(440,.15);clearTimeout(this.successTimer);this.successTimer=setTimeout(()=>{this.successTimer=null;this.tone(660,.22)},90)}
 fail(){this.tone(120,.18,'sawtooth',.025)}
}
