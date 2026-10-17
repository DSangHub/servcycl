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
  if (user) { await loadProfiles(); await loadBilling(); }
  else { $('billing-status').textContent='Sign in to view your plan.'; $('billing-feedback').textContent=''; $('subscribe-plan').disabled=true; $('manage-plan').classList.add('hidden'); $('plan-choice').classList.remove('hidden'); $('eatery-requests').textContent='Sign in to view requests.'; }
}
async function loadProfiles() {
  const [w,e,c] = await Promise.all([
    db.from('workers').select('name,city,zip,earnings_choice,charity_id,donation_percent').eq('user_id', user.id).maybeSingle(),
    db.from('eateries').select('name,address,city,zip').eq('owner_id', user.id).maybeSingle(),
    db.from('charities').select('name,ein,website,status,registration_fee_status,registration_fee_due_at').eq('owner_id', user.id).maybeSingle()
  ]);
  if (w.data) { $('worker-name').value=w.data.name; $('worker-city').value=w.data.city; $('worker-zip').value=w.data.zip; $('reward').value=w.data.earnings_choice; $('donation-percent').value=w.data.donation_percent || 25; $('selected-charity').value=w.data.charity_id || ''; $('search-location').value=w.data.zip; }
  if (e.data) { $('eatery-name').value=e.data.name; $('eatery-address').value=e.data.address; $('eatery-city').value=e.data.city; $('eatery-zip').value=e.data.zip; }
  if (c.data) { $('charity-name').value=c.data.name; $('charity-ein').value=c.data.ein; $('charity-site').value=c.data.website || ''; $('charity-registration-status').textContent='Verification: '+c.data.status+' · $125 registration: '+c.data.registration_fee_status+' · Due '+new Date(c.data.registration_fee_due_at).toLocaleDateString(); }
  $('charity-choice').classList.toggle('hidden', $('reward').value !== 'donation');
}
$('reward').addEventListener('change', () => $('charity-choice').classList.toggle('hidden', value('reward') !== 'donation'));
$('auth-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!db) return status('Supabase is not connected yet.'); const { error } = await db.auth.signInWithPassword({ email:value('email'), password:value('password') }); if (error) return errorMessage(error); await refreshSession(); status('Signed in.'); });
$('signup').addEventListener('click', async () => { if (!db) return status('Supabase is not connected yet.'); if (!$('auth-form').reportValidity()) return; const { data,error } = await db.auth.signUp({ email:value('email'), password:value('password'), options:{ emailRedirectTo:'https://servcycl.com/' } }); if (error) return errorMessage(error); await refreshSession(); status(data.session ? 'Account created.' : 'Check your email to confirm your account, then sign in.'); });
$('signout').addEventListener('click', async () => { await db.auth.signOut(); user=null; await refreshSession(); status('Signed out.'); });
$('worker-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!requireUser()) return; const donating=value('reward')==='donation';const percentage=donating?Number(value('donation-percent')):0;if(donating&&(!value('selected-charity')||!Number.isInteger(percentage)||percentage<1||percentage>100))return status('Choose a verified charity and a whole percentage from 1 to 100.'); const { error }=await db.from('workers').upsert({user_id:user.id,name:value('worker-name'),city:value('worker-city'),zip:value('worker-zip'),earnings_choice:value('reward'),charity_id:donating?value('selected-charity'):null,donation_percent:percentage},{onConflict:'user_id'}); if(error) return errorMessage(error); status('Worker profile saved.'); });
$('eatery-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!requireUser()) return; const { error }=await db.from('eateries').upsert({owner_id:user.id,name:value('eatery-name'),address:value('eatery-address'),city:value('eatery-city'),zip:value('eatery-zip')},{onConflict:'owner_id'}); if(error) return errorMessage(error); status('Eatery saved. You can now post your shift.'); $('shift-feedback').textContent='Eatery saved. Your shift is ready to post once the fields are complete.'; await loadEateryRequests(); });
$('shift-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const feedback=$('shift-feedback');
  const say=message=>{feedback.textContent=message;};
  if(!requireUser()){say('Sign in before posting a shift.');$('account').scrollIntoView({behavior:'smooth'});return;}
  const button=$('post-shift');
  button.disabled=true;button.textContent='Posting…';say('Checking your eatery profile…');
  try {
    const start=new Date(value('shift-start')),end=new Date(value('shift-end'));
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start<=new Date()||end<=start){say('Choose a future start time and an end after the start.');return;}
    const {data:e,error:lookupError}=await db.from('eateries').select('id').eq('owner_id',user.id).maybeSingle();
    if(lookupError)throw lookupError;
    if(!e){
      say('Save your eatery account first using the business name, address, city and ZIP fields. Then click Post shift again. Your shift details are kept.');
      $('eatery-form').scrollIntoView({behavior:'smooth',block:'center'});
      $('eatery-name').focus({preventScroll:true});return;
    }
    const {error}=await db.from('shifts').insert({eatery_id:e.id,title:value('shift-title'),description:value('shift-description'),starts_at:start.toISOString(),ends_at:end.toISOString(),hourly_cents:Math.round(Number(value('shift-rate'))*100)});
    if(error)throw error;
    $('shift-form').reset();say('Shift posted successfully. Workers can now find it.');
    await loadShifts();await loadEateryRequests();
  } catch(error){say(error?.message||'Unable to post. Check your connection and try again.');}
  finally {button.disabled=false;button.textContent='Post shift';}
});
$('charity-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!requireUser()) return; const file=$('charity-proof').files[0]; if(!file||!['application/pdf','image/png','image/jpeg'].includes(file.type)||file.size>5*1024*1024) return status('Use a PDF, PNG, or JPEG under 5 MB.'); const path=user.id+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9.\-]/g,'_');const {error:uploadError}=await db.storage.from('charity-proofs').upload(path,file,{contentType:file.type});if(uploadError)return errorMessage(uploadError); const {data:existing}=await db.from('charities').select('id,status').eq('owner_id',user.id).maybeSingle();if(existing?.status==='approved')return status('Contact ServCycl to change an approved charity.');const payload={name:value('charity-name'),ein:value('charity-ein'),website:value('charity-site')||null,proof_path:path};const result=existing?await db.from('charities').update(payload).eq('id',existing.id):await db.from('charities').insert({...payload,owner_id:user.id}); if(result.error) return errorMessage(result.error); await loadProfiles(); status('Submitted for 501(c)(3) verification. Registration is $125, due within 30 days or upon your first donation, whichever comes first.'); });
async function loadCharities(){if(!db)return;const {data,error}=await db.from('charities').select('id,name').eq('status','approved').order('name');if(error)return errorMessage(error);$('selected-charity').replaceChildren(new Option('Choose a charity',''),...(data||[]).map(c=>new Option(c.name,c.id)));}
async function loadShifts(){if(!db)return;const location=value('search-location');let query=db.from('shifts').select('id,title,description,starts_at,ends_at,hourly_cents,eateries(name,city,zip)').eq('status','open').gte('starts_at',new Date().toISOString()).order('starts_at').limit(50);const {data,error}=await query;if(error)return errorMessage(error);const rows=(data||[]).filter(s=>!location||s.eateries?.zip===location||s.eateries?.city?.toLowerCase().includes(location.toLowerCase()));const list=$('shifts');list.replaceChildren();if(!rows.length){list.textContent='No upcoming shifts found in this location.';return;}for(const s of rows){const item=document.createElement('article');item.className='shift';const title=document.createElement('strong');title.textContent=s.title;const meta=document.createElement('p');meta.textContent=[s.eateries?.name,s.eateries?.city,new Date(s.starts_at).toLocaleString(),(s.hourly_cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'})+'/hour'].filter(Boolean).join(' · ');const detail=document.createElement('p');detail.textContent=s.description||'';const button=document.createElement('button');button.className='secondary';button.textContent='Accept shift';button.addEventListener('click',async()=>{if(!requireUser())return;const {error}=await db.from('shift_requests').insert({shift_id:s.id,worker_id:user.id});if(error)return errorMessage(error);status('Shift acceptance sent. The eatery will confirm your placement.');});item.append(title,meta,detail,button);list.append(item);}}
$('search').addEventListener('click',loadShifts);
async function loadBilling(){
  if(!db||!user)return;
  const {data:b,error}=await db.from('eatery_billing').select('eatery_id,plan,status,first_selection_at,period_start,period_end,paid_until,quota_start,cancel_at_period_end').eq('owner_id',user.id).maybeSingle();
  const output=$('billing-status');
  if(error){output.textContent='Plan status unavailable. Refresh billing to try again.';$('subscribe-plan').disabled=true;return;}
  if(!b){output.textContent='Save your eatery profile to begin.';$('subscribe-plan').disabled=true;return;}
  const active=b.status==='active'&&b.paid_until&&new Date(b.paid_until)>new Date();
  const {count,error:usageError}=await db.from('eatery_posting_usage').select('shift_id',{count:'exact',head:true}).eq('eatery_id',b.eatery_id).gte('posted_at',b.quota_start);
  const hasSubscription=b.status!=='not_started'&&!['canceled','incomplete_expired'].includes(b.status);
  $('plan-choice').classList.toggle('hidden',hasSubscription);
  $('manage-plan').classList.toggle('hidden',!hasSubscription);
  $('subscribe-plan').disabled=!b.first_selection_at;
  if(b.plan)$('eatery-plan').value=b.plan;
  const usage=usageError?'Posting count unavailable.':(b.plan==='unlimited'&&active?count+' postings this billing month.':count+' of 5 postings used.');
  if(active){output.textContent=(b.plan==='unlimited'?'Unlimited — $20/month. ':'5 postings — $10/month. ')+usage+' '+(b.cancel_at_period_end?'Access ends ':'Next billing date ')+new Date(b.period_end).toLocaleDateString()+'.';}
  else if(hasSubscription){output.textContent='Monthly payment pending or overdue ('+b.status+'). Update payment in Manage plan before posting more shifts. '+usage;}
  else if(b.first_selection_at){output.textContent='Your first worker selection has arrived. Monthly payment is now due. Choose a plan to continue posting. '+usage;}
  else {output.textContent='No payment due until a worker first selects a shift. '+usage;}
}
async function openBilling(body){
  if(!requireUser())return;
  const output=$('billing-feedback');
  const buttons=[$('subscribe-plan'),$('manage-plan'),$('refresh-billing')];
  buttons.forEach(b=>b.disabled=true);output.textContent='Opening billing…';
  try{
    const {data,error}=await db.functions.invoke('eatery-fee-checkout',{body});
    if(error||data?.error){let detail=data?.error;if(!detail&&error?.context){try{detail=(await error.context.json()).error;}catch{}}throw new Error(detail||'Unable to reach billing. Please try again.');}
    if(body.action==='refresh'){await loadBilling();output.textContent='Billing refreshed.';return;}
    if(!data?.url)throw new Error('Billing did not return a checkout link.');
    const target=new URL(data.url);
    if(target.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(target.hostname))throw new Error('Invalid billing URL.');
    window.location.assign(target.href);
  }catch(error){output.textContent=error?.message||'Unable to open billing.';}
  finally {buttons.forEach(b=>b.disabled=false);await loadBilling();}
}
$('subscribe-plan').addEventListener('click',()=>openBilling({plan:value('eatery-plan')}));
$('manage-plan').addEventListener('click',()=>openBilling({action:'portal'}));
$('refresh-billing').addEventListener('click',()=>openBilling({action:'refresh'}));
async function loadEateryRequests(){
  if(!db||!user)return;
  await loadBilling();
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
    const summary=document.createElement('p');summary.textContent='Scheduled worker payout estimate '+(estimated/100).toLocaleString('en-US',{style:'currency',currency:'USD'})+'. Monthly posting plan billed separately.';
    article.append(title,summary);
    if(r.status==='requested'&&new Date(s.starts_at)>new Date()){
      const button=document.createElement('button');button.className='secondary';button.textContent='Confirm worker';
      button.addEventListener('click',async()=>{button.disabled=true;const {error}=await db.rpc('accept_shift_request',{p_request_id:r.id});if(error){button.disabled=false;return errorMessage(error);}status('Worker confirmed. Worker pay is separate from your monthly posting plan.');await loadEateryRequests();await loadShifts();});
      article.append(button);
    }
    list.append(article);
  }
}
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'));
if(new URLSearchParams(window.location.search).has('billing')){show('eatery');$('billing-feedback').textContent='After returning from Stripe, sign in if needed and use Refresh billing to check your subscription.';}
if(configured){db.auth.onAuthStateChange(()=>{setTimeout(()=>refreshSession(),0);});refreshSession();loadCharities();loadShifts();}
