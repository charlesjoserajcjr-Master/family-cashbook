/* Field revisions and per-transfer tombstones for personal offline sync. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CashbookSync=api;})(globalThis,()=>{
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>x&&typeof x==='object'?(Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}'):JSON.stringify(x);
function parts(path,doc){
 const p=Object.create(null);for(const [k,v]of Object.entries(doc||{})){
  if(k==='items'&&path.startsWith('transfers/')){for(const item of v||[])p['items/'+item.id]=item;}
  else if((k==='values'&&path.startsWith('balances/'))||(k==='amounts'&&path.startsWith('categories/'))||(k==='completedMonths'&&path.startsWith('categories/'))){for(const [id,value]of Object.entries(v||{}))p[k+'/'+id]=value;}
  else p[k]=v;
 }return p;
}
function join(path,p){
 const d={};if(path.startsWith('transfers/'))d.items=[];
 for(const k of Object.keys(p).sort()){
  const v=p[k];
  if(k.startsWith('items/')&&path.startsWith('transfers/'))d.items.push(v);
  else if(k.includes('/')&&['values','amounts','completedMonths'].includes(k.split('/')[0])){const [field,id]=k.split('/');(d[field]||={})[id]=v;}
  else d[k]=v;
 }return d;
}
const compare=(a,b)=>(a?.time||0)-(b?.time||0)||String(a?.device||'').localeCompare(String(b?.device||''))||Number(!!a?.deleted)-Number(!!b?.deleted);
function stamp(path,before,after,previous={},time,device,oldTime=1){
 const a=parts(path,before),b=parts(path,after),out={...previous};
 for(const k of Object.keys(a))if(!out[k])out[k]={time:oldTime,device:''};
 for(const k of new Set([...Object.keys(a),...Object.keys(b)]))if(stable(a[k])!==stable(b[k]))out[k]={time,device,deleted:!(k in b)};
 return out;
}
function merge(path,local,remote,localMeta={},remoteMeta={},localTime=1,remoteTime=1){
 const a=parts(path,local),b=parts(path,remote),values=Object.create(null),meta={},conflicts=[];
 for(const k of new Set([...Object.keys(a),...Object.keys(b),...Object.keys(localMeta),...Object.keys(remoteMeta)])){
  const la=localMeta[k]||{time:k in a?localTime:0,device:''},rb=remoteMeta[k]||{time:k in b?remoteTime:0,device:''};
  const cmp=compare(la,rb),useLocal=cmp>0||(cmp===0&&String(stable(a[k]))>=String(stable(b[k]))),pick=useLocal?la:rb,win=useLocal?a:b;
  meta[k]=pick;if(!pick.deleted&&k in win)values[k]=clone(win[k]);
  if(la.device!==rb.device&&stable(a[k])!==stable(b[k])&&la.time&&rb.time)conflicts.push({field:k,local:a[k]??null,remote:b[k]??null,localRevision:la,remoteRevision:rb});
 }return {doc:join(path,values),meta,conflicts};
}
return {parts,join,stamp,merge,compare,stable};
});
