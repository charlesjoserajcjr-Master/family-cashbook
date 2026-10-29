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
function dateISO(value){
 const s=String(value).trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/),out=s;
 if(!m){m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(!m)throw Error('Dates must be YYYY-MM-DD or DD/MM/YYYY.');out=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');}
 const d=new Date(out+'T12:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==out)throw Error('Invalid date: '+value);return out;
}
function importRows(text){
 const rows=parseCSV(text);if(rows.length<2)throw Error('Include a header row and at least one transaction.');
 const heads=rows.shift().map(s=>s.trim().toLowerCase().replace(/[^a-z]/g,''));
 const find=names=>heads.findIndex(s=>names.includes(s));
 const date=find(['date','transactiondate','valuedate']),desc=find(['description','narration','particulars','note']);
 const amount=find(['amount','amountinr']),debit=find(['debit','withdrawal','withdrawals']),credit=find(['credit','deposit','deposits']);
 if(date<0||desc<0||(amount<0&&(debit<0||credit<0)))throw Error('Headers needed: Date, Description, Amount (negative for expense); or Date, Description, Debit, Credit.');
 const numeric=s=>{const t=String(s||'').trim().replace(/[,₹\s]/g,'');if(!t)return 0;if(!/^-?\d+(\.\d{1,2})?$/.test(t))throw Error('Invalid amount: '+s);const n=Number(t);if(!Number.isFinite(n)||Math.abs(n)>1e12)throw Error('Amount is too large.');return n;};
 return rows.map((r,i)=>{let value=amount>=0?numeric(r[amount]):numeric(r[credit])-numeric(r[debit]);if(!value)throw Error('Zero amount on row '+(i+2));return {date:dateISO(r[date]),note:r[desc].trim(),amount:money(Math.abs(value)),type:value>0?'income':'expense',sourceRow:i+2};});
}
const fingerprint=r=>JSON.stringify([r.date,r.accountId,money(r.amount),r.type,String(r.note||'').trim().toLowerCase()]);
function goal({target,saved=0,due},month){
 const [y,m]=month.split('-').map(Number),[dy,dm]=due.slice(0,7).split('-').map(Number);
 const left=Math.max(0,money(target-saved)),months=Math.max(1,(dy-y)*12+dm-m+1);
 return {remaining:left,monthly:money(left/months),progress:target>0?Math.min(100,saved/target*100):0};
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
return {dailyCash,money,categoryProjection,amortize,scenario,parseCSV,dateISO,importRows,fingerprint,goal,csvCell};
});
