import {cp,mkdir,rm,writeFile} from 'node:fs/promises';

await rm('dist',{recursive:true,force:true});
await mkdir('dist/client',{recursive:true});
await mkdir('dist/server',{recursive:true});

for(const file of ['index.html','style.css','manifest.webmanifest','sw.js']){
 await cp(file,`dist/client/${file}`);
}
for(const directory of ['assets','js']){
 await cp(directory,`dist/client/${directory}`,{recursive:true});
}

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
