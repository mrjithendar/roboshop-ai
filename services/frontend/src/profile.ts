import { appPath } from './paths.js';
import { initAccount, currentUser, showLogin, type User } from './account.js';

interface Details { phone?: string; company?: string; jobTitle?: string; bio?: string; countryCode?: string; timezone?: string }
interface Address { id: string; address: {recipient: string; line1: string; postalCode?: string}; city: {name: string; country: string} }
interface Profile { user: User; details: Details; photo: string; memberSince?: string; activity: {lastLoginAt?: string; lastLoginIp?: string}; addresses: Address[] }
interface Purchase {id: string; paidAt: string; total: number; currency: string; paymentMode?: string; items: {name: string; quantity: number}[]}
interface History {purchases: Purchase[]; next: string | null}
interface Activity {retentionDays: number; events: {occurredAt: string; ipAddress?: string; userAgent?: string}[]}
const control = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id); if (!node) throw new Error(`Missing control ${id}`); return node as T;
};
const input = (id: string) => control<HTMLInputElement>(id);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Request failed. Please try again.';
const node = (tag: string, text: string) => { const n = document.createElement(tag); n.textContent = text; return n; };
const date = (value?: string) => value ? new Date(value).toLocaleString() : 'Not available';
let generation = 0, next: string | null = null, searchVersion = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
function clearPrivate() {
  control('profile-content').hidden = true;
  for (const id of ['profile-display-name','profile-email','profile-member','profile-last-login','profile-orders','profile-activity','address-list']) control(id).replaceChildren();
  control<HTMLImageElement>('profile-photo').removeAttribute('src');
  control<HTMLFormElement>('profile-form').reset(); control<HTMLFormElement>('address-form').reset();
  control('profile-save-status').textContent = ''; control('photo-status').textContent = '';
}
async function request<T>(path: string, method = 'GET', data?: object): Promise<T> {
  const response = await fetch(appPath(path), {method, headers:{'content-type':'application/json'}, ...(data ? {body:JSON.stringify(data)}:{}), signal:AbortSignal.timeout(25000)});
  const result = await response.json();
  if (response.status === 401) { generation++; clearPrivate(); control('profile-login').hidden = false; }
  if (!response.ok) throw new Error(result.error || 'The service is unavailable. Please try again.');
  return result;
}
function photo(value: string) {
  const image = control<HTMLImageElement>('profile-photo'); image.hidden = !value;
  if (value) image.src = value; else image.removeAttribute('src');
  control('profile-initials').hidden = Boolean(value);
  control('profile-initials').textContent = (currentUser?.name || '').trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
  control<HTMLButtonElement>('photo-remove').disabled = !value;
}
function details(profile: Pick<Profile,'user'|'details'>) {
  if (currentUser) currentUser.name = profile.user.name;
  control('profile-display-name').textContent = profile.user.name;
  control('profile-initials').textContent = profile.user.name.trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase();
  control('profile-email').textContent = profile.user.email;
  control('account-button').textContent = 'Account';
  input('profile-name').value = profile.user.name;
  for (const key of ['phone','company','jobTitle','bio','countryCode','timezone'] as const) input('profile-'+key).value = profile.details[key] || '';
}
function addresses(rows: Address[]) {
  const list = control('address-list'); list.replaceChildren();
  for (const address of rows) {
    const card = node('article',''); card.className = 'profile-address';
    card.append(node('h3',address.address.recipient),node('p',address.address.line1),node('p',`${address.city.name}, ${address.city.country} ${address.address.postalCode || ''}`));
    const button = node('button','Remove address') as HTMLButtonElement; button.className='text-button'; button.type='button';
    button.addEventListener('click',async()=>{
      const version=generation; button.disabled=true;
      try { await request('/api/account/addresses/'+encodeURIComponent(address.id),'DELETE'); if(version===generation) {card.remove(); control('address-status').textContent='Address removed.';} }
      catch(e){if(version===generation)control('address-status').textContent=errorText(e);}
      finally{button.disabled=false;}
    });card.append(button);list.append(card);
  }
  if(!rows.length)list.append(node('p','No saved addresses yet. Add one below or save an address during checkout.'));
}
function orders(history: History) {
  for(const purchase of history.purchases){
    const card=node('article','');card.className='profile-order';
    card.append(node('h3',`Order ${purchase.id.slice(0,8)}`),node('p',date(purchase.paidAt)),node('strong',new Intl.NumberFormat(undefined,{style:'currency',currency:purchase.currency}).format(purchase.total)));
    const list=node('ul','');for(const item of purchase.items)list.append(node('li',`${item.name} × ${item.quantity}`));card.append(list);
    if(purchase.paymentMode==='test')card.append(node('small','Test payment'));
    control('profile-orders').append(card);
  }
  next=history.next;control('orders-more').hidden=!next;
  if(!control('profile-orders').children.length)control('profile-orders').append(node('p','No completed purchases yet. Confirmed orders will appear here.'));
}
async function load() {
  const version=++generation;clearPrivate();control('profile-error').hidden=true;control('profile-login').hidden=Boolean(currentUser);
  if(!currentUser)return;
  try{
    const [profile,history,activity]=await Promise.all([request<Profile>('/api/account/profile'),request<History>('/api/account/purchases'),request<Activity>('/api/account/activity')]);
    if(version!==generation)return;
    details(profile);photo(profile.photo || '');addresses(profile.addresses);orders(history);
    control('profile-member').textContent=profile.memberSince?`Member since ${new Date(profile.memberSince).toLocaleDateString()}`:'';
    control('profile-last-login').textContent=`Last login: ${date(profile.activity.lastLoginAt)} · IP: ${profile.activity.lastLoginIp || 'Not available'}`;
    control('activity-retention').textContent=`Recent sign-ins are retained for ${activity.retentionDays} days.`;
    for(const event of activity.events){const row=node('article','');row.className='profile-login-event';row.append(node('strong',date(event.occurredAt)),node('p',event.ipAddress || 'Unknown IP'),node('small',event.userAgent || 'Browser not available'));control('profile-activity').append(row);}
    if(!activity.events.length)control('profile-activity').append(node('p','No recent sign-ins recorded.'));
    control('profile-content').hidden=false;
  }catch(e){if(version===generation){control('profile-error').hidden=false;control('profile-error-text').textContent=errorText(e);}}
}
control('profile-signin').addEventListener('click',showLogin);
control('profile-retry').addEventListener('click',load);
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button=>button.addEventListener('click',()=>control<HTMLDialogElement>(button.dataset.close!).close()));
control('profile-form').addEventListener('submit',async event=>{
  event.preventDefault(); const version=generation; const button=control<HTMLButtonElement>('profile-save');button.disabled=true;control('profile-save-status').textContent='Saving…';
  const data: Record<string,string>={name:input('profile-name').value};
  for(const key of ['phone','company','jobTitle','bio','countryCode','timezone'])data[key]=input('profile-'+key).value;
  data.countryCode=data.countryCode.toUpperCase();
  try{const result=await request<Profile>('/api/account/profile','PUT',data);if(version===generation){details(result);control('profile-save-status').textContent='Your profile has been saved.';}}
  catch(e){if(version===generation)control('profile-save-status').textContent=errorText(e);}
  finally{button.disabled=false;}
});
async function savePhoto(value: string, version: number) {
  const result=await request<{photo:string}>('/api/account/photo','PUT',{image:value});
  if(version===generation){photo(result.photo);control('photo-status').textContent=value?'Profile photo updated.':'Profile photo removed.';}
}
input('photo-file').addEventListener('change',async()=>{
  const version=generation,file=input('photo-file').files?.[0];if(!file)return;
  input('photo-file').disabled=true;control('photo-status').textContent='Processing photo…';
  try{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a JPEG, PNG or WebP image smaller than 5 MB.');
    const bitmap=await createImageBitmap(file);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const ctx=canvas.getContext('2d');if(!ctx){bitmap.close();throw new Error('Image processing is unavailable in this browser.');}
    ctx.fillStyle='#fff';ctx.fillRect(0,0,128,128);
    const size=Math.min(bitmap.width,bitmap.height);ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,128,128);bitmap.close();
    let quality=.8,value=canvas.toDataURL('image/jpeg',quality);
    while(value.length>12000&&quality>.2){quality-=.15;value=canvas.toDataURL('image/jpeg',quality);}
    if(value.length>12000)throw new Error('Choose a less detailed image.');
    if(version===generation)await savePhoto(value,version);
  }catch(e){if(version===generation)control('photo-status').textContent=errorText(e);}
  finally{input('photo-file').disabled=false;input('photo-file').value='';}
});
control('photo-remove').addEventListener('click',async()=>{const version=generation;const button=control<HTMLButtonElement>('photo-remove');button.disabled=true;try{await savePhoto('',version);}catch(e){if(version===generation)control('photo-status').textContent=errorText(e);button.disabled=false;}});
control('orders-more').addEventListener('click',async()=>{
  if(!next)return;const version=generation;const button=control<HTMLButtonElement>('orders-more');button.disabled=true;
  try{const result=await request<History>('/api/account/purchases?'+new URLSearchParams({cursor:next}));if(version===generation)orders(result);}
  catch(e){if(version===generation)control('orders-status').textContent=errorText(e);}finally{button.disabled=false;}
});
control('address-country').addEventListener('change',()=>{searchVersion++;clearTimeout(searchTimer);input('address-search').value='';control<HTMLSelectElement>('address-city').replaceChildren(new Option('Select a search result',''));});
input('address-search').addEventListener('input',()=>{
  clearTimeout(searchTimer);const version=++searchVersion;const country=control<HTMLSelectElement>('address-country').value,q=input('address-search').value.trim();
  control<HTMLSelectElement>('address-city').replaceChildren(new Option('Select a search result',''));
  if(!country||q.length<2)return;
  searchTimer=setTimeout(async()=>{try{const result=await request<{cities:{id:number;name:string;region?:string}[]}>('/api/shipping/cities?'+new URLSearchParams({country,q}));if(version!==searchVersion)return;for(const city of result.cities)control<HTMLSelectElement>('address-city').append(new Option(`${city.name} · ${city.region||country}`,String(city.id)));control('address-status').textContent=result.cities.length?'Select your city.':'No matching cities.';}catch(e){if(version===searchVersion)control('address-status').textContent=errorText(e);}},300);
});
control('address-form').addEventListener('submit',async event=>{
  event.preventDefault();const version=generation;const button=control<HTMLButtonElement>('address-save');button.disabled=true;
  try{const result=await request<{addresses:Address[]}>('/api/account/addresses','POST',{cityId:Number(control<HTMLSelectElement>('address-city').value),recipient:input('address-recipient').value,line1:input('address-line1').value,postalCode:input('address-postcode').value});if(version===generation){addresses(result.addresses);control('address-status').textContent='Address saved.';control<HTMLFormElement>('address-form').reset();control<HTMLSelectElement>('address-city').replaceChildren(new Option('Select a search result',''));}}
  catch(e){if(version===generation)control('address-status').textContent=errorText(e);}finally{button.disabled=false;}
});
await initAccount(load);
await load();
request<{countries:{code:string;name:string;cityCount:number}[]}>('/api/shipping/countries').then(result=>{for(const country of result.countries){const option=new Option(country.name,country.code);option.disabled=!country.cityCount;control<HTMLSelectElement>('address-country').append(option);}}).catch(()=>{control('address-status').textContent='Address search is unavailable. Reload to try again.';});
