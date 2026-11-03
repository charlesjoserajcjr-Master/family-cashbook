/* PIN lock, recovery code and auto-lock. The records are encrypted with a random recovery code (or the user's existing passphrase);
   the PIN only opens that key on this device. Nothing here is stored outside the device, and nothing can reset a lost code. */
(function(){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const L=()=>window.__cashbookLocal,skip=()=>!!window.CASHBOOK_TEST_SKIP_PIN;
let root=null,after=null,showing='';
const $=s=>root?.querySelector(s);
function open(html){
 if(!root){root=document.createElement('div');root.id='lock-root';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.style.cssText='position:fixed;inset:0;z-index:60;background:var(--bg);overflow:auto;display:flex;justify-content:center;padding:max(24px,env(safe-area-inset-top)) 16px 24px';document.body.appendChild(root);}
 root.innerHTML='<div style="width:100%;max-width:420px;margin:auto"><div class="panel pad">'+html+'</div></div>';
 root.querySelector('input')?.focus();
}
function close(){root?.remove();root=null;showing='';}
function done(){const then=after;after=null;close();then?.();}
const say=(t,bad=true)=>{const m=$('#lock-msg');if(m){m.textContent=t;m.style.color=bad?'var(--bad)':'var(--ink2)';}};
const msgLine='<p id="lock-msg" role="status" style="min-height:1.4em;margin:8px 0"></p>';
const pinField=(id,label)=>'<label class="f">'+label+'<input id="'+id+'" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="8"></label>';
const enter=(id,fn)=>$('#'+id)?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();fn();}});
const guard=fn=>async()=>{try{await fn();}catch(e){say(e.message||'That did not work. Please try again.');}};

