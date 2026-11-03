const test=require('node:test'),assert=require('node:assert/strict'),D=require('../www/domain.js');
const one=(text)=>D.importRows(text)[0];
test('common Indian statement layouts import correctly',()=>{
 const cases={
  shortYear:'Date,Narration,Debit,Credit\n01/04/26,UPI,100,\n',
  hdfc:'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/04/26,UPI,123,01/04/26,100.00,,500.00\n',
  sbi:'Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance\n1 Apr 2026,1 Apr 2026,UPI,,100.00,,500\n',
  icici:'S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )\n1,01/04/2026,01/04/2026,-,UPI,100.00,0.00,500\n',
  axis:'Tran Date,CHQNO,PARTICULARS,DR,CR,BAL\n01-04-2026,,UPI,100.00,,500\n',
  drCr:'Date,Details,Amount,Dr/Cr\n01-Apr-2026,UPI,100.00,DR\n',
  suffix:'Date,Particulars,Transaction Amount\n01-Apr-26,UPI,100.00 Dr\n',
  brackets:'Date,Description,Amount\n01.04.2026,UPI,(100.00)\n',
  time:'Transaction Date,Remarks,Debit,Credit\n01/04/2026 10:22:11,UPI,100,\n'};
 for(const [k,t] of Object.entries(cases))assert.deepEqual([k,one(t).date,one(t).amount,one(t).type,one(t).note],[k,'2026-04-01',100,'expense','UPI']);
});
test('lakh commas, credits and dash cells',()=>{const r=one('Tran Date,Particulars,Debit,Credit\n01-04-2026,Salary,-,"1,00,000.50"\n');assert.deepEqual([r.amount,r.type],[100000.5,'income']);assert.equal(one('Date,Details,Amount,Dr/Cr\n01-Apr-2026,Pay,500,CR\n').type,'income');});
test('titles above the table and totals below it are left out and counted',()=>{const r=D.importRows('State Bank of India\nAccount No,XXXX1234\n\nTxn Date,Description,Debit,Credit,Balance\n01/04/2026,Opening Balance,,,500\n02/04/2026,UPI,100,,400\n,Total,100,0,\nStatement generated on 30/04/2026\n');assert.equal(r.length,1);assert.equal(r[0].note,'UPI');assert.equal(r.skipped,3);});
test('a real mistake still stops the file with its row',()=>{assert.throws(()=>D.importRows('Date,Description,Amount\n31/02/2026,X,5\n'),/row 2/);assert.throws(()=>D.importRows('Date,Description,Amount\n01/02/2026,X,abc\n'),/Invalid amount/);assert.throws(()=>D.importRows('Name,Age\nA,5\n'),/statement table/);});
