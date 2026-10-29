const test=require('node:test'),assert=require('node:assert/strict');const {harness}=require('./harness.cjs');
function driveHarness({etag=true,race=false,lostAck=false}={}){
 const local={app:'family-cashbook',version:2,docs:{'transfers/2026-08':{month:'2026-08',items:[{id:'local',amount:100,from:'a',to:'b'}]}},times:{'transfers/2026-08':100}};
 let remote={app:'family-cashbook',version:2,docs:{'transfers/2026-08':{month:'2026-08',items:[{id:'remote',amount:200,from:'b',to:'a'}]}},times:{'transfers/2026-08':150}},patches=0;
 const h=harness({initial:local,fetchImpl:async(url,opts={})=>{
  if(url.includes('?q='))return new Response(JSON.stringify({files:[{id:'ledger'}]}),{status:200});
  if(url.includes('alt=media'))return new Response(JSON.stringify(remote),{status:200,headers:etag?{ETag:'"v'+patches+'"'}:{}});
  if(opts.method==='PATCH'){
   patches++;assert.ok(opts.headers['If-Match']);
   if(race&&patches===1){remote.docs['transfers/2026-08'].items.push({id:'race',amount:300});remote.times['transfers/2026-08']=200;return new Response('',{status:412});}
   remote=JSON.parse(opts.body);if(lostAck&&patches===1)throw Error('connection lost after server write');return new Response(JSON.stringify({id:'ledger',version:patches}));
  }
  throw Error('Unexpected test request '+url);
 }});
 h.context.google={accounts:{oauth2:{initTokenClient:opts=>({requestAccessToken(){opts.callback({access_token:'test-token-not-real',expires_in:3600});}})}}};return {...h,getRemote:()=>remote,patches:()=>patches};
}
test('Drive conditional write retries merge distinct transfers after a 412 race',async()=>{const h=driveHarness({race:true});await h.db;await h.api.drive.connect();assert.equal(h.patches(),2);assert.deepEqual(h.getRemote().docs['transfers/2026-08'].items.map(x=>x.id).sort(),['local','race','remote']);});
test('Drive retry after lost acknowledgement preserves transfer IDs',async()=>{const h=driveHarness({lostAck:true});await h.db;await assert.rejects(h.api.drive.connect());await h.api.drive.connect();const items=h.getRemote().docs['transfers/2026-08'].items;assert.equal(items.length,2);assert.equal(new Set(items.map(x=>x.id)).size,2);});
test('Drive refuses blind overwrite when a server precondition is unavailable',async()=>{const h=driveHarness({etag:false});await h.db;await assert.rejects(h.api.drive.connect(),/safe write precondition/);assert.equal(h.patches(),0);const db=await h.db;assert.equal((await db.doc('transfers/2026-08').get()).data().items.length,2);});
