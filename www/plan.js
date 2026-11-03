/* Family Money by RT Plus on the phone apps. Limits apply only once purchases are switched on in config.js.
   Google Play or the App Store handles the purchase and the 7-day trial; records stay available when a plan ends. */
(function(){
'use strict';
const KEY='fcb-plan',GRACE=3*864e5,CLOCK=36e5,NAME='Family Money by RT Plus';
const LABELS={import:'Statement import',companion:'Phone and laptop sync',family:'Sharing with family',scenarios:'What-if scenarios',prepay:'Loan prepayment comparison',business:'Businesses',currency:'Multi-currency accounts',contract:'Contract income'};
const LOOSE={business:s=>Object.keys(s.businesses||{}).length>0,currency:s=>Object.keys(s.fxAccounts||{}).length>0,family:s=>!!s.family?.main};  // keep using what is already there
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cfg=()=>window.CASHBOOK_CONFIG?.billing||{},native=()=>!!window.Capacitor?.isNativePlatform?.();
const store=()=>window.CASHBOOK_TEST_PURCHASES||(native()&&cfg().purchasesEnabled?window.CashbookNative?.Purchases:null)||null;
const apiKey=()=>window.Capacitor?.getPlatform?.()==='ios'?cfg().revenueCatIosKey:cfg().revenueCatAndroidKey;
const selling=()=>!!store()&&(!!window.CASHBOOK_TEST_PURCHASES||!!apiKey());
const read=()=>{try{return {until:0,seen:0,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{return {until:0,seen:0};}};
const write=s=>{try{localStorage.setItem(KEY,JSON.stringify(s));}catch{}};
let A,ready=false,packs=[];
function apply(info,now=Date.now()){
 if(String(info?.entitlements?.verification||'')==='FAILED')return false;
 const p=info?.entitlements?.active?.[cfg().plusEntitlement||'money_plus'],server=Date.parse(info?.requestDate)||0,s=read();
 s.until=p?(Date.parse(p.expirationDate)||(server||now)+400*864e5):0;s.seen=Math.max(s.seen||0,server,now);write(s);return true;
}
/* Windows and the web have no store yet, so they stay unlocked until website payments are live. */
function has(now=Date.now()){
 if(!selling())return true;
 const s=read();return !!s.until&&!(s.seen&&now<s.seen-CLOCK)&&now<=s.until+GRACE;
}
async function init(){
 const P=store();if(!selling())return;
 try{await P.configure({apiKey:apiKey()||'test'});ready=true;const r=await P.getCustomerInfo();apply(r.customerInfo);A?.refresh();}catch(e){console.warn('plan',e);}
}
function allow(feature){
 if(!LABELS[feature]||has())return true;
 if(LOOSE[feature]?.(A.state()))return true;
 show(LABELS[feature]);return false;
}
const intro=pk=>{const i=pk?.product?.introPrice;if(!i||Number(i.price)!==0)return '';const u=String(i.periodUnit||'').toLowerCase(),n=i.periodNumberOfUnits||1;return n+' '+u+(n>1?'s':'')+' free, then ';};
const LIST='<ul><li>Bank statement import</li><li>Wi-Fi sync between your phone and laptop</li><li>Sharing with family</li><li>What-if scenarios and loan prepayment comparison</li><li>Businesses</li><li>Foreign accounts, remittances and contract income</li></ul>';
function body(what){
 return '<h2>'+NAME+'</h2>'+(what?'<p>'+esc(what)+' is part of '+NAME+'.</p>':'')+LIST+'<p class="hint">Your accounts, plan, forecast, loans, reminders, savings goals, net worth, backups and exports stay free. If a plan ends, you keep all your records.</p><div id="plan-buy"><p class="hint">Loading the price…</p></div><button class="btn" data-plan="close">Not now</button>';
}
async function fill(){
 const box=document.getElementById('plan-buy'),P=store();if(!box||!P)return;
 const none='<p class="hint">This can\'t be bought right now. Please try again later.</p>';
 try{
  const o=await P.getOfferings();packs=o?.current?.availablePackages||[];
  if(!packs.length){box.innerHTML=none;return;}
  box.innerHTML=packs.map((x,i)=>'<button class="btn primary" data-plan="buy" data-i="'+i+'">'+esc(intro(x))+esc(x.product.priceString)+' a year</button>').join('')+'<p class="hint">Renews every year until you cancel it in your store subscriptions. A free trial is one per account and ends with the first payment unless you cancel before then.</p><button class="btn" data-plan="restore">Restore purchase</button>';
 }catch{box.innerHTML=none;}
}
function show(what){A.modal(body(what));fill();}
document.addEventListener('click',async e=>{
 const t=e.target.closest('[data-plan]');if(!t||!A)return;const a=t.dataset.plan,P=store();
 if(a==='close'){A.close();return;}
 if(a==='open'){show();return;}
 window.__cashbookLocal?.holdFor(300000);t.disabled=true;
 try{
  if(a==='buy'){const r=await P.purchasePackage({aPackage:packs[+t.dataset.i]});apply(r.customerInfo);A.close();A.refresh();A.toast(has()?'Thank you. '+NAME+' is on.':'The purchase is not active yet. Try Restore purchase in a minute.');}
  if(a==='restore'){const r=await P.restorePurchases();apply(r.customerInfo);A.close();A.refresh();A.toast(has()?NAME+' restored.':'No subscription found for this store account.');}
 }catch(err){t.disabled=false;if(!err?.userCancelled)A.toast(a==='buy'?'The purchase did not go through. You have not been charged.':'Could not restore the purchase.');}
 finally{window.__cashbookLocal?.holdFor(0);}
});
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState!=='visible'||!ready)return;try{const r=await store().getCustomerInfo();apply(r.customerInfo);A?.refresh();}catch{}});
window.CashbookPlan={attach:a=>{A=a;init();},allow,has,show,get selling(){return selling();},label:f=>LABELS[f],NAME};
})();
