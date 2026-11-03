/* Bill and EMI reminders on the phone. Settings stay on this device. A reminder shows a bill's name at most, never an amount. */
(function(){
'use strict';
const KEY='fcb-reminders';
const LN=()=>window.CASHBOOK_TEST_NOTIFY||(window.Capacitor?.isNativePlatform?.()?window.CashbookNative?.LocalNotifications:null)||null;
const read=()=>{try{return {on:false,before:2,hide:false,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{return {on:false,before:2,hide:false};}};
const write=s=>{try{localStorage.setItem(KEY,JSON.stringify(s));}catch{}};
let A,timer=null,last='';
function upcoming(){
 const s=A.state(),settings=read(),entries=Object.values(s.entries||{}),actuals={};
 for(const e of entries)((actuals[e.categoryId]??={})[e.month]??={n:0,sum:0}),actuals[e.categoryId][e.month].n++,actuals[e.categoryId][e.month].sum+=Number(e.amount)||0;
 return CashbookDomain.dueReminders({categories:s.categories||{},actuals,closedThrough:s.settings?.closedThrough||'',now:new Date(),before:settings.before});
}
const notice=(r,hide)=>({id:r.id,title:hide?'Family Money':r.name+': due '+r.when,body:hide?'A bill is due soon. Open Family Money to see it.':'Open Family Money to see it.',schedule:{at:new Date(r.at),allowWhileIdle:true}});
async function clear(){const P=LN();if(!P)return;const p=await P.getPending();if(p.notifications.length)await P.cancel({notifications:p.notifications.map(n=>({id:n.id}))});}
async function apply(){
 const P=LN(),s=read();if(!P||!A?.state().settings)return;
 if(!s.on){if(last!=='off'){last='off';await clear();}return;}
 const list=upcoming(),sig=JSON.stringify([list,s.hide]);if(sig===last)return;last=sig;
 await clear();if(list.length)await P.schedule({notifications:list.map(r=>notice(r,s.hide))});
}
function sync(){clearTimeout(timer);timer=setTimeout(()=>apply().catch(()=>{last='';}),1500);}
async function turnOn(){
 const P=LN();if(!P)throw Error('Reminders work in the phone app.');
 let p=await P.checkPermissions();if(p.display!=='granted')p=await P.requestPermissions();
 if(p.display!=='granted')throw Error("Notifications are off. Turn them on in your phone's settings.");
 write({...read(),on:true});last='';await apply();
}
async function turnOff(){write({...read(),on:false});last='';await apply();}
function change(patch){write({...read(),...patch});last='';sync();}
window.CashbookReminders={attach:a=>{A=a;},sync,turnOn,turnOff,change,upcoming,get settings(){return read();},get available(){return !!LN();}};
})();
