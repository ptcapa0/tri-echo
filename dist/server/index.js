export default {
 async fetch(request, env) {
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && request.method === 'GET' && request.headers.get('accept')?.includes('text/html')) {
   response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  }
  return response;
 }
};
