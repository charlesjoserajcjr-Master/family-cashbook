/* AES-GCM backups. Passwords/derived keys are never persisted. */
(function(root){
'use strict';
const enc=new TextEncoder(),dec=new TextDecoder(),iterations=310000;
const b64=a=>btoa(Array.from(a,b=>String.fromCharCode(b)).join(''));
const un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function key(password,salt,usage){
 if(!root.crypto?.subtle)throw Error('Encryption requires a secure app context (HTTPS or installed app).');
 const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usage);
}
async function seal(text,password){
 if(password.length<12)throw Error('Use a passphrase of at least 12 characters.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(password,salt,['encrypt']),enc.encode(text));
 return JSON.stringify({app:'family-cashbook-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations,salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(data))});
}
async function open(text,password){
 if(typeof text!=='string'||text.length>30e6)throw Error('Encrypted backup is too large.');
 const o=JSON.parse(text);
 if(o.kdf!=='PBKDF2-SHA256'||typeof o.salt!=='string'||typeof o.iv!=='string'||o.salt.length!==24||o.iv.length!==16||o.app!=='family-cashbook-encrypted'||o.version!==1||o.iterations!==iterations||typeof o.data!=='string'||o.data.length>30e6)throw Error('Unsupported encrypted backup.');
 try{return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(o.iv)},await key(password,un64(o.salt),['decrypt']),un64(o.data)));}
 catch(e){throw Error('Incorrect passphrase or damaged backup. Nothing was restored.');}
}
root.CashbookSecurity={seal,open};
})(globalThis);
