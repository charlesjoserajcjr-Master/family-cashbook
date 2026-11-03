/* Pure calculations shared by the app and regression tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CashbookDomain=api;})(globalThis,()=>{
'use strict';
const money=n=>Math.round((Number(n)||0)*100)/100;
function categoryProjection({planned=0,actual=0,hasActual=false,closed=false,complete=false,mode='budget'}){
 planned=money(planned);actual=money(actual);
 const remaining=closed||complete||(mode==='bill'&&hasActual)?0:Math.max(0,planned-actual);
 return {actual,remaining,total:money(actual+remaining)};
}
function amortize({principal,rate,emi,extra=0,lump=0}){
 if(![principal,rate,emi,extra,lump].every(Number.isFinite))throw Error('Enter finite loan amounts.');
 let balance=money(principal-lump),interest=0,rows=[];
 if(principal<0||rate<0||emi<=0||extra<0||lump<0||lump>principal)throw Error('Check the loan amounts.');
 for(let month=1;balance>0.005&&month<=600;month++){
  const i=money(balance*rate/1200),payment=money(Math.min(emi+extra,balance+i));
  if(payment<=i)return {paidOff:false,rows,interest,months:null};
  balance=money(balance+i-payment);interest=money(interest+i);rows.push({month,payment,interest:i,balance});
 }
 return {paidOff:balance<=0.005,months:balance<=0.005?rows.length:null,interest,rows};
}
function scenario(months,totals,flows,{from,to,incomeFactor=1,expenseFactor=1,monthlyExtra=0,oneOff=0,oneOffMonth}){
 let delta=0;
 return months.map(m=>{
  if(m>=from&&m<=to){const f=flows[m]||{};delta+=Number(f.inc||0)*(incomeFactor-1)-Number(f.exp||0)*(expenseFactor-1)+Number(monthlyExtra||0);}
  if(m===oneOffMonth)delta-=Number(oneOff||0);
  return {month:m,baseline:money(totals[m]),scenario:money(Number(totals[m]||0)+delta),difference:money(delta)};
 });
}
function parseCSV(text){
 if(text.length>5*1024*1024)throw Error('Use a CSV file smaller than 5 MB.');
 const rows=[];let row=[],cell='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell.length)throw Error('Unexpected quote in CSV.');else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(cell);cell='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw Error('An opening quote has no closing quote.');
 if(cell||row.length){row.push(cell);rows.push(row);}
 if(rows.length>5001)throw Error('Import at most 5,000 transactions at a time.');
 return rows;
}
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function dateParts(value){
 const s=String(value).trim().replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?.*$/i,'');
 let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return [m[1],m[2],m[3]];
 m=s.match(/^(\d{1,2})[\/\-. ](\d{1,2}|[a-z]{3,9})[\/\-. ,]+(\d{4}|\d{2})$/i);if(!m)return null;
 const month=/\d/.test(m[2])?m[2]:MONTHS.indexOf(m[2].slice(0,3).toLowerCase())+1;if(!month)return null;
 return [m[3].length===2?'20'+m[3]:m[3],String(month).padStart(2,'0'),m[1].padStart(2,'0')];
}
function dateISO(value){
 const p=dateParts(value);if(!p)throw Error('Dates must be like 31/12/2026, 31-Dec-26 or 2026-12-31.');
 const out=p.join('-'),d=new Date(out+'T12:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==out)throw Error('Invalid date: '+value);return out;
}
const HEADS={
 date:['date','txndate','transactiondate','trandate','transdate','postdate','postingdate','valuedate','valuedt'],
 desc:['description','narration','particulars','details','remarks','transactionremarks','transactiondetails','transactionparticulars','note'],
 amount:['amount','amountinr','transactionamount','transactionamountinr','txnamount','txnamountinr'],
 debit:['debit','debitamount','debitamountinr','debitamt','withdrawal','withdrawals','withdrawalamt','withdrawalamount','withdrawalamountinr','withdrawalinr','dr'],
 credit:['credit','creditamount','creditamountinr','creditamt','deposit','deposits','depositamt','depositamount','depositamountinr','depositinr','cr'],
 drcr:['drcr','crdr','debitcredit','creditdebit','transactiontype','txntype','type']
};
const headIndex=(heads,names)=>{for(const n of names){const i=heads.indexOf(n);if(i>=0)return i;}return -1;};
const emptyCell=t=>!t||/^(-+|na|n\/a|nil)$/i.test(t);
function statementAmount(s){
 let t=String(s??'').trim();if(emptyCell(t))return 0;
 let sign=1;const dc=t.match(/\s*(dr|cr)\.?$/i);if(dc){if(dc[1].toLowerCase()==='dr')sign=-1;t=t.slice(0,dc.index);}
 if(/^\(.*\)$/.test(t)){sign=-1;t=t.slice(1,-1);}
 if(/-$/.test(t)){sign=-1;t=t.slice(0,-1);}
 t=t.replace(/[,₹\s]|^(inr|rs\.?)/gi,'');
 if(!/^[-+]?\d+(\.\d{1,4})?$/.test(t))throw Error('Invalid amount: '+s);
 const n=Number(t)*sign;if(!Number.isFinite(n)||Math.abs(n)>1e12)throw Error('Amount is too large.');return n;
}
/* Banks put titles above the table and totals below it. The table starts at the first row with date, description and amount headings; rows without a date, or with no amount, are skipped and counted. */
function importRows(text){
 const rows=parseCSV(text),clean=r=>r.map(s=>s.trim().toLowerCase().replace(/[^a-z]/g,''));
 let start=-1,c;
 for(let i=0;i<Math.min(rows.length,40)&&start<0;i++){
  const h=clean(rows[i]),x={date:headIndex(h,HEADS.date),desc:headIndex(h,HEADS.desc),amount:headIndex(h,HEADS.amount),debit:headIndex(h,HEADS.debit),credit:headIndex(h,HEADS.credit),drcr:headIndex(h,HEADS.drcr)};
  if(x.date>=0&&x.desc>=0&&(x.amount>=0||(x.debit>=0&&x.credit>=0))){start=i;c=x;}
 }
 if(start<0)throw Error('We could not find the statement table. It needs columns for date, description and amount, or date, description, debit and credit.');
 const out=[];let skipped=0;
 rows.slice(start+1).forEach((r,i)=>{
  const row=start+i+2,cell=k=>c[k]>=0?String(r[c[k]]??''):'';
  if(!dateParts(cell('date'))){skipped++;return;}
  let value=c.amount>=0?statementAmount(cell('amount')):statementAmount(cell('credit'))-statementAmount(cell('debit'));
  if(c.amount>=0&&c.drcr>=0){const k=cell('drcr').trim().toLowerCase();if(/^(dr|d|debit|withdrawal)/.test(k))value=-Math.abs(value);else if(/^(cr|c|credit|deposit)/.test(k))value=Math.abs(value);}
  if(!value){skipped++;return;}
  try{out.push({date:dateISO(cell('date')),note:cell('desc').trim(),amount:money(Math.abs(value)),type:value>0?'income':'expense',sourceRow:row});}catch(e){throw Error(e.message+' (row '+row+')');}
 });
 if(!out.length)throw Error('Include a header row and at least one transaction.');
 out.skipped=skipped;return out;
}
const fingerprint=r=>JSON.stringify([r.date,r.accountId,money(r.amount),r.type,String(r.note||'').trim().toLowerCase()]);
function goal({target,saved=0,due},month){
 const [y,m]=month.split('-').map(Number),[dy,dm]=due.slice(0,7).split('-').map(Number);
 const left=Math.max(0,money(target-saved)),months=Math.max(1,(dy-y)*12+dm-m+1);
 return {remaining:left,monthly:money(left/months),progress:target>0?Math.min(100,saved/target*100):0};
}
/* The next reminders for bills with a due day. Paid, completed and closed months are left out. An income row never reminds. */
function dueReminders({categories,actuals={},closedThrough='',now,before=2,hour=9,monthsAhead=3,limit=60}){
 const list=[],start=new Date(now.getFullYear(),now.getMonth(),1);
 for(const [id,c] of Object.entries(categories)){
  if(c.type==='income'||!c.dueDay)continue;
  for(let i=0;i<=monthsAhead;i++){
   const d=new Date(start.getFullYear(),start.getMonth()+i,1),m=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
   if(closedThrough&&m<=closedThrough)continue;
   const a=actuals[id]?.[m],{remaining}=categoryProjection({planned:c.amounts?.[m]||0,actual:a?.sum||0,hasActual:!!a?.n,complete:!!c.completedMonths?.[m],mode:c.forecastMode||'budget'});
   if(remaining<=0)continue;
   const day=Math.min(c.dueDay,new Date(d.getFullYear(),d.getMonth()+1,0).getDate());
   for(const [k,lead] of [[0,before],[1,0]]){
    const at=new Date(d.getFullYear(),d.getMonth(),day-lead,hour,0,0);if(at.getTime()<=now.getTime()+60000)continue;
    const key=id+m+k;let h=7;for(const ch of key)h=(h*31+ch.charCodeAt(0))|0;
    list.push({id:Math.abs(h)%2000000000+1,name:c.name,at:at.getTime(),when:lead===0?'today':lead===1?'tomorrow':'in '+lead+' days'});
   }
  }
 }
 return list.sort((a,b)=>a.at-b.at).slice(0,limit);
}
const csvCell=s=>'"'+(typeof s==='number'?String(s):String(s??'').replace(/^(?=\s*[=+\-@\t\r\n])/,"'")).replace(/"/g,'""')+'"';
function dailyCash({month,opening,events=[],minimums={},creditAccounts=[]}){
 const days=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate(),balances={...opening},rows=[],cards=new Set(creditAccounts);
 for(let day=1;day<=days;day++){
  const date=month+'-'+String(day).padStart(2,'0');
  for(const e of events.filter(e=>e.date===date)){if(e.from in balances)balances[e.from]=money(balances[e.from]-e.amount);if(e.to in balances)balances[e.to]=money(balances[e.to]+e.amount);}
  rows.push({date,balances:{...balances},cash:money(Object.entries(balances).filter(([id])=>!cards.has(id)).reduce((n,[,v])=>n+v,0)),below:Object.keys(balances).filter(id=>!cards.has(id)&&balances[id]<Number(minimums[id]||0))});
 }
 return rows;
}
return {dueReminders,dailyCash,money,categoryProjection,amortize,scenario,parseCSV,dateISO,importRows,fingerprint,goal,csvCell};
});
