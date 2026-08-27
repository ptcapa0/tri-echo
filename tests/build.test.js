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
