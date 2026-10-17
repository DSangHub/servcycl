export const ACCOUNT = 'acct_1Tt8NBK7onK0AaO1';
export const PORTAL = 'bpc_1URcCaK7onK0AaO1GSzqjV38';
export const PLANS = Object.freeze({
 five: {price:'price_1URcC0K7onK0AaO1rnffUVm1', amount:1000, limit:5},
 unlimited: {price:'price_1URcC4K7onK0AaO1cJ346vnm', amount:2000, limit:null}
});
export function subscriptionSnapshot(sub) {
 const items=sub.items?.data||[];
 const item=items[0];
 const plan=Object.keys(PLANS).find(key=>PLANS[key].price===item?.price?.id);
 if(sub.metadata?.app!=='servcycl'||sub.metadata?.purpose!=='eatery_monthly_plan'||!plan||items.length!==1||
    item.quantity!==1||item.price.currency!=='usd'||item.price.unit_amount!==PLANS[plan].amount||
    item.price.recurring?.interval!=='month'||item.price.recurring?.interval_count!==1)throw new Error('Invalid ServCycl subscription');
 const invoice=sub.latest_invoice;
 const paid=sub.status==='active'&&!sub.pause_collection&&invoice&&typeof invoice==='object'&&invoice.status==='paid';
 return {plan,status:sub.status,paid:Boolean(paid),start:item.current_period_start,end:item.current_period_end,
   customer:typeof sub.customer==='string'?sub.customer:sub.customer?.id,cancel:Boolean(sub.cancel_at_period_end||sub.cancel_at)};
}
