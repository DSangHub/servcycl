import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {ACCOUNT,PLANS,PORTAL} from '../supabase/functions/_shared/billing.mjs';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/eatery-fee-checkout/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,''));
function setup({selected=true,signedIn=true,account=ACCOUNT}={}){
 const billing={eatery_id:'e1',owner_id:'u1',first_selection_at:selected?'2026-10-17':null,status:'not_started',checkout_generation:0};
 const sessions=new Map(),idem=new Map(),calls=[];
 const admin={auth:{getUser:async()=>({data:{user:signedIn?{id:'u1',email:'test@example.invalid'}:null}})},rpc:async()=>({data:true}),from(table){let patch;return {select(){return this},eq(){return this},update(p){patch=p;return this},maybeSingle:async()=>({data:{id:'e1'}}),single:async()=>({data:{...billing}}),then(resolve){if(patch)Object.assign(billing,patch);resolve({error:null});}};}};
 class Stripe {constructor(){this.accounts={retrieve:async()=>({id:account})};this.customers={create:async()=>({id:'cus_test'})};this.billingPortal={sessions:{create:async()=>({url:'https://billing.stripe.com/test'})}};this.checkout={sessions:{create:async(params,opts)=>{calls.push(params);if(idem.has(opts.idempotencyKey))return idem.get(opts.idempotencyKey);const s={id:'cs_'+sessions.size,status:'open',url:'https://checkout.stripe.com/test/'+sessions.size};sessions.set(s.id,s);idem.set(opts.idempotencyKey,s);return s;},retrieve:async id=>sessions.get(id),expire:async id=>{sessions.get(id).status='expired';}}};}}
 let handler;
 const context=vm.createContext({Stripe,createClient:()=>admin,ACCOUNT,PLANS,PORTAL,Response,Request,URL,crypto,Date,console,Deno:{env:{get:()=> 'configured'},serve:fn=>handler=fn},syncSubscription:async()=>{}});
 vm.runInContext(source,context);
 return {billing,sessions,calls,request:async(body,origin='https://servcycl.com')=>handler(new Request('https://functions.invalid',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)}))};
}
test('unauthorized and foreign origin calls fail closed',async()=>{assert.equal((await setup({signedIn:false}).request({plan:'five'})).status,401);assert.equal((await setup().request({plan:'five'},'https://untrusted.invalid')).status,403);assert.equal((await setup({account:'acct_wrong'}).request({plan:'five'})).status,503);});
test('old $4 requests and premature subscription checkout are rejected',async()=>{const t=setup({selected:false});assert.equal((await t.request({request_id:'old'})).status,409);assert.equal((await t.request({plan:'five'})).status,409);assert.equal(t.calls.length,0);});
test('subscription checkout fixes price server-side and reuses open session',async()=>{const t=setup();assert.equal((await t.request({plan:'five',amount:1})).status,200);const first=t.billing.stripe_session_id;assert.equal(t.calls[0].mode,'subscription');assert.equal(t.calls[0].line_items[0].price,PLANS.five.price);assert.equal(t.calls[0].subscription_data.metadata.owner_id,'u1');assert.equal((await t.request({plan:'five'})).status,200);assert.equal(t.billing.stripe_session_id,first);assert.equal(t.calls.length,1);assert.equal(t.billing.checkout_token,null);});
test('switching an unpaid checkout expires it before creating the other plan',async()=>{const t=setup();await t.request({plan:'five'});const first=t.billing.stripe_session_id;await t.request({plan:'unlimited'});assert.equal(t.sessions.get(first).status,'expired');assert.equal(t.calls[1].line_items[0].price,PLANS.unlimited.price);assert.notEqual(t.billing.stripe_session_id,first);});
test('database-write recovery reuses Stripe idempotency key',async()=>{const t=setup();await t.request({plan:'five'});const first=t.billing.stripe_session_id;t.billing.stripe_session_id=null;await t.request({plan:'five'});assert.equal(t.sessions.size,1);assert.equal(t.billing.checkout_plan,'five');assert.equal(t.billing.stripe_session_id,first);});
