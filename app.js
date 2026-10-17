import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const db = configured ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
let user = null;
let pendingView = null;
let smsReady=false;
let recoveringPassword = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
const status = (message) => { $('status').textContent = message; };
const value = (id) => $(id).value.trim();
const requireUser = () => { if (user) return true; show('account'); status('Sign in first.'); return false; };
function show(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('hidden', el.id !== view));
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  status('');
  if (view === 'eatery' && user) loadEateryRequests();
  if (view === 'available') {loadAvailableWorkers();loadMembership();if(user)loadPortfolio(user.id,$('my-portfolio'));}
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => show(el.dataset.view)));
function errorMessage(error) { status(error?.message || 'Something went wrong. Please try again.'); }
async function refreshSession() {
  if (!db) { $('session').textContent = 'Supabase connection is needed before account creation.'; return; }
  const { data } = await db.auth.getUser();
  user = data.user;
  $('session').textContent = user ? 'Signed in as ' + user.email : 'Sign in to save a profile.';
  $('signout').classList.toggle('hidden', !user);
  $('availability-signin').classList.toggle('hidden',Boolean(user));
  $('availability-session').textContent=user?'Signed in. Check Available and save when you are ready to work.':'Sign in or create an account, then save your availability.';
  if (user) { await loadProfiles(); await loadBilling(); await loadMembership(); await loadPortfolio(user.id,$('my-portfolio')); }
  else { $('membership-status').textContent='Sign in to view your membership.';$('my-portfolio').textContent='Sign in to view your portfolio.';$('member-phone').value='';$('phone-code').value='';$('member-sms-optin').checked=false;$('portfolio-dialog').close(); $('available-workers').textContent='Sign in to view availability.'; $('available-checkbox').checked=false; $('billing-status').textContent='Sign in to view your plan.'; $('billing-feedback').textContent=''; $('subscribe-plan').disabled=true; $('manage-plan').classList.add('hidden'); $('plan-choice').classList.remove('hidden'); $('eatery-requests').textContent='Sign in to view requests.'; }
}
async function loadProfiles() {
  const [w,e,c] = await Promise.all([
    db.from('workers').select('name,city,zip,earnings_choice,charity_id,donation_percent').eq('user_id', user.id).maybeSingle(),
    db.from('eateries').select('name,address,city,zip').eq('owner_id', user.id).maybeSingle(),
    db.from('charities').select('name,ein,website,status,registration_fee_status,registration_fee_due_at').eq('owner_id', user.id).maybeSingle()
  ]);
  if(w.error)return errorMessage(w.error);
  if(!w.data&&user.user_metadata?.name&&/^[0-9]{5}$/.test(user.user_metadata?.zip||'')){
    const {error}=await db.rpc('save_worker_availability',{p_name:user.user_metadata.name,p_zip:user.user_metadata.zip,p_available:user.user_metadata.available===true});
    if(error)errorMessage(error);
    else w.data={name:user.user_metadata.name,zip:user.user_metadata.zip,city:'',earnings_choice:'cash'};
  }
  if(w.data){$('available-name').value=w.data.name;$('available-zip').value=w.data.zip;$('account-name').value=w.data.name;$('account-zip').value=w.data.zip;
    const {data:a,error:aError}=await db.from('available').select('is_available').eq('worker_id',user.id).maybeSingle();
    if(aError)$('availability-feedback').textContent=aError.message;else $('available-checkbox').checked=Boolean(a?.is_available);
  }
  if (w.data) { $('worker-name').value=w.data.name; $('worker-city').value=w.data.city; $('worker-zip').value=w.data.zip; $('reward').value=w.data.earnings_choice; $('donation-percent').value=w.data.donation_percent || 25; $('selected-charity').value=w.data.charity_id || ''; $('search-location').value=w.data.zip; }
  if (e.data) { $('eatery-name').value=e.data.name; $('eatery-address').value=e.data.address; $('eatery-city').value=e.data.city; $('eatery-zip').value=e.data.zip; }
  if (c.data) { $('charity-name').value=c.data.name; $('charity-ein').value=c.data.ein; $('charity-site').value=c.data.website || ''; $('charity-registration-status').textContent='Verification: '+c.data.status+' · $125 registration: '+c.data.registration_fee_status+' · Due '+new Date(c.data.registration_fee_due_at).toLocaleDateString(); }
  $('charity-choice').classList.toggle('hidden', $('reward').value !== 'donation');
}
$('availability-signin').addEventListener('click',()=>{pendingView='available';});
$('availability-form').addEventListener('submit',async ev=>{
  ev.preventDefault();
  if(!user){$('account-name').value=value('available-name');$('account-zip').value=value('available-zip');$('signup-available').checked=$('available-checkbox').checked;pendingView='available';requireUser();return;}
  const button=$('save-availability');button.disabled=true;
  try{
    const {error}=await db.rpc('save_worker_availability',{p_name:value('available-name'),p_zip:value('available-zip'),p_available:$('available-checkbox').checked});
    if(error)throw error;
    $('availability-feedback').textContent=$('available-checkbox').checked?'You are now listed as Available.':'You are no longer listed as Available.';
    await loadProfiles();await loadAvailableWorkers();
  }catch(error){$('availability-feedback').textContent=error?.message||'Unable to save availability.';}
  finally{button.disabled=false;}
});
$('search-available').addEventListener('click',loadAvailableWorkers);
async function loadAvailableWorkers(){
  const list=$('available-workers');list.replaceChildren();
  if(!db||!user){list.textContent='Sign in to view availability.';return;}
  const {data:e,error:eError}=await db.from('eateries').select('id').eq('owner_id',user.id).maybeSingle();
  if(eError){list.textContent='Unable to check your eatery account. Please try again.';return;}
  if(!e){list.textContent='Save your eatery account in Eateries to view available workers.';return;}
  const zip=value('available-search-zip');
  if(zip&&!/^[0-9]{5}$/.test(zip)){list.textContent='Enter a 5-digit ZIP code, or leave it blank to see all.';return;}
  let query=db.from('available').select('worker_id,name,zip,updated_at').eq('is_available',true).order('updated_at',{ascending:false}).limit(100);
  if(zip)query=query.eq('zip',zip);
  const {data,error}=await query;
  if(error){list.textContent='Unable to load available workers. Please try again.';return;}
  if(!data?.length){list.textContent='No workers have marked themselves available'+(zip?' in this ZIP code':'')+'.';return;}
  for(const worker of data){const item=document.createElement('article');item.className='shift';const name=document.createElement('strong');name.textContent=worker.name;const detail=document.createElement('p');detail.textContent='ZIP '+worker.zip+' · Available';const portfolio=document.createElement('button');portfolio.type='button';portfolio.className='secondary';portfolio.textContent='View portfolio';portfolio.addEventListener('click',()=>openWorkerPortfolio(worker.worker_id));item.append(name,detail,portfolio);list.append(item);}
}
async function loadMembership(){
  if(!db||!user)return;
  const {data:m,error}=await db.from('worker_memberships').select('phone,phone_verified,sms_optin,joined_at').eq('worker_id',user.id).maybeSingle();
  if(error){$('membership-status').textContent='Membership unavailable. Try again.';return;}
  if(!m){$('membership-status').textContent='Save your worker profile or availability to become a member.';return;}
  $('member-phone').value=m.phone||'';$('member-sms-optin').checked=m.sms_optin;
  try{const response=await fetch(SUPABASE_URL+'/functions/v1/member-sms');smsReady=response.ok&&(await response.json()).ready;}catch{smsReady=false;}
  $('send-phone-code').disabled=!smsReady;$('check-phone-code').disabled=!smsReady;
  $('member-sms-optin').disabled=!smsReady||!m.phone_verified;
  $('membership-status').textContent='Worker member since '+new Date(m.joined_at).toLocaleDateString()+'. '+(!smsReady?'Text alerts are awaiting setup. Your portfolio is available now.':m.sms_optin?'Text alerts are on for new postings in your worker ZIP code.':m.phone_verified?'Phone verified. Check the text alerts box and save to opt in.':'Verify a mobile number to turn on shift texts.');
}
function memberPhone(){
 const digits=value('member-phone').replace(/\D/g,'');if(!digits)return null;
 const phone='+'+(digits.length===10?'1'+digits:digits);
 if(!/^\+1[2-9][0-9]{9}$/.test(phone))throw new Error('Enter a valid US mobile number.');return phone;
}
$('membership-form').addEventListener('submit',async ev=>{
 ev.preventDefault();if(!requireUser())return;
 const button=$('save-membership');button.disabled=true;
 try{
  const phone=memberPhone(),optin=$('member-sms-optin').checked;
  if(optin&&!smsReady)throw new Error('Text alerts are awaiting setup. You can remain a member without texts.');
  const {data,error}=await db.from('worker_memberships').update({phone,sms_optin:optin}).eq('worker_id',user.id).select('worker_id');
  if(error)throw error;if(!data?.length)throw new Error('Save your worker profile or availability first.');
  await loadMembership();$('membership-feedback').textContent='Text preferences saved. '+($('member-sms-optin').checked?'New shift alerts are on.':'Text alerts are off.');
 }catch(error){$('membership-feedback').textContent=error?.message||'Unable to save text preferences.';}
 finally{button.disabled=false;}
});
async function verifyMemberPhone(action){
 if(!requireUser())return;
 const button=$(action==='send'?'send-phone-code':'check-phone-code');button.disabled=true;
 try{
  const phone=memberPhone();if(!phone)throw new Error('Enter your mobile number first.');
  const {data,error}=await db.functions.invoke('member-sms',{body:{action,phone,code:value('phone-code')}});
  if(error||data?.error){let detail=data?.error;if(!detail&&error?.context){try{detail=(await error.context.json()).error;}catch{}}throw new Error(detail||'Unable to verify your phone.');}
  if(action==='check'){await loadMembership();$('phone-code').value='';}
  $('membership-feedback').textContent=action==='send'?'Verification code sent. Enter it above.':'Phone verified. Check the text alerts box and save to opt in.';
 }catch(error){$('membership-feedback').textContent=error?.message||'Unable to verify your phone.';}
 finally{button.disabled=!smsReady;}
}
$('send-phone-code').addEventListener('click',()=>verifyMemberPhone('send'));
$('check-phone-code').addEventListener('click',()=>verifyMemberPhone('check'));
$('close-portfolio').addEventListener('click',()=>$('portfolio-dialog').close());
async function loadPortfolio(workerId,list){
 list.replaceChildren();if(!db||!user){list.textContent='Sign in to view your portfolio.';return;}
 const {data,error}=await db.from('worker_portfolio').select('role,eatery_name,starts_at,ends_at,completed_at,good,will_hire_again,reviewed_at').eq('worker_id',workerId).order('completed_at',{ascending:false}).limit(100);
 if(error){list.textContent='Unable to load this portfolio.';return;}
 if(!data?.length){list.textContent='No confirmed worked shifts yet.';return;}
 for(const entry of data){const item=document.createElement('article');item.className='shift';const title=document.createElement('strong');title.textContent=entry.role+' · '+entry.eatery_name;const date=document.createElement('p');date.textContent='Worked '+new Date(entry.starts_at).toLocaleDateString();const grade=document.createElement('p');grade.textContent=[entry.good?'Good':null,entry.will_hire_again?'Will hire again':null].filter(Boolean).join(' · ')||(entry.reviewed_at?'No positive rating selected.':'Eatery rating pending.');item.append(title,date,grade);list.append(item);}
}
async function openWorkerPortfolio(workerId){$('portfolio-dialog').showModal();await loadPortfolio(workerId,$('worker-portfolio-content'));}
$('reward').addEventListener('change', () => $('charity-choice').classList.toggle('hidden', value('reward') !== 'donation'));
$('auth-form').addEventListener('submit', async ev => {
  ev.preventDefault();if(!db)return status('Supabase is not connected yet.');
  const {error}=await db.auth.signInWithPassword({email:value('email'),password:$('password').value});
  if(error){$('auth-feedback').textContent=error.message;return;}
  $('password').value='';$('auth-feedback').textContent='';await refreshSession();
  if(pendingView){show(pendingView);pendingView=null;}
  status('Signed in.');
});
$('signup').addEventListener('click', async () => {
  if(!db)return status('Supabase is not connected yet.');
  if(!$('auth-form').reportValidity())return;
  if(!value('account-name')||!/^[0-9]{5}$/.test(value('account-zip'))){$('auth-feedback').textContent='Enter your name and a 5-digit ZIP code to create an account.';return;}
  const button=$('signup');button.disabled=true;
  try{
    const {data,error}=await db.auth.signUp({email:value('email'),password:$('password').value,options:{emailRedirectTo:'https://servcycl.com/',data:{name:value('account-name'),zip:value('account-zip'),available:$('signup-available').checked}}});
    if(error)throw error;
    $('password').value='';await refreshSession();
    $('auth-feedback').textContent=data.session?'Account created. Open Available to review your availability.':'Check your email to confirm your account. Your worker profile and availability will be saved when you sign in.';
    if(data.session){show('available');$('availability-feedback').textContent='Account created. Review your availability and click Save availability to make changes.';}
  }catch(error){$('auth-feedback').textContent=error?.message||'Unable to create an account.';}
  finally{button.disabled=false;}
});
document.querySelectorAll('[data-password-toggle]').forEach(button=>button.addEventListener('click',()=>{
  const input=$(button.dataset.passwordToggle);const visible=input.type==='password';
  input.type=visible?'text':'password';button.setAttribute('aria-label',visible?'Hide password':'Show password');button.setAttribute('aria-pressed',String(visible));
}));
$('forgot-password').addEventListener('click',async()=>{
  if(!db)return status('Supabase is not connected yet.');
  if(!$('email').reportValidity())return;
  const button=$('forgot-password');button.disabled=true;
  try{
    const {error}=await db.auth.resetPasswordForEmail(value('email'),{redirectTo:'https://servcycl.com/'});
    if(error)throw error;
    $('auth-feedback').textContent='If an account exists for this email, a password reset link has been sent. Check your email.';
  }catch(error){$('auth-feedback').textContent=error?.message||'Unable to send a reset link. Please try again.';}
  finally{button.disabled=false;}
});
$('reset-password-form').addEventListener('submit',async ev=>{
  ev.preventDefault();if(!db)return;
  if(!recoveringPassword){$('reset-feedback').textContent='Open the password reset link from your email first.';return;}
  if($('new-password').value!==$('confirm-password').value){$('reset-feedback').textContent='Passwords do not match.';return;}
  const button=$('update-password');button.disabled=true;
  try{
    const {error}=await db.auth.updateUser({password:$('new-password').value});if(error)throw error;
    $('reset-password-form').reset();recoveringPassword=false;$('password-recovery').classList.add('hidden');
    $('auth-form').classList.remove('hidden');$('forgot-password').classList.remove('hidden');
    $('auth-feedback').textContent='Password updated. You are signed in.';
  }catch(error){$('reset-feedback').textContent=error?.message||'Unable to update your password.';}
  finally{button.disabled=false;}
});
$('signout').addEventListener('click', async () => { await db.auth.signOut(); user=null; recoveringPassword=false; $('password-recovery').classList.add('hidden'); $('auth-form').classList.remove('hidden'); $('forgot-password').classList.remove('hidden'); ['available-name','available-zip','account-name','account-zip','password','new-password','confirm-password'].forEach(id=>{$(id).value='';}); $('signup-available').checked=false; $('availability-feedback').textContent=''; await refreshSession(); status('Signed out.'); });
$('worker-form').addEventListener('submit', async ev => { ev.preventDefault(); if (!requireUser()) return; const donating=value('reward')==='donation';const percentage=donating?Number(value('donation-percent')):0;if(donating&&(!value('selected-charity')||!Number.isInteger(percentage)||percentage<1||percentage>100))return status('Choose a verified charity and a whole percentage from 1 to 100.'); const { error }=await db.from('workers').upsert({user_id:user.id,name:value('worker-name'),city:value('worker-city'),zip:value('worker-zip'),earnings_choice:value('reward'),charity_id:donating?value('selected-charity'):null,donation_percent:percentage},{onConflict:'user_id'}); if(error) return errorMessage(error); await loadProfiles(); status('Worker profile saved.'); });
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
  const {data:shifts,error:sError}=await db.from('shifts').select('id,title,starts_at,ends_at,hourly_cents').eq('eatery_id',e.id).in('status',['open','filled','completed']).order('starts_at',{ascending:false}).limit(50);
  if(sError)return errorMessage(sError);
  const ids=(shifts||[]).map(s=>s.id);
  if(!ids.length){list.textContent='No shift requests yet.';return;}
  const {data:requests,error:rError}=await db.from('shift_requests').select('id,shift_id,worker_id,status,created_at').in('shift_id',ids).order('created_at',{ascending:false});
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
    const portfolio=document.createElement('button');portfolio.type='button';portfolio.className='secondary';portfolio.textContent='Worker portfolio';portfolio.addEventListener('click',()=>openWorkerPortfolio(r.worker_id));article.append(portfolio);
    if(r.status==='accepted'){
      const complete=document.createElement('button');complete.type='button';complete.className='secondary';complete.textContent='Confirm worked shift';complete.disabled=new Date(s.ends_at)>new Date();
      const note=document.createElement('p');note.className='small';note.textContent=complete.disabled?'Confirm work after the scheduled end.':'Confirm only if this worker completed the shift. This adds it to their portfolio; payment is separate.';
      complete.addEventListener('click',async()=>{complete.disabled=true;const {error}=await db.rpc('confirm_worked_shift',{p_request_id:r.id});if(error){note.textContent=error.message;complete.disabled=false;return;}await loadEateryRequests();status('Worked shift added to the worker’s portfolio. You can now grade it.');});article.append(note,complete);
    }
    if(r.status==='completed'){
      const {data:review,error}=await db.from('worker_portfolio').select('good,will_hire_again').eq('request_id',r.id).maybeSingle();
      if(!error&&review){const form=document.createElement('form');const good=document.createElement('input');good.type='checkbox';good.checked=review.good;const goodLabel=document.createElement('label');goodLabel.className='check-label';goodLabel.append(good,document.createTextNode('Good'));const hire=document.createElement('input');hire.type='checkbox';hire.checked=review.will_hire_again;const hireLabel=document.createElement('label');hireLabel.className='check-label';hireLabel.append(hire,document.createTextNode('Will hire again'));const save=document.createElement('button');save.className='secondary';save.textContent='Save worker grade';const feedback=document.createElement('p');feedback.className='small';feedback.setAttribute('role','status');form.append(goodLabel,hireLabel,save,feedback);form.addEventListener('submit',async ev=>{ev.preventDefault();save.disabled=true;const {data,error}=await db.from('worker_portfolio').update({good:good.checked,will_hire_again:hire.checked}).eq('request_id',r.id).select('request_id');feedback.textContent=error?error.message:data?.length?'Worker grade saved.':'Unable to save this grade.';save.disabled=false;});article.append(form);}
    }

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
if(recoveringPassword){show('account');$('password-recovery').classList.remove('hidden');$('auth-form').classList.add('hidden');$('forgot-password').classList.add('hidden');}
const linkedZip=new URLSearchParams(window.location.search).get('zip');if(/^[0-9]{5}$/.test(linkedZip||''))$('search-location').value=linkedZip;
if(configured){
  db.auth.onAuthStateChange(event=>{setTimeout(async()=>{
    await refreshSession();
    if(event==='PASSWORD_RECOVERY'){recoveringPassword=true;show('account');$('password-recovery').classList.remove('hidden');$('auth-form').classList.add('hidden');$('forgot-password').classList.add('hidden');$('auth-feedback').textContent='Choose a new password below.';}
  },0);});
  refreshSession();loadCharities();loadShifts();
}
