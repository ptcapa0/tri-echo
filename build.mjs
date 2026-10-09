import {cp,mkdir,readFile,readdir,lstat,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {Script} from 'node:vm';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {version}=JSON.parse(await readFile('package.json','utf8'));
await rm('dist',{recursive:true,force:true});
await mkdir('dist/client',{recursive:true});
await mkdir('dist/server',{recursive:true});
async function files(directory){
 const result=[];
 for(const name of (await readdir(directory)).sort()){
  const path=`${directory}/${name}`,info=await lstat(path);
  if(info.isSymbolicLink())throw new Error(`Client symlink forbidden: ${path}`);
  if(info.isDirectory())result.push(...await files(path));
  else if(info.isFile())result.push(path);
  else throw new Error(`Unsupported client file: ${path}`);
 }
 return result;
}
const roots=['index.html','style.css','manifest.webmanifest'];
const paths=[...roots,...await files('js'),...await files('assets'),'build-info.json'].sort();
for(const file of roots){if(!(await lstat(file)).isFile())throw new Error(`Invalid root resource: ${file}`);await cp(file,`dist/client/${file}`)}
for(const directory of ['assets','js'])await cp(directory,`dist/client/${directory}`,{recursive:true});
const commit=process.env.GITHUB_SHA||'local';
await writeFile('dist/client/build-info.json',JSON.stringify({version,commit,builtAt:new Date().toISOString()},null,2)+'\n');
const known=new Set(paths),urls=new Set();
for(const path of paths){
 const url=new URL(path,'https://release.invalid/');
 if(url.search||url.hash||decodeURI(url.pathname).slice(1)!==path||urls.has(url.href))throw new Error(`Non-canonical resource path: ${path}`);
 urls.add(url.href);
}
function reference(from,ref){
 if(!ref||ref.startsWith('#'))return;
 if(/^[a-z][a-z\d+.-]*:|^\/|^\\/i.test(ref))throw new Error(`Non-local client reference: ${from} -> ${ref}`);
 const pathname=decodeURIComponent(ref.split(/[?#]/)[0]);
 const target=posix.normalize(posix.join(posix.dirname(from),pathname));
 if(target.startsWith('../')||!known.has(target))throw new Error(`Missing client reference: ${from} -> ${ref}`);
}
const categories={'.js':'javascript','.html':'html','.css':'css','.json':'json','.webmanifest':'json','.svg':'svg','.png':'png'};
const resources=[];
for(const path of paths){
 const bytes=await readFile(`dist/client/${path}`),category=categories[posix.extname(path)];
 if(!category)throw new Error(`Unsupported media category: ${path}`);
 const text=bytes.toString('utf8');
 if(category==='javascript'){
  // Tokenize comments and quoted literals before inspecting dependency keywords.
  // This bounded grammar rejects unresolved imports instead of guessing paths.
  const tokens=[...text.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g)]
   .map(m=>m[0]).filter(t=>!t.startsWith('//')&&!t.startsWith('/*'));
  const literal=t=>t&&/^['"]/.test(t)?t.slice(1,-1):null;
  for(let i=0;i<tokens.length;i++){
   const t=tokens[i];
   if(t.startsWith('`')&&/\bimport\s*\(/.test(t))throw new Error(`Unresolved template import: ${path}`);
   if(t==='import'){
    if(tokens[i+1]==='.')continue;
    if(tokens[i+1]==='('){
     const ref=literal(tokens[i+2]);
     if(!ref||tokens[i+3]!==')')throw new Error(`Unresolved dynamic import: ${path}`);
     reference(path,ref);continue;
    }
    if(literal(tokens[i+1])){reference(path,literal(tokens[i+1]));continue}
    let j=i+1;while(j<tokens.length&&tokens[j]!=='from'&&tokens[j]!==';')j++;
    const ref=tokens[j]==='from'&&literal(tokens[j+1]);
    if(!ref)throw new Error(`Unsupported import syntax: ${path}`);
    reference(path,ref);
   }
   if(t==='export'&&(tokens[i+1]==='*'||tokens[i+1]==='{')){
    let j=i+1;while(j<tokens.length&&tokens[j]!=='from'&&tokens[j]!==';')j++;
    if(tokens[j]==='from'){const ref=literal(tokens[j+1]);if(!ref)throw new Error(`Unsupported export: ${path}`);reference(path,ref)}
   }
  }
 }
 if(category==='html')for(const m of text.matchAll(/\b(?:src|href|poster)\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/g))reference(path,m[1]||m[2]);
 if(category==='html')for(const m of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/g))for(const candidate of m[1].split(','))reference(path,candidate.trim().split(/\s+/)[0]);
 if(category==='css')for(const m of text.matchAll(/@import\s+['"]([^'"]+)['"]/g))reference(path,m[1]);
 if(category==='css')for(const m of text.matchAll(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/g))reference(path,m[2]);
 if(path==='manifest.webmanifest')for(const icon of JSON.parse(text).icons||[])reference(path,icon.src);
 resources.push({path,sha256:hash(bytes),category});
}
const descriptor={schema:1,version,commit,resources};
const manifest={...descriptor,releaseId:hash(JSON.stringify(descriptor))};
const template=await readFile('sw.js','utf8'),token='__TRI_ECHO_RELEASE__';
if(template.split(token).length!==2)throw new Error('Worker must contain exactly one release token');
const worker=template.replace(token,JSON.stringify(manifest));
if(worker.includes(token))throw new Error('Unresolved worker release token');
new Script(worker);
await writeFile('dist/client/sw.js',worker);
await writeFile('dist/client/precache-manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile('dist/server/index.js',`export default {
 async fetch(request, env) {
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
   response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  }
  return response;
 }
};\n`);
