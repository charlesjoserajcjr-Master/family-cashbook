const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');const D=require('../www/domain');const {harness}=require('./harness.cjs');
function planner(){
 const h=harness(),nodes=new Map(),listeners={},toasts=[];const node=(key,value='')=>{const x={value,checked:false,disabled:false,isConnected:true,innerHTML:'',dataset:{},style:{},querySelectorAll:()=>[],setAttribute(){},prepend(){},remove(){},focus(){}};nodes.set(key,x);return x;};
 for(const k of ['#save-status','#view','#im-preview','#im-file','#im-account','#im-use-0','#im-use-1','#im-cat-0','#im-cat-1','#close-reviewed','#close-reason'])node(k);
 h.context.CashbookDomain=D;h.context.confirm=()=>true;h.context.document={querySelector:s=>nodes.get(s)||null,createElement:()=>node('temp'),addEventListener:(type,fn)=>listeners[type]=fn};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../www/planner-ui.js'),'utf8'),h.context);
 const state={settings:{start:'2026-08',end:'2026-10'},accounts:{a:{id:'a',name:'Bank'},b:{id:'b',name:'Other'}},entries:{},categories:{food:{id:'food',type:'expense',name:'Food',account:'a'}},transfers:{},features:{},balances:{'2026-08':{values:{a:1100,b:900}}}};
 let db;const computed={ms:['2026-08','2026-09','2026-10'],accs:Object.values(state.accounts),rows:{a:{'2026-08':{calc:1000,actual:1100,diff:100}},b:{'2026-08':{calc:1000,actual:900,diff:-100}}}};
 const api={state:()=>state,computed:()=>computed,actualComputed:()=>computed,month:()=> '2026-08',locked:m=>!!state.settings.closedThrough&&m<=state.settings.closedThrough,db:()=>db,uid:()=> 'test-device',canWrite:()=>true,refresh(){},modal(html){node('#modal').innerHTML=html;},close(){},go(){},toast:m=>toasts.push(m)};
 h.context.CashbookUI.attach(api);
 async function click(action,data={}){const target={dataset:{feature:action,...data},isConnected:true,disabled:false};await listeners.click({target:{closest:()=>target}});}
 return {...h,nodes,node,toasts,state,computed,click,async init(){db=await h.db;await db.doc('settings/main').set(state.settings);return db;},setDb(v){db=v;}};
}
test('CSV import keeps controls stable and retries do not duplicate successful or unacknowledged writes',async()=>{
 const h=planner(),db=await h.init();h.nodes.get('#im-account').value='a';h.nodes.get('#im-file').files=[{size:100,text:async()=> 'Date,Description,Amount\n2026-08-01,One,-100\n2026-08-02,Two,-200'}];
 await h.click('im-preview');assert.match(h.nodes.get('#im-preview').innerHTML,/Import selected rows/);
 for(let i=0;i<2;i++){h.nodes.get('#im-use-'+i).checked=true;h.nodes.get('#im-cat-'+i).value='cat:food';}
 let count=0,failed=false;h.setDb({...db,doc:p=>{const ref=db.doc(p);return {...ref,async set(data){count++;await ref.set(data);if(count===2&&!failed){failed=true;throw Error('Lost acknowledgement');}}};}});
 await h.click('im-commit');assert.equal(h.nodes.get('#im-use-0').disabled,true);assert.equal(h.nodes.get('#im-use-1').disabled,false);assert.match(h.toasts.at(-1),/Lost acknowledgement/);
 await h.click('im-commit');const entries=await db.collection('entries').get();assert.equal(entries.size,2);assert.equal(entries.docs.map(d=>d.data().amount).reduce((a,b)=>a+b,0),300);assert.equal(h.context.CashbookUI.busy,false);
});
test('closing requires each-account acknowledgement and explanation despite net-zero differences',async()=>{const h=planner(),db=await h.init();await h.click('close-month');assert.match(h.nodes.get('#modal').innerHTML,/From recorded activity/);await h.click('close-confirm',{month:'2026-08'});assert.match(h.toasts.at(-1),/Review and confirm/);h.nodes.get('#close-reviewed').checked=true;await h.click('close-confirm',{month:'2026-08'});assert.match(h.toasts.at(-1),/Explain the differences/);h.nodes.get('#close-reason').value='Verified balances; unrecorded transactions reviewed';await h.click('close-confirm',{month:'2026-08'});assert.equal((await db.doc('settings/main').get()).data().closedThrough,'2026-08');const audits=await db.collection('features').get();assert.equal(audits.size,1);assert.equal(audits.docs[0].data().accounts.length,2);});
test('month close cannot skip the earliest open month',async()=>{const h=planner();await h.init();await h.click('close-confirm',{month:'2026-09'});assert.match(h.toasts.at(-1),/Month changed/);});
