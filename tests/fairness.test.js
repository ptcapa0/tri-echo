import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTableFairness} from '../js/fairness.js';
import {dailySeed,generateCandidate,generateTable} from '../js/generator.js';
import {dailyChallengeConfig} from '../js/rules.js';

const open=()=>({w:720,h:1120,bounds:{l:24,r:696,t:24,b:1096},balls:[{id:0,x:360,y:900,r:18,pocketed:false},{id:1,x:360,y:560,r:18,pocketed:false},{id:2,x:160,y:560,r:18,pocketed:false}],obstacles:[],rails:[],frictionZone:null,hole:{x:360,y:124,r:40},pockets:[],targetType:'portal',traditional:false});
test('open portal fixture has a bounded feasible route',()=>{const result=analyzeTableFairness(open(),{difficulty:'relaxed'});assert.equal(result.accepted,true);assert.ok(result.metrics.openDirections>=6);assert.ok(result.metrics.targetRoutes>=1);assert.ok(result.metrics.physicalReach>0)});
test('cue trapped by bumpers is rejected with an explainable reason',()=>{const table=open(),cue=table.balls[0];table.obstacles=[{x:cue.x+55,y:cue.y,r:20},{x:cue.x-55,y:cue.y,r:20},{x:cue.x,y:cue.y+55,r:20},{x:cue.x,y:cue.y-55,r:20}];const result=analyzeTableFairness(table);assert.ok(result.reasons.includes('NO_CUE_EXIT'))});
test('blocked object-to-portal corridor is not accepted as a target route',()=>{const table=open();table.balls[2].pocketed=true;table.obstacles=[{x:360,y:320,r:36}];const result=analyzeTableFairness(table);assert.ok(result.reasons.includes('NO_TARGET_ROUTE'))});
test('candidate derivation and fair generation are deterministic',()=>{const input=[177,'normal',0,720,1120,{tableStyle:'echo',ballSet:'three'}],candidate=generateCandidate(...input);assert.deepEqual(candidate,generateCandidate(...input));assert.deepEqual(generateTable(...input),generateTable(...input))});
test('Daily uses canonical dimensions independently of viewport inputs',()=>{const config=dailyChallengeConfig(new Date('2026-09-11T18:00:00Z')),a=generateTable(config.seed,config.difficulty,config.adaptive,config.width,config.height,{tableStyle:config.tableStyle}),b=generateTable(config.seed,config.difficulty,config.adaptive,720,1120,{tableStyle:config.tableStyle});assert.deepEqual(a,b);assert.equal(config.seed,dailySeed(new Date('2026-09-11T01:00:00Z')))});
test('traditional layouts bypass fairness regeneration',()=>{const table=generateTable(83,'hard',0,720,1120,{tableStyle:'snooker',ballSet:'american',traditional:true});assert.equal(table.fairness,undefined);assert.equal(table.obstacles.length,0);assert.equal(table.frictionZone,null)});
