import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
const port=Number(process.env.PORT)||8080;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};

createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const relative=normalize(pathname).replace(/^[/\\]+/,'');
  let file=join(root,relative||'index.html');
  if(!file.startsWith(root))throw Object.assign(new Error('Forbidden'),{code:'EACCES'});
  if((await stat(file)).isDirectory())file=join(file,'index.html');
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
  res.end(body);
 }catch(error){
  res.writeHead(error.code==='EACCES'?403:404,{'Content-Type':'text/plain; charset=utf-8'});
  res.end(error.code==='EACCES'?'Forbidden':'Not found');
 }
}).listen(port,'0.0.0.0',()=>console.log(`TRI//ECHO ready at http://localhost:${port}`));
