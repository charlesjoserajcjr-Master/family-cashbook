/* Validate external ledgers before changing the working copy. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CashbookSchema=api;})(globalThis,()=>{
'use strict';
const MAX_BYTES=20*1024*1024, badKeys=new Set(['__proto__','constructor','prototype']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function safe(value,depth=0){
 if(depth>32)throw Error('Ledger nesting is too deep.');
 if(typeof value==='number'&&!Number.isFinite(value))throw Error('Invalid ledger number.');
 if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){if(badKeys.has(k))throw Error('Unsafe ledger key.');safe(v,depth+1);}
 return value;
}
function path(p){if(typeof p!=='string'||p.length>300||p.split('/').length!==2||p.split('/').some(k=>!k||badKeys.has(k)))throw Error('Invalid record path.');return p;}
function finite(value){if((typeof value!=='number'&&typeof value!=='string')||!Number.isFinite(Number(value))||Math.abs(Number(value))>1e12)throw Error('Invalid financial amount.');}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Invalid transaction date.');const d=new Date(value+'T12:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)throw Error('Invalid transaction date.');}
function validate(o,{legacy=false}={}){
 safe(o);if(!object(o))throw Error('Invalid ledger.');
 if(legacy&&!o.app&&!o.docs)o={app:'family-cashbook',version:2,docs:o};
 if(o.app!=='family-cashbook'||(o.version!=null&&![1,2].includes(o.version))||!object(o.docs))throw Error('Unsupported Family Cashbook ledger.');
 if(Object.keys(o.docs).length>50000)throw Error('Too many ledger records.');
 for(const [p,d] of Object.entries(o.docs)){
  path(p);if(!object(d))throw Error('Record must be an object.');
  if(p.startsWith('accounts/'))for(const k of ['opening','min'])if(d[k]!=null)finite(d[k]);
  if(p.startsWith('categories/')){if(d.amounts!=null&&!object(d.amounts))throw Error('Invalid category amounts.');for(const [m,v]of Object.entries(d.amounts||{})){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))throw Error('Invalid category month.');finite(v);}}
  if(p.startsWith('balances/')){if(d.values!=null&&!object(d.values))throw Error('Invalid balances.');for(const v of Object.values(d.values||{}))if(v!==null&&v!=='')finite(v);}
  if(p.startsWith('entries/')){date(d.date);finite(d.amount);if(Number(d.amount)<=0||d.month!==d.date.slice(0,7)||typeof d.categoryId!=='string')throw Error('Invalid transaction record.');}
  if(p.startsWith('transfers/')&&Array.isArray(d.items))for(const t of d.items){finite(t.amount);if(Number(t.amount)<=0)throw Error('Invalid transfer amount.');if(t.actual){date(t.actual.date);finite(t.actual.amount);if(Number(t.actual.amount)<=0)throw Error('Invalid actual transfer.');}}

  if(p==='settings/main'&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.start)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.end)||d.end<d.start))throw Error('Invalid plan dates.');
  if(p.startsWith('transfers/')&&(!Array.isArray(d.items)||d.items.some(t=>!object(t)||typeof t.id!=='string'||!t.id||badKeys.has(t.id))||new Set(d.items.map(t=>t.id)).size!==d.items.length))throw Error('Invalid transfer records.');
 }
 for(const key of ['times','tomb'])if(o[key]!=null){if(!object(o[key]))throw Error('Invalid revisions.');for(const [p,t] of Object.entries(o[key])){path(p);if(!Number.isSafeInteger(t)||t<0)throw Error('Invalid revision time.');}}
 if(o.fieldMeta!=null){if(!object(o.fieldMeta))throw Error('Invalid field revisions.');for(const [p,fields]of Object.entries(o.fieldMeta)){path(p);if(!object(fields))throw Error('Invalid field revisions.');for(const rev of Object.values(fields))if(!object(rev)||!Number.isSafeInteger(rev.time)||rev.time<0||typeof rev.device!=='string'||(rev.deleted!=null&&typeof rev.deleted!=='boolean'))throw Error('Invalid field revision.');}}
 if(o.conflicts!=null&&!object(o.conflicts))throw Error('Invalid conflict history.');
 return o;
}
function parse(text,options){if(typeof text!=='string'||text.length>MAX_BYTES)throw Error('Ledger is too large.');return validate(JSON.parse(text),options);}
return {safe,path,validate,parse,MAX_BYTES};
});
