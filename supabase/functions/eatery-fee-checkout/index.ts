import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { ACCOUNT, PLANS, PORTAL } from '../_shared/billing.mjs';
import { syncSubscription } from '../_shared/subscriptions.ts';
const origin='https://servcycl.com';
Deno.serve(async req=>{
 const requestOrigin=req.headers.get('Origin');
 const allowedOrigins=[origin,'https://www.servcycl.com'];
 const cors={'Access-Control-Allow-Origin':requestOrigin&&allowedOrigins.includes(requestOrigin)?requestOrigin:origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(requestOrigin&&!allowedOrigins.includes(requestOrigin))return reply({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 let admin:any,eateryId:string|undefined,lockToken:string|undefined;
 try {
  const key=Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  if(!key||!Deno.env.get('STRIPE_WEBHOOK_SECRET'))return reply({error:'ServCycl payments are not activated yet.'},503);
  admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return reply({error:'Sign in required'},401);
  const {data:{user},error:authError}=await admin.auth.getUser(token);
  if(authError||!user)return reply({error:'Sign in required'},401);
  const body=await req.json();
  // Old clients must never create another $4 charge.
  if(body.request_id)return reply({error:'Per-shift fees have ended. Refresh and choose an Eatery monthly plan.'},409);
  const {data:e,error:eError}=await admin.from('eateries').select('id').eq('owner_id',user.id).maybeSingle();
  if(eError)throw eError;
  if(!e)return reply({error:'Save your eatery profile first.'},400);
  eateryId=e.id;
  const stripe=new Stripe(key,{apiVersion:'2026-08-26.dahlia'});
  if((await stripe.accounts.retrieve()).id!==ACCOUNT)return reply({error:'ServCycl Stripe account mismatch. Use a County Count secret key.'},503);
  const lock=crypto.randomUUID();
  const {data:claimed,error:claimError}=await admin.rpc('claim_eatery_checkout',{p_eatery_id:e.id,p_token:lock});
  if(claimError)throw claimError;
  if(!claimed)return reply({error:'Another billing request is processing. Try again in a moment.'},409);
  lockToken=lock;
  const read=async()=>{const {data,error}=await admin.from('eatery_billing').select('*').eq('eatery_id',e.id).single();if(error)throw error;return data;};
  let billing=await read();
  const save=async(patch:any)=>{const {error}=await admin.from('eatery_billing').update(patch).eq('eatery_id',e.id).eq('checkout_token',lock);if(error)throw error;billing={...billing,...patch};};
  if(billing.stripe_session_id){
   const pending=await stripe.checkout.sessions.retrieve(billing.stripe_session_id);
   const subId=typeof pending.subscription==='string'?pending.subscription:pending.subscription?.id;
   if(pending.status==='complete'&&subId){await syncSubscription(stripe,admin,subId,Math.floor(Date.now()/1000));billing=await read();}
  }
  if(billing.stripe_subscription_id){
   await syncSubscription(stripe,admin,billing.stripe_subscription_id,Math.floor(Date.now()/1000));
   billing=await read();
   if(!['canceled','incomplete_expired'].includes(billing.status)){
    if(body.action==='refresh')return reply({refreshed:true});
    const portal=await stripe.billingPortal.sessions.create({customer:billing.stripe_customer_id,configuration:PORTAL,return_url:origin+'/?billing=return'});
    return reply({url:portal.url});
   }
   if(billing.stripe_session_id){
    const old=await stripe.checkout.sessions.retrieve(billing.stripe_session_id);
    const oldSub=typeof old.subscription==='string'?old.subscription:old.subscription?.id;
    if(old.status==='complete'&&oldSub===billing.stripe_subscription_id)await save({checkout_generation:billing.checkout_generation+1,checkout_plan:null,stripe_session_id:null});
   }
  }
  if(body.action==='refresh')return reply({refreshed:true});
  if(!billing.first_selection_at)return reply({error:'Payment starts after a worker first selects one of your shifts. You can post up to 5 shifts before then.'},409);
  if(!Object.hasOwn(PLANS,body.plan))return reply({error:'Choose $10/month for 5 postings or $20/month for unlimited.'},400);
  if(!billing.stripe_customer_id){
   const customer=await stripe.customers.create({email:user.email,metadata:{app:'servcycl',eatery_id:e.id,owner_id:user.id}},{idempotencyKey:'servcycl-eatery-customer-'+e.id});
   await save({stripe_customer_id:customer.id});
  }
  const createSession=async(plan:string)=>{
   const meta={app:'servcycl',purpose:'eatery_monthly_plan',eatery_id:e.id,owner_id:user.id,plan};
   return await stripe.checkout.sessions.create({
    mode:'subscription',customer:billing.stripe_customer_id,client_reference_id:e.id,
    integration_identifier:'servcycl_monthly_plan_hnqrvpzx',line_items:[{price:PLANS[plan].price,quantity:1}],
    metadata:meta,subscription_data:{metadata:meta,billing_mode:{type:'flexible'}},
    success_url:origin+'/?billing=processing',cancel_url:origin+'/?billing=cancelled'
   },{idempotencyKey:'servcycl-monthly-'+e.id+'-'+billing.checkout_generation});
  };
  let session:any;
  if(billing.checkout_plan){
   // Recover a successful Stripe creation even if the previous database write failed.
   session=billing.stripe_session_id?await stripe.checkout.sessions.retrieve(billing.stripe_session_id):await createSession(billing.checkout_plan);
   if(!billing.stripe_session_id)await save({stripe_session_id:session.id});
   if(session.status==='complete')return reply({error:'Your subscription is processing. Refresh billing shortly.'},409);
   if(session.status==='open'&&billing.checkout_plan===body.plan)return reply({url:session.url});
   if(session.status==='open')await stripe.checkout.sessions.expire(session.id);
   await save({checkout_generation:billing.checkout_generation+1,stripe_session_id:null,checkout_plan:null});
  }
  await save({checkout_plan:body.plan});
  session=await createSession(body.plan);
  await save({stripe_session_id:session.id});
  return reply({url:session.url});
 }catch(error){
  console.error('Eatery billing failed',error instanceof Error?error.message:'unknown');
  return reply({error:'Unable to open billing. Please try again.'},500);
 }finally{
  if(admin&&eateryId&&lockToken){const {error}=await admin.from('eatery_billing').update({checkout_token:null,checkout_lock_until:null}).eq('eatery_id',eateryId).eq('checkout_token',lockToken);if(error)console.error('Billing lock release failed');}
 }
});
