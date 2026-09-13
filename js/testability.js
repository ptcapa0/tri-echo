const LOCAL_TEST_HOSTS=new Set(['localhost','127.0.0.1','::1']);

export function isLocalTestSeam(location){
 return LOCAL_TEST_HOSTS.has(location?.hostname)&&new URLSearchParams(location?.search||'').get('triEchoTest')==='1';
}