function choosePin({title,intro,next,cancel}){
 showing='choose';
 open('<h2>'+esc(title)+'</h2><p>'+esc(intro)+'</p><div class="form">'+pinField('pin-new','New PIN (6 to 8 digits)')+pinField('pin-confirm','Enter it again')+'</div>'+msgLine+'<div class="row">'+(cancel?'<button class="btn" id="pin-back">Back</button>':'')+'<button class="btn primary" id="pin-next">Next</button></div>');
 const go=guard(async()=>{const p=$('#pin-new').value;if(p!==$('#pin-confirm').value)throw Error('The two PINs do not match.');L().checkPin(p);await next(p);});
 $('#pin-next').onclick=go;enter('pin-confirm',go);
 if(cancel)$('#pin-back').onclick=()=>{after=null;close();cancel();};
}
function showCode(pin,code,id,hadRecords){
 showing='code';
 open('<h2>Your recovery code</h2><p>If you forget your PIN or change phones, this code and a backup file are the only way back in. ReadyTrove cannot reset it.</p><p style="font:600 19px/1.5 ui-monospace,Consolas,monospace;background:var(--sunk);border-radius:10px;padding:12px;text-align:center;overflow-wrap:anywhere" id="pin-code-show">'+esc(code)+'</p><p class="hint">Code ID '+esc(id)+'. Your backups show this ID, so you can match each backup to its code.</p><p>Write it on paper and keep it away from this device.</p>'+(hadRecords?'<p class="hint">Backups you saved earlier are not protected by this code. Delete them after you save a new backup.</p>':'')+'<label class="f" style="display:flex;gap:8px;align-items:center;flex-direction:row"><input id="pin-got" type="checkbox" style="width:auto">I have written it down</label>'+msgLine+'<div class="row"><button class="btn primary" id="pin-finish" disabled>Finish</button></div>');
 $('#pin-got').onchange=e=>{$('#pin-finish').disabled=!e.target.checked;};
 $('#pin-finish').onclick=guard(async()=>{$('#pin-finish').disabled=true;await L().protect(pin,code);done();window.CashbookUI?.toast?.('Your records are now protected.');});
}
/* Run `then` once this device is protected. New users pass through here before their first record. */
async function protect(then,{cancel}={}){
 const l=L();
 if(skip()||(l.encrypted&&!l.locked&&l.lockInfo().set)){then?.();return;}
 after=then||null;
 if(l.encrypted){
  choosePin({title:'Choose a PIN',intro:'You will use this PIN to open Family Money on this device. Your recovery code or passphrase keeps working as before.',next:async p=>{await l.setPin(p);done();}});
  return;
 }
 choosePin({title:'Protect your money records',intro:'Your records stay encrypted on this device. Choose a PIN you will remember.',cancel,next:async p=>{const code=l.newCode();showCode(p,code,await l.codeId(code),l.hasRecords());}});
}
/* Every saved ledger must be protected: older ledgers come here the first time they open. */
function gate(){
 if(skip()||showing)return;
 const l=L();if(!l||l.locked||l.readError||l.lockInfo().set&&l.encrypted)return;
 if(!l.hasRecords())return;
 protect(()=>window.CashbookUI?.refresh?.());
}
function pinScreen(){
 if(showing==='pin'||showing==='recover')return;
 const l=L(),info=l.lockInfo();showing='pin';
 open('<h2>Family Money</h2><p>Enter your PIN to open your records.</p><div class="form">'+pinField('pin-entry','PIN')+'</div>'+msgLine+'<div class="row"><button class="btn primary" id="pin-open">Open</button></div><p style="margin-top:16px"><button class="btn ghost" id="pin-forgot">Forgot PIN? Use your recovery code</button></p>');
 const go=guard(async()=>{
  const v=$('#pin-entry').value;if(!v)return;$('#pin-open').disabled=true;
  try{
   const r=await l.pinUnlock(v);
   if(r===true){close();return;}
   $('#pin-entry').value='';$('#pin-entry').focus();
   if(r==='nokey')return say("This device's lock key is gone, which can happen after a reset. Use your recovery code.");
   if(r?.wait)return say('Too many wrong PINs. Try again in '+Math.ceil(r.wait/1000)+' seconds, or use your recovery code.');
   say('That PIN is not right.');
  }finally{if($('#pin-open'))$('#pin-open').disabled=false;}
 });
 $('#pin-open').onclick=go;enter('pin-entry',go);$('#pin-forgot').onclick=recoverScreen;
 if(info.waitMs>0)say('Too many wrong PINs. Try again in '+Math.ceil(info.waitMs/1000)+' seconds, or use your recovery code.');
}
function recoverScreen(){
 const l=L();showing='recover';
 open('<h2>Use your recovery code</h2><p>Type the code you wrote down when you set up Family Money. If you protected your records with a passphrase, type that instead. You will then choose a new PIN.</p><label class="f">Recovery code or passphrase<input id="pin-recover" type="password" autocomplete="off"></label>'+msgLine+'<div class="row"><button class="btn" id="pin-back">Back</button><button class="btn primary" id="pin-recover-go">Open</button></div>');
 const go=guard(async()=>{$('#pin-recover-go').disabled=true;try{await l.unlock($('#pin-recover').value.trim());}catch{throw Error('That code did not open your records. Check it and try again.');}finally{if($('#pin-recover-go'))$('#pin-recover-go').disabled=false;}
  choosePin({title:'Choose a new PIN',intro:'Your records are open. Choose a PIN for this device.',next:async p=>{await l.setPin(p);close();window.CashbookUI?.refresh?.();}});});
 $('#pin-back').onclick=()=>{showing='';pinScreen();};$('#pin-recover-go').onclick=go;enter('pin-recover',go);
}
function changePin(){
 const l=L();showing='change';
 open('<h2>Change your PIN</h2><div class="form">'+pinField('pin-now','Current PIN')+pinField('pin-new','New PIN (6 to 8 digits)')+pinField('pin-confirm','Enter it again')+'</div>'+msgLine+'<div class="row"><button class="btn" id="pin-back">Cancel</button><button class="btn primary" id="pin-next">Change PIN</button></div>');
 $('#pin-back').onclick=close;
 $('#pin-next').onclick=guard(async()=>{const p=$('#pin-new').value;if(!await l.checkCurrentPin($('#pin-now').value))throw Error('Your current PIN is not right.');if(p!==$('#pin-confirm').value)throw Error('The two PINs do not match.');l.checkPin(p);await l.setPin(p);close();window.CashbookUI?.toast?.('Your PIN has changed.');});
}
function replaceCode(){
 const l=L();showing='change';
 open('<h2>Make a new recovery code</h2><p>The old code stops working for this device. Backups you already saved still need the old code, so save a new backup straight after this.</p><div class="form">'+pinField('pin-now','Your PIN')+'</div>'+msgLine+'<div class="row"><button class="btn" id="pin-back">Cancel</button><button class="btn primary" id="pin-next">Next</button></div>');
 $('#pin-back').onclick=close;
 $('#pin-next').onclick=guard(async()=>{const pin=$('#pin-now').value;if(!await l.checkCurrentPin(pin))throw Error('Your PIN is not right.');const code=l.newCode(),id=await l.codeId(code);
  showing='code';
  open('<h2>Your new recovery code</h2><p style="font:600 19px/1.5 ui-monospace,Consolas,monospace;background:var(--sunk);border-radius:10px;padding:12px;text-align:center;overflow-wrap:anywhere" id="pin-code-show">'+esc(code)+'</p><p class="hint">Code ID '+esc(id)+'.</p><p>Write it on paper. ReadyTrove cannot reset it.</p><label class="f" style="display:flex;gap:8px;align-items:center;flex-direction:row"><input id="pin-got" type="checkbox" style="width:auto">I have written it down</label>'+msgLine+'<div class="row"><button class="btn" id="pin-back">Keep the old code</button><button class="btn primary" id="pin-finish" disabled>Use the new code</button></div>');
  $('#pin-back').onclick=close;$('#pin-got').onchange=e=>{$('#pin-finish').disabled=!e.target.checked;};
  $('#pin-finish').onclick=guard(async()=>{$('#pin-finish').disabled=true;await l.replaceCode(pin,code);close();window.CashbookUI?.refresh?.();window.CashbookUI?.toast?.('New code in use. Save a new backup now.');});});
}
/* Auto-lock: after time away from the app, and after 10 idle minutes on a computer. Sharing, scanning and file pickers do not count as leaving. */
let hiddenAt=0,lastInput=Date.now();
const canLock=()=>{const l=L();return !!l&&!l.locked&&l.encrypted&&l.lockInfo().set&&!showing&&!l.onHold()&&!window.CashbookUI?.busy&&!window.CashbookWifiUI?.status?.active;};
const lockNow=()=>{if(canLock())L().lock().catch(()=>{});};
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden'){hiddenAt=Date.now();return;}
 const away=hiddenAt?Date.now()-hiddenAt:0;hiddenAt=0;
 if(away&&away>=L().lockInfo().autolock*1000)lockNow();
});
for(const t of ['pointerdown','keydown'])document.addEventListener(t,()=>{lastInput=Date.now();},true);
document.addEventListener('click',e=>{if(e.target?.matches?.('input[type=file]'))L()?.holdFor(600000);},true);
document.addEventListener('change',e=>{if(e.target?.matches?.('input[type=file]'))L()?.holdFor(0);},true);
setInterval(()=>{if(window.cashbookDesktop&&Date.now()-lastInput>600000)lockNow();},30000);
window.CashbookLock={protect,gate,pinScreen,changePin,replaceCode,get open(){return !!root;}};
})();
