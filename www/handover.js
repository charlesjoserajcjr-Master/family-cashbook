/* Family handover: if the only person using the app can't open it, their family still needs to know what exists.
   A PDF lists accounts, cards, loans, bills and assets, and explains how to open the app. The recovery code is never put in it by the app. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.CashbookHandover=api;})(globalThis,root=>{
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rs=n=>(n<0?'-':'')+'Rs '+Math.round(Math.abs(Number(n)||0)).toLocaleString('en-IN');
const DOC='features/handover',YEAR=365*864e5;
function sections(f,h={}){
 const out=[],add=(title,rows)=>{if(rows.length)out.push({title,rows});};
 add('Who to contact',String(h.contacts||'').split(/\n+/).filter(s=>s.trim()));
 add('Bank and cash accounts',f.accounts.map(a=>a.name+' ('+a.kind+'): '+rs(a.balance)+(a.notes?'. '+a.notes:'')));
 add('Credit cards',f.cards.map(a=>a.name+': '+(a.balance<0?'owed '+rs(-a.balance):'balance '+rs(a.balance))+(a.notes?'. '+a.notes:'')));
 add('Foreign accounts',f.foreign.map(a=>a.name+': '+a.currency+' '+a.balance));
 add('Loans and EMIs',f.loans.map(l=>l.name+(l.outstanding!=null?': outstanding '+rs(l.outstanding):'')+(l.emi?', EMI '+rs(l.emi):'')+(l.dueDay?', due on day '+l.dueDay:'')+(l.lastMonth?', ends '+l.lastMonth:'')));
 add('Bills that need paying',f.bills.map(b=>b.name+': '+rs(b.amount)+' a month'+(b.dueDay?', due on day '+b.dueDay:'')+(b.account?', from '+b.account:'')));
 add('Money that comes in',f.income.map(b=>b.name+': '+rs(b.amount)+' a month'+(b.account?', into '+b.account:'')));
 add('Assets',f.assets.map(a=>a.name+' ('+a.type+'): about '+rs(a.value)));
 add('Other amounts owed',f.liabilities.map(a=>a.name+' ('+a.type+'): about '+rs(a.value)));
 add('Businesses',f.businesses.map(b=>b));
 add('Other things your family should know',String(h.notes||'').split(/\n+/).filter(s=>s.trim()));
 return out;
}
const signature=f=>JSON.stringify([f.accounts,f.cards,f.foreign,f.loans,f.assets,f.liabilities,f.businesses].map(l=>l.map(x=>x.name||x)));
function state(f,h={},now=Date.now()){
 const steps={notes:!!(String(h.contacts||'').trim()||String(h.notes||'').trim()),pdf:!!h.pdfAt,backup:!!String(h.where||'').trim(),told:!!h.toldAt};
 const stale=steps.pdf&&(now-h.pdfAt>YEAR||h.sig!==signature(f));
 return {steps,stale,status:Object.values(steps).every(Boolean)?(stale?'stale':'done'):'open'};
}
let A;
const get=()=>A.state().features?.handover||{};
const save=p=>A.db().doc(DOC).set({...get(),type:'handover',...p});
const val=id=>document.getElementById(id)?.value.trim()||'';
const keep=()=>save({contacts:val('ho-contacts'),notes:val('ho-notes'),where:val('ho-where'),who:val('ho-who')});
const btn=(a,t)=>'<button class="btn" data-handover="'+a+'">'+t+'</button>';
function render(){
 const h=get(),st=state(A.handoverFacts(),h),L=window.__cashbookLocal,tick=d=>'<span aria-hidden="true">'+(d?'✓':'○')+'</span> ';
 const area=(id,label,ph,v)=>'<label class="f">'+label+'<textarea id="'+id+'" rows="3" placeholder="'+esc(ph)+'">'+esc(v||'')+'</textarea></label>';
 const line=(id,label,ph,v)=>'<label class="f">'+label+'<input id="'+id+'" value="'+esc(v||'')+'" placeholder="'+esc(ph)+'"></label>';
 return '<section class="section"><div class="section-head"><h2>Family handover</h2><button class="btn" data-feature="menu">All tools</button></div><div class="panel pad"><p>If you are the only one using this app, your family cannot open it without you. These steps make sure they know what you have and how to reach it.</p>'+
 (st.status==='stale'?'<p role="status"><b>! Your accounts have changed or a year has passed.</b> Make a fresh PDF and replace the copy in the envelope.</p>':st.status==='done'?'<p role="status"><b>✓ Your family handover is complete.</b></p>':'')+
 '<h3>'+tick(st.steps.notes)+'1. Add what your family should know</h3><p class="hint">For bank, branch and nominee details, use the Notes box of each account in Accounts &amp; backup.</p>'+btn('accounts','Open accounts')+area('ho-contacts','Who to contact','One per line, e.g. Bank manager, CA, insurance agent, with phone numbers',h.contacts)+area('ho-notes','Other things your family should know','One per line, e.g. where the papers are, lockers, policies, nominees',h.notes)+
 '<h3>'+tick(st.steps.pdf)+'2. Make the “If something happens to me” PDF</h3><p class="hint">It lists your accounts, cards, loans, bills and assets, with the latest balances here, and how to open the app. It is not encrypted, so print it and delete the file.</p>'+btn('pdf','Make the PDF')+
 '<h3>'+tick(st.steps.backup)+'3. Keep a backup away from this device</h3>'+btn('backup','Save a backup')+line('ho-where','Where the backup is kept','e.g. My Google Drive, folder Family Money',h.where)+
 '<h3>'+tick(st.steps.told)+'4. Seal it in an envelope and tell someone</h3><p class="hint">Write your recovery code on the printed PDF by hand. Choose one person you trust and tell them where the envelope is.</p>'+line('ho-who','Who knows where the envelope is','e.g. My sister Asha',h.who)+'<label class="f" style="display:flex;gap:8px;align-items:center;flex-direction:row"><input id="ho-told" type="checkbox" style="width:auto"'+(h.toldAt?' checked':'')+'>Done</label>'+
 '<div class="row">'+btn('save','Save')+'</div><p class="hint">Keep this private: the sheet and a backup together open everything. It is a practical guide for your family, not a will or a legal authority.</p>'+(L?'':'')+'</div></section>';
}
function loadPdf(){return root.jspdf?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src='lib/jspdf.umd.min.js';s.onload=ok;s.onerror=()=>no(Error('Could not make the PDF.'));document.head.append(s);});}
async function makePdf(){
 await keep();const f=A.handoverFacts(),h=get(),L=window.__cashbookLocal,info=L.lockInfo();await loadPdf();
 const pdf=new root.jspdf.jsPDF({unit:'mm',format:'a4',compress:false}),W=210,M=18;let y=22;
 const P=(s,size=11,bold=false,c=[40,40,40],gap=2)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(...c);for(const l of pdf.splitTextToSize(String(s).replace(/[^\x20-\x7E]/g,'-'),W-2*M)){if(y>280){pdf.addPage();y=20;}pdf.text(l,M,y);y+=size*.46;}y+=gap;};
 const H=s=>{y+=3;if(y>262){pdf.addPage();y=20;}P(s,13,true,[33,107,96],1.5);};
 P('If something happens to me',22,true,[33,107,96]);P('ReadyTrove Family Money. Made '+new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}),11,false,[90,90,90]);
 P('Keep this private and sealed. Balances are the latest recorded in the app on that date, not bank-confirmed figures.',11,true,[174,57,54]);
 for(const s of sections(f,h)){H(s.title);s.rows.forEach(r=>P(r,11,false,[40,40,40],1));}
 H('To open everything in the app');
 ['1. Install ReadyTrove Family Money, or use this device if you can open it.','2. Choose Restore a backup and pick the latest backup file.','3. Type the recovery code written below. Then choose a new PIN.'].forEach(x=>P(x,11,false,[40,40,40],1));
 H('Where the backup is kept');if(h.where)P(h.where,11,true);else{y+=7;pdf.line(M,y,W-M,y);y+=6;}
 H('Recovery code');P('Write it here by hand.'+(info.keyId?' Code ID '+info.keyId+'. The backup file name shows the same ID.':''),10,false,[90,90,90]);y+=9;pdf.line(M,y,W-M,y);y+=8;
 P('Banks, lenders and insurers will need the original papers and their own forms. This sheet is a practical guide. It is not a will or a legal authority.',10,false,[70,70,70]);
 pdf.setProperties({title:'If something happens to me',creator:'Family Money'});
 const bytes=pdf.output('arraybuffer'),b64=btoa(Array.from(new Uint8Array(bytes),b=>String.fromCharCode(b)).join(''));
 const r=await L.exportBinary('family-money-handover.pdf',b64,'application/pdf');
 if(r!=='cancelled'){await save({pdfAt:Date.now(),sig:signature(f)});A.toast('PDF ready. Print it, then delete the file.');}
}
if(root.document)document.addEventListener('click',async e=>{
 const t=e.target.closest('[data-handover]');if(!t||!A)return;const a=t.dataset.handover;t.disabled=true;
 try{
  if(a==='save'){await keep();A.toast('Saved.');}
  if(a==='pdf')await makePdf();
  if(a==='accounts'){await keep();A.go('setup');}
  if(a==='backup'){await keep();const r=await window.__cashbookLocal.exportData();A.toast(r==='cancelled'?'Backup cancelled.':'Backup offered. Keep it away from this device.');}
 }catch(err){A.toast(err.message||'That did not work. Please try again.');}
 finally{if(t.isConnected)t.disabled=false;A.refresh();}
});
if(root.document)document.addEventListener('change',e=>{if(e.target.id==='ho-told'&&A){const t=e.target;keep().then(()=>save({toldAt:t.checked?Date.now():0})).then(()=>{t.blur();A.refresh();});}});
return {sections,state,signature,render,attach:a=>{A=a;}};
});
