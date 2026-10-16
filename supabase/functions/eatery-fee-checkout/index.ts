import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { canCharge } from '../_shared/fees.mjs';
const origin='https://servcycl.com';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try {
  const key=Deno.env.get('STRIPE_SECRET_KEY');
  const account=Deno.env.get('SERVCYCL_STRIPE_ACCOUNT_ID');
  if(!key||!account||!Deno.env.get('STRIPE_WEBHOOK_SECRET'))return reply({error:'ServCycl payments are not activated yet.'},503);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return reply({error:'Sign in required'},401);
  const {data:{user},error:authError}=await admin.auth.getUser(token);
  if(authError||!user)return reply({error:'Sign in required'},401);
  const {request_id}=await req.json();
  if(typeof request_id!=='string'||!/^[0-9a-f-]{36}$/i.test(request_id))return reply({error:'Invalid shift request'},400);
  const {data:request,error}=await admin.from('shift_requests').select('id,status,shifts(eateries(owner_id))').eq('id',request_id).maybeSingle();
  if(error)throw error;
  if(!canCharge(request,user.id))return reply({error:'Only the owning eatery can pay for an accepted shift.'},403);
  const stripe=new Stripe(key,{apiVersion:'2026-08-26.dahlia'});
  if((await stripe.accounts.retrieve()).id!==account)return reply({error:'ServCycl Stripe account mismatch.'},503);
  const {error:insertError}=await admin.from('eatery_fee_payments').upsert({request_id,owner_id:user.id},{onConflict:'request_id',ignoreDuplicates:true});
  if(insertError)throw insertError;
  const {data:fee,error:feeError}=await admin.from('eatery_fee_payments').select('*').eq('request_id',request_id).single();
  if(feeError)throw feeError;
  if(fee.status!=='due')return reply({error:'This shift fee has already been processed.'},409);
  if(fee.stripe_session_id){
   const prior=await stripe.checkout.sessions.retrieve(fee.stripe_session_id);
   if(prior.status==='open'&&prior.url)return reply({url:prior.url});
   if(prior.status==='complete')return reply({error:'Payment is processing. Refresh shortly.'},409);
  }
  const session=await stripe.checkout.sessions.create({
   mode:'payment',client_reference_id:request_id,customer_email:user.email,
   integration_identifier:'servcycl_eatery_fee_qmztrbkn',
   line_items:[{price_data:{currency:'usd',unit_amount:400,product_data:{name:'ServCycl accepted shift fee',description:'ServCycl service fee only. Worker earnings and direct donations are paid separately.'}},quantity:1}],
   metadata:{app:'servcycl',purpose:'eatery_shift_fee',request_id,owner_id:user.id},
   payment_intent_data:{metadata:{app:'servcycl',purpose:'eatery_shift_fee',request_id}},
   success_url:origin+'/?fee=processing',cancel_url:origin+'/?fee=cancelled'
  },{idempotencyKey:'servcycl-fee-'+request_id+'-'+(fee.stripe_session_id||'first')});
  let update=admin.from('eatery_fee_payments').update({stripe_session_id:session.id}).eq('request_id',request_id).eq('status','due');
  update=fee.stripe_session_id?update.eq('stripe_session_id',fee.stripe_session_id):update.is('stripe_session_id',null);
  const {error:updateError}=await update;
  if(updateError)throw updateError;
  return reply({url:session.url});
 } catch(error){console.error('Fee checkout failed',error instanceof Error?error.message:'unknown');return reply({error:'Unable to open checkout. Please try again.'},500);}
});
