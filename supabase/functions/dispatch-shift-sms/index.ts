import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
import {shiftText} from '../_shared/sms.mjs';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const presented=req.headers.get('X-ServCycl-Dispatch');
 if(!presented)return new Response('Unauthorized',{status:401});
 const {data:settings,error:settingsError}=await admin.from('sms_dispatch_settings').select('token').eq('id',true).single();
 if(settingsError||presented!==settings?.token)return new Response('Unauthorized',{status:401});
 const sid=Deno.env.get('TWILIO_ACCOUNT_SID'),token=Deno.env.get('TWILIO_AUTH_TOKEN'),service=Deno.env.get('TWILIO_MESSAGING_SERVICE_SID'),from=Deno.env.get('TWILIO_FROM_NUMBER');
 if(!sid||!token||(!service&&!from))return Response.json({ready:false});
 try{
  const {data:jobs,error}=await admin.rpc('claim_shift_sms_jobs');if(error)throw error;
  let sent=0;
  for(const job of jobs||[]){
   const write=async(patch:any)=>{const {error}=await admin.from('shift_sms_jobs').update(patch).eq('id',job.id);if(error)throw error;};
   const [memberResult,workerResult,shiftResult]=await Promise.all([
    admin.from('worker_memberships').select('phone,phone_verified,sms_optin').eq('worker_id',job.worker_id).single(),
    admin.from('workers').select('zip').eq('user_id',job.worker_id).single(),
    admin.from('shifts').select('title,status,starts_at,hourly_cents,eateries(name,zip)').eq('id',job.shift_id).single()
   ]);
   const member=memberResult.data,worker=workerResult.data,shift=shiftResult.data;
   if(memberResult.error||workerResult.error||shiftResult.error)throw new Error('Notification data unavailable');
   if(!member.sms_optin||!member.phone_verified||!member.phone||shift.status!=='open'||new Date(shift.starts_at)<=new Date()||new Date(job.expires_at)<=new Date()||worker.zip!==shift.eateries?.zip){await write({status:'skipped'});continue;}
   const body=new URLSearchParams({To:member.phone,Body:shiftText(shift),StatusCallback:'https://sbazijqghmartmgsiwwa.supabase.co/functions/v1/worker-sms-webhook'});
   body.set(service?'MessagingServiceSid':'From',service||from!);
   try{
    const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+btoa(sid+':'+token),'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if(response.ok&&result.sid){await write({status:'sent',sent_at:new Date().toISOString(),provider_sid:result.sid,delivery_status:result.status});sent++;}
    else{
     if(result.code===21610)await admin.from('worker_memberships').update({sms_optin:false}).eq('worker_id',job.worker_id);
     await write({status:response.status===429&&job.attempts<3?'pending':'failed',error_code:String(result.code||response.status)});
    }
   }catch{
    // A timeout may occur after provider acceptance; never blindly resend that job.
    await write({status:'unknown',error_code:'provider_result_unknown'});
   }
  }
  return Response.json({ready:true,sent});
 }catch(error){console.error('Shift SMS dispatch failed',error instanceof Error?error.name:'unknown');return new Response('Dispatch failed',{status:500});}
});
