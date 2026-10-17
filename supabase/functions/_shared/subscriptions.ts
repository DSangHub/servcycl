import { subscriptionSnapshot } from './billing.mjs';
export async function syncSubscription(stripe:any,admin:any,subscriptionId:string,eventCreated:number) {
 // Always read Stripe's current state, rather than trusting a potentially stale event snapshot.
 const sub=await stripe.subscriptions.retrieve(subscriptionId,{expand:['latest_invoice']});
 if(sub.metadata?.app!=='servcycl'||sub.metadata?.purpose!=='eatery_monthly_plan')return;
 const state=subscriptionSnapshot(sub);
 if(!state.start||!state.end||!state.customer)throw new Error('Subscription billing period missing');
 const {error}=await admin.rpc('sync_eatery_subscription',{
  p_eatery_id:sub.metadata.eatery_id,p_owner_id:sub.metadata.owner_id,
  p_subscription_id:sub.id,p_customer_id:state.customer,p_plan:state.plan,p_status:state.status,
  p_period_start:new Date(state.start*1000).toISOString(),p_period_end:new Date(state.end*1000).toISOString(),
  p_paid:state.paid,p_cancel:state.cancel,p_event_created:eventCreated
 });
 if(error)throw error;
}
