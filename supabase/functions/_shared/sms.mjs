export function normalizePhone(input) {
 const digits=String(input||'').replace(/\D/g,'');
 const phone='+'+(digits.length===10?'1'+digits:digits);
 if(!/^\+1[2-9][0-9]{9}$/.test(phone))throw new Error('Enter a valid US mobile number.');
 return phone;
}
export function shiftText(shift) {
 const role=shift.title.replace(/[\r\n]/g,' ').slice(0,55);
 const name=shift.eateries.name.replace(/[\r\n]/g,' ').slice(0,55);
 const when=new Date(shift.starts_at).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
 return `ServCycl: New ${role} shift at ${name}, ${when}, $${(shift.hourly_cents/100).toFixed(2)}/hr. View: https://servcycl.com/?zip=${encodeURIComponent(shift.eateries.zip)} Reply STOP to unsubscribe.`;
}
export async function validTwilioSignature(token,url,params,signature) {
 if(!signature)return false;
 let message=url;
 for(const key of [...new Set(params.keys())].sort())for(const value of [...new Set(params.getAll(key))].sort())message+=key+value;
 try{
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['verify']);
  const bytes=Uint8Array.from(atob(signature),c=>c.charCodeAt(0));
  return await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(message));
 }catch{return false;}
}
