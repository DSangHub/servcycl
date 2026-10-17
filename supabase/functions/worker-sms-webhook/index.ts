import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
import {validTwilioSignature} from '../_shared/sms.mjs';
const url='https://sbazijqghmartmgsiwwa.supabase.co/functions/v1/worker-sms-webhook';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const token=Deno.env.get('TWILIO_AUTH_TOKEN');if(!token)return new Response('Not configured',{status:503});
 const params=new URLSearchParams(await req.text());
 if(!await validTwilioSignature(token,url,params,req.headers.get('X-Twilio-Signature')))return new Response('Invalid signature',{status:403});
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 try{
  const from=params.get('From'),word=(params.get('Body')||'').trim().toUpperCase();
  if(params.get('OptOutType')==='STOP'||['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPT OUT'].includes(word)){
   const {error}=await admin.from('worker_memberships').update({sms_optin:false}).eq('phone',from);if(error)throw error;
  }
  const sid=params.get('MessageSid'),state=params.get('MessageStatus');
  if(sid&&state){const {error}=await admin.from('shift_sms_jobs').update({delivery_status:state,error_code:params.get('ErrorCode')||null}).eq('provider_sid',sid);if(error)throw error;}
  const message=params.get('OptOutType')?'':word==='HELP'?'<Message>ServCycl shift alerts. Manage texts at https://servcycl.com or reply STOP to unsubscribe.</Message>':'';
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response>'+message+'</Response>',{headers:{'Content-Type':'text/xml'}});
 }catch{return new Response('Retry required',{status:500});}
});
