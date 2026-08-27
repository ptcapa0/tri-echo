import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';

const {version}=JSON.parse(await readFile('package.json','utf8'));

await rm('dist',{recursive:true,force:true});
await mkdir('dist/client',{recursive:true});
await mkdir('dist/server',{recursive:true});

for(const file of ['index.html','style.css','manifest.webmanifest','sw.js']){
 await cp(file,`dist/client/${file}`);
}
for(const directory of ['assets','js']){
 await cp(directory,`dist/client/${directory}`,{recursive:true});
}

await writeFile('dist/client/build-info.json',JSON.stringify({
 version,
 commit:process.env.GITHUB_SHA||'local',
 builtAt:new Date().toISOString()
},null,2)+'\n');

await writeFile('dist/server/index.js',`export default {
 async fetch(request, env) {
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
   response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  }
  return response;
 }
};
`);
