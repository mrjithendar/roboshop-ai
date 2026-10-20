import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const root=new URL('../dist/',import.meta.url);
const html=await readFile(new URL('profile.html',root),'utf8');
const script=(await Promise.all(['paths.js','account.js','profile.js'].map(async file=>(await readFile(new URL(file,root),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url',JSON.stringify('https://shop.example/roboshop/paths.js'))))).join('\n');
const user={id:'alice',name:'Alice <script>bad</script>',email:'alice@example.com',role:'customer',disabled:false};
const profile={user,details:{company:'Robotics'},photo:'',activity:{lastLoginAt:'2026-10-19T12:00:00Z',lastLoginIp:'192.0.2.1'},addresses:[],memberSince:'2026-10-01T12:00:00Z'};
async function waitFor(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('UI did not settle');}
function setup(t,handler=()=>undefined){
 const dom=new JSDOM(html,{url:'https://shop.example/roboshop/account',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls=[];w.fetch=async(path,options={})=>{
  assert.ok(path.startsWith('/roboshop/api/'));const endpoint=path.slice('/roboshop'.length);calls.push({endpoint,options});
  const custom=await handler(endpoint,options);if(custom)return custom;
  const payloads={'/api/auth/me':{user},'/api/account/profile':profile,'/api/account/purchases':{purchases:[],next:null},'/api/account/activity':{events:[],retentionDays:90},'/api/shipping/countries':{countries:[]},'/api/auth/logout':{loggedOut:true}};
  assert.ok(Object.hasOwn(payloads,endpoint),'Unexpected '+endpoint);return{ok:true,status:200,json:async()=>payloads[endpoint]};
 };
 return{w,calls,$:s=>w.document.querySelector(s),boot:()=>w.eval(`(async()=>{${script}\n})()`)};
}
test('account page renders private profile safely under the ingress prefix',async t=>{
 const ui=setup(t);await ui.boot();assert.equal(ui.$('#profile-content').hidden,false);
 assert.equal(ui.$('#account-button').textContent,'Account');
 assert.ok(!ui.$('.store-header').textContent.includes(user.name));
 assert.ok(ui.$('#profile-display-name').textContent.includes('<script>'));assert.equal(ui.$('#profile-display-name script'),null);
 assert.equal(ui.$('#profile-company').value,'Robotics');assert.match(ui.$('#profile-orders').textContent,/No completed/);
});
test('profile save submits only editable fields and retains confirmation',async t=>{
 let submitted;const ui=setup(t,(path,options)=>{if(path==='/api/account/profile'&&options.method==='PUT'){submitted=JSON.parse(options.body);return{ok:true,json:async()=>({...profile,user:{...user,name:submitted.name},details:submitted})};}});
 await ui.boot();ui.$('#profile-name').value='Updated';ui.$('#profile-form').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));
 await waitFor(()=>ui.$('#profile-save-status').textContent.includes('saved'));
 assert.equal(submitted.name,'Updated');assert.equal(submitted.role,undefined);assert.equal(submitted.email,undefined);assert.equal(ui.$('#profile-display-name').textContent,'Updated');
});
test('guest sees login instead of private data and logout clears profile',async t=>{
 const guest=setup(t,path=>path==='/api/auth/me'?{ok:true,json:async()=>({user:null})}:undefined);await guest.boot();
 assert.equal(guest.$('#profile-login').hidden,false);assert.ok(!guest.calls.some(c=>c.endpoint==='/api/account/profile'));
 assert.equal(guest.$('#account-dialog'),null);assert.match(guest.$('#account-button').getAttribute('href'),/^\/roboshop\/login\?returnTo=/);
 const ui=setup(t);await ui.boot();ui.$('#logout-button').click();await waitFor(()=>!ui.$('#profile-login').hidden);
 assert.equal(ui.$('#profile-display-name').textContent,'');assert.equal(ui.$('#profile-content').hidden,true);assert.equal(ui.$('#profile-company').value,'');
});
test('invalid upload is rejected before sending photo data',async t=>{
 const ui=setup(t);await ui.boot();Object.defineProperty(ui.$('#photo-file'),'files',{value:[new ui.w.File(['<svg>'],'photo.svg',{type:'image/svg+xml'})]});
 ui.$('#photo-file').dispatchEvent(new ui.w.Event('change'));await waitFor(()=>ui.$('#photo-status').textContent.includes('Choose a JPEG'));
 assert.ok(!ui.calls.some(c=>c.endpoint==='/api/account/photo'));
});

test('authenticator setup shows QR and one-time backup codes, logout clears secrets',async t=>{
 const ui=setup(t,(path,options)=>{
  const responses={'/api/auth/mfa':{enabled:false,available:true,backupCodesRemaining:0},'/api/auth/mfa/enroll':{secret:'TESTKEY',qr:'data:image/png;base64,AA=='},'/api/auth/mfa/confirm':{backupCodes:['backup-one','backup-two']}};
  if(responses[path])return{ok:true,json:async()=>responses[path]};
 });
 await ui.boot();ui.$('#mfa-manage').click();await waitFor(()=>!ui.$('#mfa-setup').hidden);
 ui.$('#mfa-password').value='current password';ui.$('#mfa-setup').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));
 await waitFor(()=>!ui.$('#mfa-confirm').hidden);assert.equal(ui.$('#mfa-key').textContent,'TESTKEY');assert.equal(ui.$('#mfa-password').value,'');
 ui.$('#mfa-confirm-code').value='123456';ui.$('#mfa-confirm').dispatchEvent(new ui.w.Event('submit',{cancelable:true}));
 await waitFor(()=>!ui.$('#mfa-backup').hidden);assert.match(ui.$('#mfa-backup-codes').textContent,/backup-one/);assert.equal(ui.$('#mfa-key').textContent,'');
 ui.$('#logout-button').click();await waitFor(()=>!ui.$('#profile-login').hidden);assert.equal(ui.$('#mfa-backup-codes').textContent,'');
});
