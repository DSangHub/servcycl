import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const db = configured ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
let user = null;
const status = (message) => { $('status').textContent = message; };
const value = (id) => $(id).value.trim();
const requireUser = () => { if (user) return true; show('account'); status('Sign in first.'); return false; };
function show(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('hidden', el.id !== view));
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  status('');
  if (view === 'eatery' && user) loadEateryRequests();
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => show(el.dataset.view)));
function errorMessage(error) { status(error?.message || 'Something went wrong. Please try again.'); }
async function refreshSession() {
  if (!db) { $('session').textContent = 'Supabase connection is needed before account creation.'; return; }
  const { data } = await db.auth.getUser();
  user = data.user;
  $('session').textContent = user ? 'Signed in as ' + user.email : 'Sign in to save a profile.';
  $('signout').classList.toggle('hidden', !user);
  if (user) await loadProfiles();
}
async function loadProfiles() {
  const [w,e,c] = await Promise.all([
    db.from('workers').select('name,city,zip,earnings_choice,charity_id').eq('user_id', user.id).maybeSingle(),
    db.from('eateries').select('name,address,city,zip').eq('owner_id', user.id).maybeSingle(),
    db.from('charities').select('name,ein,website,status').eq('owner_id', user.id).maybeSingle()
  ]);
  if (w.data) { $('worker-name').value=w.data.name; $('worker-city').value=w.data.city; $('worker-zip').value=w.data.zip; $('reward').value=w.data.earnings_choice; $('selected-charity').value=w.data.charity_id || ''; $('search-location').value=w.data.zip; }
  if (e.data) { $('eatery-name').value=e.data.name; $('eatery-address').value=e.data.address; $('eatery-city').value=e.data.city; $('eatery-zip').value=e.data.zip; }
  if (c.data) { $('charity-name').value=c.data.name; $('charity-ein').value=c.data.ein; $('charity-site').value=c.data.website || ''; }
  $('charity-choice').classList.toggle('hidden', $('reward').value !== 'donation');
}
$('reward').addEventListener('change', () => $('charity-choice').classList.toggle('hidden', value('reward') !== 'donation'));
$('auth-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!db) return status('Supabase is not connected yet.'); const { error } = await db.auth.signInWithPassword({ email:value('email'), password:value('password') }); if (error) return errorMessage(error); await refreshSession(); status('Signed in.'); });
$('signup').addEventListener('click', async () => { if (!db) return status('Supabase is not connected yet.'); if (!$('auth-form').reportValidity()) return; const { data,error } = await db.auth.signUp({ email:value('email'), password:value('password') }); if (error) return errorMessage(error); await refreshSession(); status(data.session ? 'Account created.' : 'Check your email to confirm your account, then sign in.'); });
$('signout').addEventListener('click', async () => { await db.auth.signOut(); user=null; await refreshSession(); status('Signed out.'); });
$('worker-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!requireUser()) return; if (value('reward') === 'donation' && !value('selected-charity')) return status('Choose a verified charity.'); const { error }=await db.from('workers').upsert({user_id:user.id,name:value('worker-name'),city:value('worker-city'),zip:value('worker-zip'),earnings_choice:value('reward'),charity_id:value('reward')==='donation'?value('selected-charity'):null},{onConflict:'user_id'}); if(error) return errorMessage(error); status('Worker profile saved.'); });
$('eatery-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!requireUser()) return; const { error }=await db.from('eateries').upsert({owner_id:user.id,name:value('eatery-name'),address:value('eatery-address'),city:value('eatery-city'),zip:value('eatery-zip')},{onConflict:'owner_id'}); if(error) return errorMessage(error); status('Eatery saved.'); await loadEateryRequests(); });
$('shift-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!requireUser()) return; const start=new Date(value('shift-start')),end=new Date(value('shift-end')); if (start<=new Date()||end<=start) return status('Enter a future start and an end after the start.'); const {data:e,error:lookupError}=await db.from('eateries').select('id').eq('owner_id',user.id).single(); if(lookupError) return status('Save your eatery first.'); const {error}=await db.from('shifts').insert({eatery_id:e.id,title:value('shift-title'),description:value('shift-description'),starts_at:start.toISOString(),ends_at:end.toISOString(),hourly_cents:Math.round(Number(value('shift-rate'))*100)}); if(error) return errorMessage(error); $('shift-form').reset(); status('Shift posted.'); await loadShifts(); });
$('charity-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!requireUser()) return; const file=$('charity-proof').files[0]; if(!file||!['application/pdf','image/png','image/jpeg'].includes(file.type)||file.size>5*1024*1024) return status('Use a PDF, PNG, or JPEG under 5 MB.'); const path=user.id+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9.\-]/g,'_');const {error:uploadError}=await db.storage.from('charity-proofs').upload(path,file,{contentType:file.type});if(uploadError)return errorMessage(uploadError); const {data:existing}=await db.from('charities').select('id,status').eq('owner_id',user.id).maybeSingle();if(existing?.status==='approved')return status('Contact ServCycl to change an approved charity.');const payload={name:value('charity-name'),ein:value('charity-ein'),website:value('charity-site')||null,proof_path:path};const result=existing?await db.from('charities').update(payload).eq('id',existing.id):await db.from('charities').insert({...payload,owner_id:user.id}); if(result.error) return errorMessage(result.error); status('Submitted for review. Your organization is not listed until approved.'); });
async function loadCharities(){if(!db)return;const {data,error}=await db.from('charities').select('id,name').eq('status','approved').order('name');if(error)return errorMessage(error);$('selected-charity').replaceChildren(new Option('Choose a charity',''),...(data||[]).map(c=>new Option(c.name,c.id)));}
async function loadShifts(){if(!db)return;const location=value('search-location');let query=db.from('shifts').select('id,title,description,starts_at,ends_at,hourly_cents,eateries(name,city,zip)').eq('status','open').gte('starts_at',new Date().toISOString()).order('starts_at').limit(50);const {data,error}=await query;if(error)return errorMessage(error);const rows=(data||[]).filter(s=>!location||s.eateries?.zip===location||s.eateries?.city?.toLowerCase().includes(location.toLowerCase()));const list=$('shifts');list.replaceChildren();if(!rows.length){list.textContent='No upcoming shifts found in this location.';return;}for(const s of rows){const item=document.createElement('article');item.className='shift';const title=document.createElement('strong');title.textContent=s.title;const meta=document.createElement('p');meta.textContent=[s.eateries?.name,s.eateries?.city,new Date(s.starts_at).toLocaleString(),(s.hourly_cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'})+'/hour'].filter(Boolean).join(' · ');const detail=document.createElement('p');detail.textContent=s.description||'';const button=document.createElement('button');button.className='secondary';button.textContent='Request shift';button.addEventListener('click',async()=>{if(!requireUser())return;const {error}=await db.from('shift_requests').insert({shift_id:s.id,worker_id:user.id});if(error)return errorMessage(error);status('Request sent to the eatery.');});item.append(title,meta,detail,button);list.append(item);}}
$('search').addEventListener('click',loadShifts);
async function loadEateryRequests(){
  if(!db||!user)return;
  const list=$('eatery-requests');
  const {data:e,error:eError}=await db.from('eateries').select('id').eq('owner_id',user.id).maybeSingle();
  if(eError)return errorMessage(eError);
  if(!e){list.textContent='Save your eatery to receive shift requests.';return;}
  const {data:shifts,error:sError}=await db.from('shifts').select('id,title,starts_at,ends_at,hourly_cents').eq('eatery_id',e.id).in('status',['open','filled']).order('starts_at',{ascending:false}).limit(50);
  if(sError)return errorMessage(sError);
  const ids=(shifts||[]).map(s=>s.id);
  if(!ids.length){list.textContent='No shift requests yet.';return;}
  const {data:requests,error:rError}=await db.from('shift_requests').select('id,shift_id,status,created_at').in('shift_id',ids).order('created_at',{ascending:false});
  if(rError)return errorMessage(rError);
  list.replaceChildren();
  if(!requests?.length){list.textContent='No shift requests yet.';return;}
  for(const r of requests){
    const s=shifts.find(item=>item.id===r.shift_id);
    const estimated=Math.round((new Date(s.ends_at)-new Date(s.starts_at))/3600000*s.hourly_cents);
    const article=document.createElement('article');article.className='shift';
    const title=document.createElement('strong');title.textContent=s.title+' · '+r.status;
    const summary=document.createElement('p');summary.textContent='Scheduled payout estimate '+(estimated/100).toLocaleString('en-US',{style:'currency',currency:'USD'})+' + $4 ServCycl fee = '+((estimated+400)/100).toLocaleString('en-US',{style:'currency',currency:'USD'})+' eatery total.';
    article.append(title,summary);
    if(r.status==='requested'&&new Date(s.starts_at)>new Date()){
      const button=document.createElement('button');button.className='secondary';button.textContent='Accept request + $4 fee';
      button.addEventListener('click',async()=>{button.disabled=true;const {error}=await db.rpc('accept_shift_request',{p_request_id:r.id});if(error){button.disabled=false;return errorMessage(error);}status('Request accepted. The $4 fee is included in the pending settlement. Payment is not collected yet.');await loadEateryRequests();await loadShifts();});
      article.append(button);
    }
    list.append(article);
  }
}
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
if(configured){db.auth.onAuthStateChange(()=>{refreshSession();});refreshSession();loadCharities();loadShifts();}
