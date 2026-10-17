import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { validFeeSession } from '../_shared/fees.mjs';
import { syncSubscription } from '../_shared/subscriptions.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const key=Deno.env.get('STRIPE_SECRET_KEY')?.trim(),secret=Deno.env.get('STRIPE_WEBHOOK_SECRET');
 if(!key||!secret)return new Response('Payments not configured',{status:503});
 const stripe=new Stripe(key,{apiVersion:'2026-08-26.dahlia'});
 let event;
 try {event=await stripe.webhooks.constructEventAsync(await req.text(),req.headers.get('stripe-signature')||'',secret,undefined,Stripe.createSubtleCryptoProvider());}
 catch{return new Response('Invalid signature',{status:400});}
 if(event.account&&event.account!=='acct_1Tt8NBK7onK0AaO1')return new Response('Wrong account',{status:400});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 try {
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
   const session=event.data.object as Stripe.Checkout.Session;
   if(session.metadata?.app==='servcycl'&&session.metadata?.purpose==='eatery_monthly_plan'&&session.mode==='subscription'){
    const subId=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
    if(subId)await syncSubscription(stripe,admin,subId,event.created);
    return new Response('ok');
   }
   if(session.metadata?.app!=='servcycl'||session.metadata?.purpose!=='eatery_shift_fee'||session.payment_status!=='paid')return new Response('Ignored');
   const {data:fee,error}=await admin.from('eatery_fee_payments').select('*').eq('request_id',session.metadata.request_id).maybeSingle();
   if(error)throw error;
   if(!fee)return new Response('Fee record not ready',{status:503});
   if(!validFeeSession(session,fee))return new Response('Fee mismatch',{status:400});
   const pi=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
   if(!pi)return new Response('Missing payment intent',{status:400});
   // Retrieve current refund state so late/repeated checkout events cannot undo refunds.
   const intent=await stripe.paymentIntents.retrieve(pi,{expand:['latest_charge']});
   const charge=intent.latest_charge as Stripe.Charge|null;
   const status=charge?.refunded?'refunded':charge?.amount_refunded?'partially_refunded':'paid';
   const {error:writeError}=await admin.from('eatery_fee_payments').update({status,stripe_payment_intent_id:pi,paid_at:fee.paid_at||new Date(event.created*1000).toISOString()}).eq('request_id',fee.request_id);
   if(writeError)throw writeError;
  } else if(event.type.startsWith('customer.subscription.')){
   await syncSubscription(stripe,admin,(event.data.object as Stripe.Subscription).id,event.created);
  } else if(['invoice.paid','invoice.payment_failed','invoice.payment_action_required'].includes(event.type)){
   const invoice=event.data.object as Stripe.Invoice;
   const sub=invoice.parent?.subscription_details?.subscription;
   const subId=typeof sub==='string'?sub:sub?.id;
   if(subId)await syncSubscription(stripe,admin,subId,event.created);
  } else if(event.type==='charge.refunded'){
   const charge=event.data.object as Stripe.Charge;
   const pi=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
   if(pi){const {error}=await admin.from('eatery_fee_payments').update({status:charge.refunded?'refunded':'partially_refunded'}).eq('stripe_payment_intent_id',pi);if(error)throw error;}
  }
  return new Response('ok');
 }catch(error){console.error('Fee reconciliation failed',error instanceof Error?error.message:'unknown');return new Response('Retry required',{status:500});}
});
