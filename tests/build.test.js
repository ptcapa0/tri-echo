import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

test('production build contains only the complete client artifact',async()=>{
 const build=spawnSync(process.execPath,['build.mjs'],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr||build.stdout);

 for(const file of ['index.html','style.css','manifest.webmanifest','sw.js','build-info.json','js/app.js','js/physics.js']){
  assert.ok((await stat(`dist/client/${file}`)).isFile(),`${file} is missing from dist/client`);
 }

 const sourceModules=(await readdir('js')).filter(file=>file.endsWith('.js')).sort();
 const builtModules=(await readdir('dist/client/js')).filter(file=>file.endsWith('.js')).sort();
 assert.deepEqual(builtModules,sourceModules,'every client module must be copied into the production build');

 const info=JSON.parse(await readFile('dist/client/build-info.json','utf8'));
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.equal(info.version,pkg.version);
 assert.equal(info.commit,process.env.GITHUB_SHA||'local');
 assert.ok(!Number.isNaN(Date.parse(info.builtAt)),'builtAt must be an ISO-8601 timestamp');
});

import {createHash} from 'node:crypto';
import {mkdtemp,cp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('release manifest covers every emitted resource and independently verifies worker identity',async()=>{
 const manifest=JSON.parse(await readFile('dist/client/precache-manifest.json','utf8'));
 const {releaseId,...descriptor}=manifest;assert.equal(releaseId,sha(JSON.stringify(descriptor)));
 const covered=manifest.resources.map(r=>r.path);assert.ok(covered.includes('js/fairness.js'));assert.ok(covered.includes('js/testability.js'));
 assert.ok(!covered.includes('sw.js'));assert.ok(!covered.includes('precache-manifest.json'));
 for(const r of manifest.resources)assert.equal(r.sha256,sha(await readFile(`dist/client/${r.path}`)),r.path);
 const worker=await readFile('dist/client/sw.js','utf8');assert.ok(worker.includes(JSON.stringify(manifest)));assert.ok(!worker.includes('__TRI_ECHO_RELEASE__'));new vm.Script(worker);
});
test('build fails closed for unresolved graph, traversal, symlinks and generation token',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tri-echo-build-'));
 try{
  for(const path of ['build.mjs','sw.js','package.json','index.html','style.css','manifest.webmanifest','js','assets'])await cp(path,join(directory,path),{recursive:true});
  const app=await readFile(join(directory,'js/app.js'),'utf8');
  for(const suffix of ["\nimport './missing.js';","\nimport '../outside.js';","\nimport(variable);","\nexport {x} from './missing.js';"]){
   await writeFile(join(directory,'js/app.js'),app+suffix);const result=spawnSync(process.execPath,['build.mjs'],{cwd:directory,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/Missing client reference|Unresolved dynamic import/);
  }
  await writeFile(join(directory,'js/app.js'),app);
  await symlink(join(directory,'index.html'),join(directory,'assets/escape.html'));
  const escaped=spawnSync(process.execPath,['build.mjs'],{cwd:directory,encoding:'utf8'});assert.notEqual(escaped.status,0);assert.match(escaped.stderr,/symlink forbidden/);await rm(join(directory,'assets/escape.html'));
  await writeFile(join(directory,'assets/ambiguous#name.png'),'bytes');
  const alias=spawnSync(process.execPath,['build.mjs'],{cwd:directory,encoding:'utf8'});assert.notEqual(alias.status,0);assert.match(alias.stderr,/Non-canonical resource path/);await rm(join(directory,'assets/ambiguous#name.png'));
  await writeFile(join(directory,'sw.js'),'const worker = {};');assert.notEqual(spawnSync(process.execPath,['build.mjs'],{cwd:directory}).status,0);
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('identical build inputs serialize to identical release IDs; changing a resource changes identity',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tri-echo-identity-'));
 try{
  for(const path of ['build.mjs','sw.js','package.json','index.html','style.css','manifest.webmanifest','js','assets'])await cp(path,join(directory,path),{recursive:true});
  await writeFile(join(directory,'clock.mjs'),"const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-09T00:00:00Z']))}};await import('./build.mjs');");
  const build=async()=>{const r=spawnSync(process.execPath,['clock.mjs'],{cwd:directory,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(await readFile(join(directory,'dist/client/precache-manifest.json'),'utf8'))};
  const first=await build();assert.deepEqual(await build(),first);
  await writeFile(join(directory,'style.css'),(await readFile(join(directory,'style.css'),'utf8'))+'\n/* different release bytes */');assert.notEqual((await build()).releaseId,first.releaseId);
 }finally{await rm(directory,{recursive:true,force:true})}
});
