import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
import {normalizePhone} from '../_shared/sms.mjs';
const origins=['https://servcycl.com','https://www.servcycl.com'];
Deno.serve(async req=>{
 const origin=req.headers.get('Origin');
 const cors={'Access-Control-Allow-Origin':origin&&origins.includes(origin)?origin:origins[0],'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(origin&&!origins.includes(origin))return reply({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const sid=Deno.env.get('TWILIO_ACCOUNT_SID'),token=Deno.env.get('TWILIO_AUTH_TOKEN'),verify=Deno.env.get('TWILIO_VERIFY_SERVICE_SID');
 const ready=Boolean(sid&&token&&verify&&(Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')||Deno.env.get('TWILIO_FROM_NUMBER')));
 if(req.method==='GET')return reply({ready});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const bearer=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
  if(!bearer)return reply({error:'Sign in required'},401);
  const {data:{user},error}=await admin.auth.getUser(bearer);
  if(error||!user)return reply({error:'Sign in required'},401);
  if(!ready)return reply({error:'Text notifications are awaiting setup. Your membership and portfolio are available now.'},503);
  const body=await req.json();const phone=normalizePhone(body.phone);
  if(!['send','check'].includes(body.action))return reply({error:'Invalid verification action'},400);
  if(body.action==='check'&&!/^[0-9]{4,10}$/.test(body.code||''))return reply({error:'Enter the verification code from your text.'},400);
  const {error:reserveError}=await admin.rpc('reserve_sms_verification',{p_worker_id:user.id,p_phone:phone,p_action:body.action});
  if(reserveError)return reply({error:reserveError.message},429);
  const form=new URLSearchParams({To:phone});
  if(body.action==='send')form.set('Channel','sms');else form.set('Code',body.code);
  const response=await fetch(`https://verify.twilio.com/v2/Services/${verify}/${body.action==='send'?'Verifications':'VerificationCheck'}`,{method:'POST',headers:{Authorization:'Basic '+btoa(sid+':'+token),'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(12000)});
  const result=await response.json();
  if(!response.ok){console.error('Phone verification provider error',result.code||response.status);return reply({error:'Unable to verify this number. Check the number or try again later.'},502);}
  if(body.action==='send')return reply({sent:true});
  if(result.status!=='approved')return reply({error:'That code is not correct or has expired.'},400);
  const {error:saveError}=await admin.rpc('approve_member_phone',{p_worker_id:user.id,p_phone:phone});
  if(saveError)throw saveError;
  return reply({verified:true});
 }catch(error){console.error('Member SMS verification failed',error instanceof Error?error.name:'unknown');return reply({error:'Unable to complete phone verification. Please try again.'},500);}
});
