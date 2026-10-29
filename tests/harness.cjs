const fs=require('fs');const vm=require('node:vm');const {webcrypto}=require('node:crypto');
const path=require('path');const www=path.resolve(__dirname,'../www');
const schema=require('../www/ledger-schema');const sync=require('../www/sync-records');
function harness({browser=false,storage=null,initial=null,failRead=false,failWrite=false,delay=0,saveFile=true,fetchImpl}={}){
 const disk=storage||new Map();if(initial!==null)disk.set('family-cashbook-data.json',typeof initial==='string'?initial:JSON.stringify(initial));
 const events=[],writes=[];let writeFailure=failWrite,closeHandler;
 const target=new EventTarget(),document=new EventTarget();document.visibilityState='visible';document.createElement=()=>({click(){},remove(){}});document.head={append(){}};
 const location={protocol:'file:',hostname:'',reload(){events.push({type:'reload'});}};
 const desktop={async read(){if(failRead)throw Error('disk unreadable');return disk.get('family-cashbook-data.json')??null;},async write(text){if(delay)await new Promise(r=>setTimeout(r,delay));if(writeFailure)throw Error('Disk full');writes.push(text);disk.set('family-cashbook-data.json',text);return true;},async saveFile(){return saveFile;},onBeforeClose(fn){closeHandler=fn;},closeReady(ok){events.push({type:'close',ok});}};
 const context={console,TextEncoder,TextDecoder,crypto:webcrypto,btoa,atob,URL,Blob,Event,EventTarget,CustomEvent,Map,Set,Date,JSON,Promise,setTimeout,clearTimeout,setInterval:()=>0,location,document,navigator:{onLine:true},matchMedia:()=>({matches:false}),localStorage:{getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)},CashbookSchema:schema,CashbookSync:sync,CashbookFamily:require('../www/family-files'),cashbookDesktop:browser?null:desktop,CASHBOOK_CONFIG:{googleWebClientId:fetchImpl?'test-client':''},fetch:fetchImpl};
 context.window=context;context.addEventListener=target.addEventListener.bind(target);context.dispatchEvent=e=>{events.push(e);return target.dispatchEvent(e);};
 vm.createContext(context);for(const file of ['security.js','local-store.js'])vm.runInContext(fs.readFileSync(path.join(www,file),'utf8'),context,{filename:file});
 return {context,disk,writes,events,desktop,api:context.__cashbookLocal,db:context.claude.use('db'),failWrites(v){writeFailure=v;},close:()=>closeHandler()};
}
module.exports={harness};
