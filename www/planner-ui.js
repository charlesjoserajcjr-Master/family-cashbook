/* Progressive planning tools; existing ledgers remain readable. */
(function(){
'use strict';
const D=CashbookDomain;let A,screen='menu',preview=[],operations=0,importAccount='',importDirty=false;
const drafts=new Map();
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const id=()=>crypto.randomUUID(),today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const S=()=>A.state(),C=()=>A.computed(),features=type=>Object.values(S().features||{}).filter(x=>x.type===type);
const btn=(action,label,extra='')=>'<button class="btn" data-feature="'+action+'" '+extra+'>'+label+'</button>';
const field=(label,key,type='text',value='',extra='')=>'<label class="f">'+label+'<input id="'+key+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
const select=(label,key,options)=>'<label class="f">'+label+'<select id="'+key+'">'+options+'</select></label>';
const option=(value,label,selected=false)=>'<option value="'+esc(value)+'" '+(selected?'selected':'')+'>'+esc(label)+'</option>';
const accountOpts=()=>Object.values(S().accounts).map(a=>option(a.id,a.name)).join('');
const cancel=()=>'<div class="row">'+btn('cancel','Cancel')+'</div>';
const save=async(p,v)=>{if(!A.canWrite())throw Error('This ledger is read-only.');await A.db().doc(p).set(v);};
const update=async(p,v)=>{if(!A.canWrite())throw Error('This ledger is read-only.');await A.db().doc(p).update(v);};
const allMonths=()=>C().ms.filter(m=>!A.locked(m));
const num=s=>{const n=Number($(s).value);if(!Number.isFinite(n))throw Error('Enter a valid number.');return n;};
function positive(s,allowZero=false){const n=num(s);if(allowZero?n<0:n<=0)throw Error('Enter a positive amount.');return n;}
const currentMonth=()=>A.month();
function panel(title,body){return '<section class="section"><div class="section-head"><h2>'+title+'</h2>'+btn('menu','All tools')+'</div><div class="panel pad">'+body+'</div></section>';}
function rowsTable(head,rows){return '<div class="scroll"><table><thead><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function navigate(s){screen=s;drafts.delete(s);A.go('more');}
function recorded(){
 const m=today().slice(0,7),date=today(),v={};
 const actual=A.actualComputed();for(const a of C().accs)v[a.id]=actual.rows[a.id]?.[m]?.begin??Number(a.opening||0);
 for(const e of Object.values(S().entries))if(e.month===m&&e.date<=date){const c=S().categories[e.categoryId];if(c&&v[e.accountId||c.account]!=null)v[e.accountId||c.account]+=(c.type==='income'?1:-1)*Number(e.amount);}
 for(const r of Object.values(S().transfers))for(const t of r.items||[]){const a=t.actual;if(a?.date?.slice(0,7)===m&&a.date<=date){v[a.from]-=Number(a.amount);v[a.to]+=Number(a.amount);}}
 for(const t of Object.values(S().fxTransfers||{}))if(t.status!=='planned'&&t.date.slice(0,7)===m&&t.date<=date){if(t.from.startsWith('legacy:'))v[t.from.slice(7)]-=Number(t.sourceAmount)+Number(t.fee||0);if(t.to.startsWith('legacy:'))v[t.to.slice(7)]+=Number(t.receivedAmount);}
 const foreign=window.CashbookCurrency?.compute(S(),date);return {values:v,cash:C().accs.filter(a=>a.kind!=='Credit').reduce((n,a)=>n+(v[a.id]||0),0)+(foreign?.liquidINR||0),fxMissing:foreign?.missing||[]};
}
function afterRender(tab){
 const nav=$('#tabs');if(nav)nav.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===(['overview','transactions','plan'].includes(tab)?tab:'more')));
 $('#feature-toolbar')?.remove();
 if(!S().settings)return;
 const el=document.createElement('div');el.id='feature-toolbar';el.className='row';el.style.marginTop='12px';
 if(tab==='overview'){
  const r=recorded();
  el.innerHTML='<div class="panel pad"><b>Recorded cash today: '+(r.fxMissing.length?'FX rates needed':fmt(r.cash))+'</b><div class="hint">Calculated from opening balances and recorded transactions. Forecast cards below include expected future activity.</div></div>'+btn('calendar','Upcoming bills')+btn('scenarios','Compare a scenario');
 }else if(tab==='plan')el.innerHTML=btn('scenarios','What-if scenarios')+btn('goals','Savings goals')+btn('contract','Contract income')+btn('calendar','Bill dates');
 else if(tab==='transactions')el.innerHTML=btn('import','Import statement')+btn('month','Monthly review');
 else if(tab==='month'&&!A.locked(currentMonth()))el.innerHTML=btn('close-month','Review and close '+currentMonth())+btn('complete','Complete a category');
 else if(tab==='loans')el.innerHTML=btn('prepay','Compare prepayments');
 if(el.innerHTML)$('#view').prepend(el);
}
function menu(){
 return panel('More','<p>Choose the tools you need. Your data stays available without a subscription.</p><div class="tool-grid">'+[
 ['month','Monthly review'],['loans','Loans & EMIs'],['networth','Net worth'],['business','Businesses'],['setup','Accounts & backup'],
 ['calendar','Bills calendar'],['goals','Savings goals'],['scenarios','What-if scenarios'],['prepay','Loan prepayment'],['import','Statement import'],
 ['contract','Contract income & currency conversion'],['card','Add credit card'],['security','Privacy & encrypted backups'],['conflicts','Sync history'],['plans','Plans & family access'],['family','Encrypted family file sync'],['currency','Multi-currency accounts & remittances'],['billing','Purchases & restore']
 ].map(([k,v])=>btn(k,v)).join('')+'</div>');
}
function scenarios(){
 const saved=features('scenario');
 return panel('What-if scenarios','<p>Compare a temporary change without editing your main plan. This uses monthly household totals, including business activity; it does not model daily timing or separate currencies.</p><div class="form">'+
 field('Scenario name','sc-name','text','My alternative')+field('From','sc-from','month',allMonths()[0]||today().slice(0,7))+field('Until','sc-to','month',allMonths().at(-1)||today().slice(0,7))+
 field('Income change (%)','sc-income','number',0,'min="-100" max="1000"')+field('Spending change (%)','sc-expense','number',0,'min="-100" max="1000"')+
 field('Extra net cash each month (₹)','sc-extra','number',0)+field('One-off cost (₹)','sc-once','number',0,'min="0"')+field('One-off month','sc-month','month',allMonths()[0])+
 '</div><div class="row">'+btn('sc-calc','Compare')+btn('sc-save','Save scenario')+'</div><div id="sc-result"></div>'+
 (saved.length?'<h3>Saved comparisons</h3>'+saved.map(x=>btn('sc-load',esc(x.name),'data-id="'+x.id+'"')).join(''):''));
}
function scenarioInput(){
 if(C().fxMissing?.length)throw Error('Record missing FX valuation rates before comparing scenarios.');
 const from=$('#sc-from').value,to=$('#sc-to').value;
 if(!allMonths().includes(from)||!allMonths().includes(to)||to<from)throw Error('Choose open months inside your plan.');
 const inc=num('#sc-income'),exp=num('#sc-expense');
 if(inc< -100||exp< -100||inc>1000||exp>1000)throw Error('Use percentage changes between -100 and 1000.');
 const oneOff=positive('#sc-once',true),oneOffMonth=$('#sc-month').value;
 if(oneOff&&!allMonths().includes(oneOffMonth))throw Error('Choose an open month for the one-off cost.');
 return {name:$('#sc-name').value.trim()||'Scenario',from,to,incomeFactor:1+inc/100,expenseFactor:1+exp/100,monthlyExtra:num('#sc-extra'),oneOff,oneOffMonth};
}
function scenarioResult(x){
 const rows=D.scenario(C().ms,C().total,C().flow,x).filter(r=>r.month>=x.from),low=rows.reduce((a,b)=>b.scenario<a.scenario?b:a);
 $('#sc-result').innerHTML='<p><b>Lowest projected cash: '+fmt(low.scenario)+' in '+low.month+'</b></p>'+rowsTable(['Month','Main plan','Alternative','Difference'],rows.map(r=>[r.month,fmt(r.baseline),fmt(r.scenario),fmt(r.difference)]));
}
function goals(){
 const list=features('goal'),m=today().slice(0,7);
 return panel('Savings goals','<p>Allocations are earmarks, not new expenses or extra bank balances. Avoid allocating the same money to more than one goal.</p>'+rowsTable(['Goal','Target','Earmarked','Monthly amount needed','Progress',''],list.map(g=>{const x=D.goal(g,m);return [esc(g.name),fmt(g.target),fmt(g.saved),fmt(x.monthly),Math.round(x.progress)+'%',btn('goal-edit','Edit','data-id="'+g.id+'"')];}))+
 '<p>Total earmarked: <b>'+fmt(list.reduce((n,g)=>n+Number(g.saved||0),0))+'</b></p>'+btn('goal-new','Add goal'));
}
function goalModal(g={}){
 A.modal('<h2>'+ (g.id?'Edit':'New')+' savings goal</h2><div class="form">'+field('Name','g-name','text',g.name||'')+field('Target (₹)','g-target','number',g.target||'', 'min="1"')+field('Already earmarked (₹)','g-saved','number',g.saved||0,'min="0"')+field('Target date','g-due','date',g.due||today())+'</div><div class="row">'+btn('goal-save','Save','data-id="'+(g.id||'')+'"')+(g.id?btn('feature-delete','Delete','data-id="'+g.id+'"'):'')+btn('cancel','Cancel')+'</div>');
}
function prepay(){
 const loans=Object.values(S().categories).filter(c=>c.loan?.kind!=='interest'&&Number(c.loan?.outstanding)>0);
 return panel('Loan prepayment comparison','<p>Estimates use the balance, EMI and rate you enter. They exclude lender fees and rate changes. Comparisons do not alter your loan or cash-flow plan.</p><div class="form">'+select('Loan','pp-loan',loans.map(c=>option(c.id,c.name)).join(''))+field('Extra per month (₹)','pp-extra','number',0,'min="0"')+field('Lump sum now (₹)','pp-lump','number',0,'min="0"')+'</div>'+btn('pp-calc','Compare repayments')+'<div id="pp-result"></div>');
}
function calendar(){
 const m=currentMonth(),days=new Date(+m.slice(0,4),+m.slice(5,7),0).getDate(),events=[],cats=Object.values(S().categories),opening={},minimums={};
 for(const a of C().accs){opening[a.id]=C().rows[a.id][m].begin;minimums[a.id]=Number(a.min||0);}
 const due=(c)=>m+'-'+String(Math.min(c.dueDay|| (c.type==='income'?days:1),days)).padStart(2,'0');
 for(const e of Object.values(S().entries))if(e.month===m){const c=S().categories[e.categoryId];if(c)events.push({date:e.date,amount:Number(e.amount),[c.type==='income'?'to':'from']:e.accountId||c.account});}
 for(const c of cats){const actual=Object.values(S().entries).filter(e=>e.month===m&&e.categoryId===c.id);const p=D.categoryProjection({planned:c.amounts?.[m],actual:actual.reduce((n,e)=>n+Number(e.amount),0),hasActual:!!actual.length,closed:A.locked(m),complete:c.completedMonths?.[m],mode:c.forecastMode||'budget'});if(p.remaining)events.push({date:due(c),amount:p.remaining,[c.type==='income'?'to':'from']:c.account});}
 for(const [pm,d]of Object.entries(S().transfers))for(const t of d.items||[]){const x=t.actual;if(x?.date?.slice(0,7)===m)events.push(x);else if(!x&&pm===m&&!A.locked(m))events.push({date:m+'-01',amount:Number(t.amount),from:t.from,to:t.to});}
 for(const t of Object.values(S().fxTransfers||{}))if(t.date.slice(0,7)===m&&(t.status!=='planned'||!A.locked(m))){if(t.from.startsWith('legacy:'))events.push({date:t.date,from:t.from.slice(7),amount:Number(t.sourceAmount)+Number(t.fee||0)});if(t.to.startsWith('legacy:'))events.push({date:t.date,to:t.to.slice(7),amount:Number(t.receivedAmount)});}
 const daily=D.dailyCash({month:m,opening,events,minimums,creditAccounts:C().accs.filter(a=>a.kind==='Credit').map(a=>a.id)}),low=daily.reduce((a,b)=>a.cash<b.cash?a:b),risk=daily.find(r=>r.below.length);
 return panel('Daily cash forecast · '+m,'<p>This table covers legacy INR accounts; use Currency accounts for foreign balances and budgets. Estimated from recorded transactions and the remaining monthly plan. Future opening balances can include earlier projections. Missing dates assume spending on day 1 and income on the last day; planned transfers use day 1. These assumptions can change the result.</p><p>Lowest projected liquid cash: <b>'+fmt(low.cash)+' on '+low.date+'</b>. '+(risk?'First account below its minimum: '+risk.date+' ('+risk.below.map(id=>esc(S().accounts[id]?.name)).join(', ')+').':'No projected minimum-balance shortfall.')+'</p>'+rowsTable(['Plan row','Assumed date',''],cats.map(c=>[esc(c.name),c.dueDay?due(c):due(c)+' (assumed)',btn('due-edit','Set date','data-id="'+c.id+'"')]))+rowsTable(['Date','Liquid cash',...C().accs.map(a=>esc(a.name))],daily.map(r=>[r.date,fmt(r.cash),...C().accs.map(a=>fmt(r.balances[a.id]))])));
}
function importScreen(){
 return panel('Import a bank statement','<p>Use CSV with Date, Description, Amount (expenses negative), or Date, Description, Debit, Credit. Dates: YYYY-MM-DD or DD/MM/YYYY. Import up to 200 rows per batch. Every row is reviewed before saving.</p>'+
 select('Statement account','im-account',accountOpts())+'<label class="f">CSV file<input id="im-file" type="file" accept=".csv,text/csv"></label>'+btn('im-preview','Preview statement')+'<div id="im-preview"></div>');
}
function importOptions(type){
 return Object.values(S().categories).filter(c=>c.type===type).map(c=>option('cat:'+c.id,c.name)).join('')+Object.values(S().accounts).filter(a=>a.id!==$('#im-account').value).map(a=>option('tr:'+a.id,'Transfer '+(type==='income'?'from ':'to ')+a.name)).join('');
}
async function showImport(){
 const f=$('#im-file').files[0];if(!f)throw Error('Choose a CSV file.');if(f.size>5*1024*1024)throw Error('Use a file smaller than 5 MB.');
 const accountId=$('#im-account').value;importAccount=accountId;if(!accountId)throw Error('Add an account first.');
 const existing=new Set(Object.values(S().entries).map(e=>D.fingerprint({...e,accountId:e.accountId||S().categories[e.categoryId]?.account,type:S().categories[e.categoryId]?.type})));
 for(const doc of Object.values(S().transfers))for(const t of doc.items||[]){const x=t.actual;if(!x)continue;existing.add(D.fingerprint({date:x.date,amount:x.amount,accountId:x.from,type:'expense',note:t.ref||''}));existing.add(D.fingerprint({date:x.date,amount:x.amount,accountId:x.to,type:'income',note:t.ref||''}));}
 preview=D.importRows(await f.text());if(preview.length>200)throw Error('Split this statement into batches of at most 200 rows.');
 const seen=new Set();
 preview=preview.map(r=>{const x={...r,accountId},fp=D.fingerprint(x),duplicate=existing.has(fp)||seen.has(fp);seen.add(fp);return {...x,duplicate,fp,recordId:id(),done:false};});
 $('#im-preview').innerHTML=rowsTable(['Include','Date','Description','Amount','Category / transfer'],preview.map((r,i)=>['<input aria-label="Include row '+(i+1)+'" type="checkbox" id="im-use-'+i+'" '+(!r.duplicate&&!A.locked(r.date.slice(0,7))?'checked':'')+' '+(A.locked(r.date.slice(0,7))?'disabled':'')+'>',esc(r.date),esc(r.note)+(r.duplicate?'<br><strong>Possible duplicate — excluded</strong>':''),fmt(r.amount)+' '+r.type,'<select aria-label="Category for row '+(i+1)+'" id="im-cat-'+i+'"><option value="">Choose…</option>'+importOptions(r.type)+'</select>']))+
 '<p>Transfers must be matched manually. A possible duplicate can be included only by explicitly selecting it.</p>'+btn('im-commit','Import selected rows');
}
async function commitImport(){
 if($('#im-account').value!==importAccount)throw Error('Account changed. Preview the statement again.');
 const selected=preview.map((r,i)=>({...r,i,include:$('#im-use-'+i)?.checked,choice:$('#im-cat-'+i)?.value})).filter(r=>r.include&&!r.done);
 if(!selected.length)throw Error('Select at least one row.');
 for(const r of selected){if(!r.choice)throw Error('Choose a category or transfer for every selected row.');if(A.locked(r.date.slice(0,7))||!C().ms.includes(r.date.slice(0,7)))throw Error('All entries must fall in open months inside the plan.');}
 let count=0;
 for(const r of selected){
  const target=r.choice.slice(4),month=r.date.slice(0,7);
  if(r.choice.startsWith('tr:')){
   const other=r.choice.slice(3),from=r.type==='income'?other:r.accountId,to=r.type==='income'?r.accountId:other;
   if(!S().accounts[from]||!S().accounts[to]||from===to)throw Error('Choose different existing accounts.');
   const ref=A.db().doc('transfers/'+month),snap=await ref.get(),old=snap.exists?snap.data():{month,items:[]};
   await save('transfers/'+month,{...old,items:[...(old.items||[]).filter(t=>t.id!==r.recordId),{id:r.recordId,from,to,amount:r.amount,ref:r.note,importFingerprint:r.fp,actual:{from,to,amount:r.amount,date:r.date}}]});
  }else await save('entries/'+r.recordId,{date:r.date,month,categoryId:target,accountId:r.accountId,amount:r.amount,note:r.note,importFingerprint:r.fp,by:A.uid(),createdAt:new Date().toISOString()});
  preview[r.i].done=true;$('#im-use-'+r.i).checked=false;$('#im-use-'+r.i).disabled=true;count++;
 }
 A.toast(count+' rows imported.');preview=[];importDirty=false;navigate('import');
}
function contract(){
 return panel('Contract income and remittances','<p>Generate a monthly income plan for months working and months on leave. Foreign amounts are converted to INR using your entered rate; this is not a live multi-currency ledger.</p><div class="form">'+field('Income name','ct-name','text','Contract salary')+select('Receiving account','ct-account',accountOpts())+field('First working month','ct-start','month',allMonths()[0])+field('Months working','ct-on','number',4,'min="1" max="24"')+field('Months on leave','ct-off','number',2,'min="0" max="24"')+field('Monthly salary in source currency','ct-pay','number','','min="0"')+field('Currency label','ct-currency','text','USD','maxlength="3"')+field('INR per source currency unit','ct-rate','number',83,'min="0.0001" step="0.0001"')+field('Fee per paid month (₹)','ct-fee','number',0,'min="0"')+'</div>'+btn('ct-preview','Preview schedule')+'<div id="ct-result"></div>');
}
function contractInput(){
 const start=$('#ct-start').value,on=positive('#ct-on'),off=positive('#ct-off',true),salary=positive('#ct-pay'),rate=positive('#ct-rate'),fee=positive('#ct-fee',true);
 if(!allMonths().includes(start)||!Number.isInteger(on)||!Number.isInteger(off)||on>24||off>24||salary*rate<fee)throw Error('Check the start month, rotation and fees.');
 const months=allMonths().filter(m=>m>=start),amounts={};months.forEach((m,i)=>amounts[m]=i%(on+off)<on?D.money(salary*rate-fee):0);
 return {name:$('#ct-name').value.trim()||'Contract salary',type:'income',group:'Income',account:$('#ct-account').value,forecastMode:'budget',amounts,sourceCurrency:$('#ct-currency').value.toUpperCase(),sourceAmount:salary,exchangeRate:rate,conversionFee:fee};
}
function security(){
 return panel('Privacy and recovery','<p>Working-ledger encryption is optional. While enabled, the saved ledger and new Drive uploads are encrypted with your passphrase. Unlock after opening the app; use Lock now before leaving a shared device. Earlier plaintext files and backups remain readable until you deliberately migrate or delete them. Encryption does not provide separate family permissions.</p>'+btn('sec-lock','Lock now')+
 '<div class="form">'+field('Working-ledger passphrase (12+ characters)','sec-ledger','password','','autocomplete="new-password"')+field('Confirm working-ledger passphrase','sec-ledger-confirm','password','','autocomplete="new-password"')+'</div>'+btn('sec-enable','Enable working-ledger encryption')+'<p>Export and verify a backup first, then disconnect Drive before enabling encryption. Keep the passphrase separately; a lost passphrase cannot be reset. Use the same passphrase for encrypted sync on your other devices.</p>'+
 '<div class="form">'+field('Backup passphrase (12+ characters)','sec-pass','password','','autocomplete="new-password" minlength="12"')+field('Confirm passphrase','sec-confirm','password','','autocomplete="new-password"')+'</div>'+btn('sec-export','Export encrypted backup')+
 '<p>Keep the passphrase separately. It cannot be recovered by ReadyTrove.</p><hr><label class="f">Encrypted backup<input type="file" id="sec-file" accept=".json"></label>'+field('Restore passphrase','sec-restore-pass','password','','autocomplete="current-password"')+btn('sec-restore','Review restore')+'<div id="sec-result"></div>');
}
function conflicts(){
 const list=Object.entries(window.__cashbookLocal?.conflicts||{});
 return panel('Sync history','<p>Different edits from different devices are retained here for review. The newer field is active; these entries can also include ordinary sequential edits. Export before manually restoring a value through its normal editor.</p>'+
 (list.length?list.map(([key,c],i)=>'<details class="panel pad"><summary>'+esc(c.path)+' · '+esc(c.field)+'</summary><pre style="white-space:pre-wrap">'+esc(JSON.stringify({local:c.local,remote:c.remote},null,2))+'</pre>'+btn('conflict-dismiss','Reviewed','data-key="'+esc(key)+'"')+'</details>').join(''):'<p>No conflicting field history recorded.</p>'));
}
function plans(){
 return panel('Plans and family access','<p><b>Preview release — all current tools are available.</b> No payment will be collected in this build.</p>'+rowsTable(['Proposed plan','Price','Planned package'],[['Free','₹0','Manual tracking, monthly review, backups and exports'],['Plus','₹999/year or ₹129/month','Extended planning, scenarios, imports, business and net-worth tools']])+
 '<p>Encrypted family file exchange uses separate member keys, signed grants and recipient-scoped files. The owner reviews editor proposals; viewers cannot submit changes. Current personal Drive sync is separate and still uses the same Google account. Do not share your Google password.</p><p>Existing records and exports remain available. Purchase and restore adapters with server verification are available in Purchases & restore. Merchant/store accounts and real sandbox validation are still required before activation.</p>');
}
function more(){
 if(screen==='import'&&importDirty&&$('#im-file'))return;
 const active=$('#view'),results={};if(active?.dataset.screen===screen)for(const key of ['pp-result','sc-result']){const el=document.getElementById(key);if(el)results[key]=el.innerHTML;}if(active&&active.dataset.screen===screen){const values={};for(const e of active.querySelectorAll('input[id],select[id],textarea[id]'))if(e.type!=='file'&&e.type!=='password')values[e.id]={value:e.value,checked:e.checked};drafts.set(screen,values);}
 const views={menu,scenarios,goals,prepay,calendar,import:importScreen,contract,security,conflicts,plans,family:()=>CashbookFamilyUI.render(),currency:()=>CashbookCurrencyUI.render(),billing:()=>CashbookBillingUI.render()};$('#view').innerHTML=(views[screen]||menu)();$('#view').dataset.screen=screen;for(const [key,value]of Object.entries(drafts.get(screen)||{})){const e=document.getElementById(key);if(e){e.value=value.value;e.checked=value.checked;}}for(const [key,html]of Object.entries(results)){const el=document.getElementById(key);if(el)el.innerHTML=html;}}
function onboard(){
 A.modal('<h2>Start with the essentials</h2><p>Add a starting balance and monthly income and spending. You can refine individual categories later.</p><div class="form">'+field('Account name','ob-name','text','Main savings')+field('Opening balance at start of month (₹)','ob-balance','number',0)+field('Monthly income (₹)','ob-income','number',0,'min="0"')+field('Monthly household budget (₹)','ob-expense','number',0,'min="0"')+field('Start month','ob-start','month',today().slice(0,7))+'</div><div class="row">'+btn('ob-save','Create my plan')+btn('cancel','Cancel')+'</div>');
}
async function action(t){
 const a=t.dataset.feature;
 if(a==='source-export'){await window.__cashbookLocal.exportSource();A.toast('Source exported. You can now restore a verified backup.');return;}
 if(a==='recover-restore'){const f=$('#recover-file').files[0];if(!f)throw Error('Choose a backup.');if(!confirm('Replace the unreadable ledger with this backup? Export the original source first.'))return;await window.__cashbookLocal.importData(await f.text(),$('#recover-pass').value);location.reload();return;}
 if(a==='unlock'){await window.__cashbookLocal.unlock($('#unlock-pass').value);return;}
 if(a==='sec-enable'){const p=$('#sec-ledger').value;if(p!==$('#sec-ledger-confirm').value)throw Error('Passphrases do not match.');if(!confirm('Enable encryption for future saved copies? Older plaintext backups remain readable. A lost passphrase cannot be recovered.'))return;await window.__cashbookLocal.encryptLedger(p);$('#sec-ledger').value='';$('#sec-ledger-confirm').value='';A.toast('Working ledger encrypted. Keep the passphrase separately.');return;}
 if(a==='sec-lock'){await window.__cashbookLocal.lock();return;}
 if(a==='cancel'){A.close();return;}
 if(['month','loans','networth','business','setup'].includes(a)){A.go(a);return;}
 if(['menu','scenarios','goals','prepay','calendar','import','contract','security','conflicts','plans','family','currency','billing'].includes(a)){navigate(a);return;}
 if(a==='sc-calc'||a==='sc-save'){const x=scenarioInput();scenarioResult(x);if(a==='sc-save'){await save('features/'+id(),{...x,type:'scenario'});A.toast('Scenario saved.');}return;}
 if(a==='sc-load'){const x=S().features[t.dataset.id];for(const [key,v]of Object.entries({'name':x.name,'from':x.from,'to':x.to,'income':(x.incomeFactor-1)*100,'expense':(x.expenseFactor-1)*100,'extra':x.monthlyExtra,'once':x.oneOff,'month':x.oneOffMonth}))$('#sc-'+key).value=v;scenarioResult(x);return;}
 if(a==='goal-new'||a==='goal-edit'){goalModal(S().features[t.dataset.id]);return;}
 if(a==='goal-save'){const due=D.dateISO($('#g-due').value),name=$('#g-name').value.trim();if(!name)throw Error('Name this goal.');await save('features/'+(t.dataset.id||id()),{type:'goal',name,due,target:positive('#g-target'),saved:positive('#g-saved',true)});A.close();navigate('goals');return;}
 if(a==='feature-delete'){if(!confirm('Delete this goal? Its bank balance will not change.'))return;await A.db().doc('features/'+t.dataset.id).delete();A.close();navigate('goals');return;}
 if(a==='pp-calc'){
  const c=S().categories[$('#pp-loan').value];if(!c)throw Error('Add an EMI loan with its outstanding balance first.');
  const extra=positive('#pp-extra',true),lump=positive('#pp-lump',true),base={principal:Number(c.loan.outstanding),rate:Number(c.loan.rate||0),emi:Number(c.loan.emi||c.amounts?.[currentMonth()]||Object.entries(c.amounts||{}).filter(([m,v])=>m>=currentMonth()&&Number(v)>0).sort(([a],[b])=>a.localeCompare(b))[0]?.[1]||Object.entries(c.amounts||{}).filter(([,v])=>Number(v)>0).sort(([a],[b])=>b.localeCompare(a))[0]?.[1]||0)};
  if(!base.emi)throw Error('Enter the EMI in Loans & EMIs or add its monthly plan amount first.');
  const before=D.amortize(base),after=D.amortize({...base,extra,lump});
  $('#pp-result').innerHTML='<p>Comparison uses statement balance '+fmt(base.principal)+', annual interest '+base.rate+'% and monthly payment '+fmt(base.emi)+'. These are estimates from the saved loan details.</p>'+rowsTable(['','Current payments','With prepayment'],[['Months',before.months??'Not repaid',after.months??'Not repaid'],['Interest',fmt(before.interest),fmt(after.interest)]])+'<p>'+ (before.paidOff&&after.paidOff?'Estimated interest saved: <b>'+fmt(before.interest-after.interest)+'</b>.':'Check the payment amount; one schedule does not repay within 600 months.')+'</p><p>Lump sum leaves approximately '+fmt(recorded().cash-lump)+' recorded cash before other commitments.</p>';return;
 }
 if(a==='due-edit'){const c=S().categories[t.dataset.id];A.modal('<h2>Bill timing</h2><p>'+esc(c.name)+'</p>'+field('Day of month','due-day','number',c.dueDay||1,'min="1" max="31"')+select('Forecast behaviour','due-mode',option('budget','Budget: retain expected remaining amount',c.forecastMode!=='bill')+option('bill','Single bill: actual replaces estimate',c.forecastMode==='bill'))+btn('due-save','Save','data-id="'+c.id+'"')+cancel());return;}
 if(a==='due-save'){const day=positive('#due-day');if(!Number.isInteger(day)||day>31)throw Error('Use a day from 1 to 31.');await update('categories/'+t.dataset.id,{dueDay:day,forecastMode:$('#due-mode').value});A.close();navigate('calendar');return;}
 if(a==='im-preview'){await showImport();return;}
 if(a==='im-commit'){await commitImport();return;}
 if(a==='ct-preview'){const x=contractInput();$('#ct-result').innerHTML=rowsTable(['Month','Income in INR'],Object.entries(x.amounts).map(([m,n])=>[m,fmt(n)]))+btn('ct-save','Add this income plan');return;}
 if(a==='ct-save'){const x=contractInput();await save('categories/'+id(),x);A.toast('Contract income plan added.');A.go('plan');return;}
 if(a==='card'){A.modal('<h2>Add a credit card</h2><p>Record purchases as expenses from this card account. Record repayments as bank-to-card transfers, never as another expense.</p>'+field('Card name','cc-name')+field('Outstanding at plan start (₹)','cc-out','number',0,'min="0"')+btn('cc-save','Add card')+cancel());return;}
 if(a==='cc-save'){const name=$('#cc-name').value.trim();if(!name)throw Error('Name the card.');await save('accounts/'+id(),{name,kind:'Credit',opening:-positive('#cc-out',true),min:0,order:99,notes:'Negative balance means amount owed. Repay with a transfer.'});A.close();A.go('setup');return;}
 if(a==='sec-export'){const pass=$('#sec-pass').value;if(pass!==$('#sec-confirm').value)throw Error('Passphrases do not match.');if(pass.length<12)throw Error('Use at least 12 characters.');const result=await window.__cashbookLocal.exportData(pass);if(result==='cancelled')return;$('#sec-pass').value='';$('#sec-confirm').value='';A.toast('Encrypted backup exported.');return;}
 if(a==='sec-restore'){
  const f=$('#sec-file').files[0];if(!f)throw Error('Choose an encrypted backup.');if(f.size>20e6)throw Error('Backup is too large.');
  const raw=await CashbookSecurity.open(await f.text(),$('#sec-restore-pass').value),obj=JSON.parse(raw);
  if(obj.app!=='family-cashbook'||!obj.docs)throw Error('Not a Family Cashbook ledger.');
  if(!confirm('Replace this device’s ledger with '+Object.keys(obj.docs).length+' records? A recovery export of the current ledger will be offered first. The restored ledger will sync to connected devices.'))return;
  await window.__cashbookLocal.importData(raw);$('#sec-restore-pass').value='';A.toast('Backup restored.');A.go('overview');return;
 }
 if(a==='conflict-dismiss'){await window.__cashbookLocal.clearConflict(t.dataset.key);more();return;}
 if(a==='retry-save'){await window.__cashbookLocal.retrySave();return;}
 if(a==='complete'){
  const m=currentMonth();A.modal('<h2>Category complete · '+m+'</h2><p>Mark a budget complete only when no further activity is expected this month.</p>'+select('Category','done-cat',Object.values(S().categories).map(c=>option(c.id,c.name+(c.completedMonths?.[m]?' (complete)':''))).join(''))+select('Status','done-state',option('true','Complete — use actual total')+option('false','Still active — retain remaining budget'))+btn('done-save','Save')+cancel());return;
 }
 if(a==='done-save'){const c=S().categories[$('#done-cat').value],m=currentMonth();if(A.locked(m))throw Error('Reopen the month first.');await update('categories/'+c.id,{completedMonths:{...(c.completedMonths||{}),[m]:$('#done-state').value==='true'}});A.close();A.go('month');return;}
 if(a==='close-month'){
  const m=currentMonth(),first=allMonths()[0];if(m!==first)throw Error('Review and close '+first+' first. Months must be closed in order.');
  if(m>=today().slice(0,7))throw Error('Close a month after it has ended.');
  const missing=C().accs.filter(x=>S().balances[m]?.values?.[x.id]==null||S().balances[m]?.values?.[x.id]==='');
  if(missing.length)throw Error('Enter bank balances for: '+missing.map(x=>x.name).join(', '));
  const end=m+'-'+new Date(+m.slice(0,4),+m.slice(5,7),0).getDate();const fxMissing=window.CashbookCurrency?.reconciliationStatus(S(),m).filter(r=>!r.valid)||[];if(fxMissing.length)throw Error('Reconcile changed/missing currency accounts first: '+fxMissing.map(r=>S().fxAccounts[r.accountId].name).join(', '));
  const actual=A.actualComputed();const reviews=C().accs.map(a=>{const r=actual.rows[a.id][m];return [esc(a.name),fmt(r.calc),fmt(r.actual),fmt(r.diff)];});
  A.modal('<h2>Close '+m+'?</h2><p>Expected balances below use recorded activity only. Check each account independently. Unconfirmed plans will be excluded from the closed month.</p>'+rowsTable(['Account','From recorded activity','Confirmed balance','Difference'],reviews)+field('Reason for any differences','close-reason')+'<label><input type="checkbox" id="close-reviewed"> I reviewed every account balance and any unrecorded difference.</label><p>This locks the month. Only the latest closed month can be reopened.</p>'+btn('close-confirm','Confirm and close','data-month="'+m+'"')+cancel());return;
 }
 if(a==='close-confirm'){
  const m=t.dataset.month;if(m!==allMonths()[0]||m>=today().slice(0,7))throw Error('Month changed; review again.');
  const fxEnd=m+'-'+new Date(+m.slice(0,4),+m.slice(5,7),0).getDate();if(window.CashbookCurrency?.reconciliationStatus(S(),m).some(r=>!r.valid))throw Error('Currency reconciliation changed. Review every account again.');
  if(!$('#close-reviewed').checked)throw Error('Review and confirm every account first.');
  const actual=A.actualComputed(),accounts=C().accs.map(a=>({accountId:a.id,expected:actual.rows[a.id][m].calc,confirmed:Number(S().balances[m]?.values?.[a.id]),difference:actual.rows[a.id][m].diff}));
  if((!accounts.length&&!Object.keys(S().fxAccounts||{}).length)||accounts.some(r=>!Number.isFinite(r.confirmed)||S().balances[m]?.values?.[r.accountId]==null||S().balances[m]?.values?.[r.accountId]===''))throw Error('Enter every account balance.');
  const reason=$('#close-reason').value.trim();if(accounts.some(r=>Math.abs(r.difference)>0.005)&&!reason)throw Error('Explain the differences before closing.');
  const stamp=new Date().toISOString();if(!A.db().applyBatch)throw Error('This adapter does not support atomic month review.');
  await A.db().applyBatch([{type:'set',path:'features/'+id(),data:{type:'audit',action:'month-close',month:m,by:A.uid(),identityType:'local-device',at:stamp,accounts,reason,currencyReconciliations:Object.values(S().fxBalances||{}).filter(r=>r.date.slice(0,7)===m)}},{type:'update',path:'settings/main',data:{closedThrough:m,closedAt:stamp,closedBy:A.uid()}}]);A.close();A.go('month');return;
 }
 if(a==='ob-save'){
  if(S().settings)throw Error('A ledger already exists. Use Accounts & setup to edit it.');
  const start=$('#ob-start').value;if(!/^\d{4}-\d{2}$/.test(start))throw Error('Choose the starting month.');
  const name=$('#ob-name').value.trim();if(!name)throw Error('Name your account.');
  const income=positive('#ob-income',true),expense=positive('#ob-expense',true),balance=num('#ob-balance'),account=id(),months=[];
  for(let i=0;i<24;i++){const d=new Date(start+'-01T12:00:00');d.setMonth(d.getMonth()+i);months.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));}
  if(!A.db().applyBatch)throw Error('This adapter does not support initial setup in one save.');
  const ops=[{type:'set',path:'accounts/'+account,data:{name,opening:balance,min:0,kind:'Savings',order:0}}];
  for(const [label,type,amount]of [['Monthly income','income',income],['Household budget','expense',expense]])if(amount)ops.push({type:'set',path:'categories/'+id(),data:{name:label,type,group:type==='income'?'Income':'Household',account,forecastMode:'budget',amounts:Object.fromEntries(months.map(m=>[m,amount]))}});
  ops.push({type:'set',path:'settings/main',data:{start,end:months.at(-1),currency:'INR'}});await A.db().applyBatch(ops);A.close();A.go('overview');return;
 }
}
document.addEventListener('click',async e=>{
 const t=e.target.closest('[data-feature]');if(!t||!A||t.disabled)return;
 if(operations)return;operations++;t.disabled=true;try{await action(t);}catch(err){A.toast(err.message||'Unable to complete this action.');}finally{operations--;if(t.isConnected)t.disabled=false;A.refresh();}
});
window.addEventListener('cashbook-save',e=>{
 let box=$('#save-status');if(!box){box=document.createElement('div');box.id='save-status';box.setAttribute('role','status');box.style.cssText='padding:6px 16px;background:var(--surface);color:var(--ink);';document.body.prepend(box);}
 const state=e.detail.state;box.innerHTML=state==='error'?'<strong>Not saved:</strong> '+esc(e.detail.message)+' '+btn('retry-save','Retry save'):state==='saving'?'Saving…':'Saved on this device';
});
function lockScreen(){
 $('#view').innerHTML=panel('Unlock Family Cashbook','<p>Your saved ledger is encrypted. Enter its passphrase to open it. ReadyTrove cannot recover a lost passphrase.</p>'+field('Passphrase','unlock-pass','password','','autocomplete="current-password"')+btn('unlock','Unlock'));$('#fab').hidden=true;$('#unlock-pass').focus();
}
document.addEventListener('change',e=>{if(e.target.id==='im-file')importDirty=true;});
function recoveryScreen(){
 $('#view').innerHTML=panel('Saved ledger could not be read','<p>Editing is blocked to protect the original data. Export the unreadable source first, then restore a known backup. Nothing is overwritten until the backup validates.</p>'+btn('source-export','Export original source')+'<label class="f">Verified backup<input type="file" id="recover-file" accept=".json"></label>'+field('Passphrase, for encrypted backups','recover-pass','password')+btn('recover-restore','Restore backup'));$('#fab').hidden=true;
}
window.CashbookUI={reset:()=>{screen="menu";},recoveryScreen,attach:api=>{A=api;window.CashbookFamilyUI?.attach(api);window.CashbookCurrencyUI?.attach(api);window.CashbookBillingUI?.attach(api);},get busy(){return operations>0||!!window.CashbookFamilyUI?.busy||!!window.CashbookCurrencyUI?.busy||!!window.CashbookBillingUI?.busy;},afterRender,more,onboard,lockScreen};
})();
