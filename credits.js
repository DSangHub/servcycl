import {creditCents,creditCode,creditMoney as money} from './credit-utils.mjs';
export function initCredits({db,getUser,showAccount}){
 const $=id=>document.getElementById(id);
 let revision=0,ownEatery=null,camera=null,timer=null,scanBusy=false;
 const pending=new Map();
 const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
 const say=(message,target=$('credit-feedback'))=>target.textContent=message;
 const needUser=()=>{if(getUser())return true;showAccount();return false;};
 async function request(action,data={},mutation=false){
  const user=getUser();if(!user||!db)throw new Error('Sign in to use food credits.');
  let storageKey;
  if(mutation){
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
   const digest=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
   storageKey='servcycl-credit-op-'+user.id+'-'+action+'-'+digest;
   let key=pending.get(storageKey);try{key=key||sessionStorage.getItem(storageKey);}catch{}
   if(!key)key=crypto.randomUUID();pending.set(storageKey,key);try{sessionStorage.setItem(storageKey,key);}catch{}
   data={...data,key};
  }
  const {data:result,error}=await db.rpc('food_credit_action',{p_action:action,p_data:data});
  if(error)throw error;
  if(storageKey){pending.delete(storageKey);try{sessionStorage.removeItem(storageKey);}catch{}}
  return result;
 }
 const field=(labelText,type='text',required=true)=>{const wrap=node('div'),label=node('label',labelText),input=node('input');input.id='credit-field-'+crypto.randomUUID();label.htmlFor=input.id;input.type=type;input.required=required;wrap.append(label,input);return {wrap,input};};
 const check=text=>{const label=node('label',undefined,'check-label'),input=node('input');input.type='checkbox';label.append(input,document.createTextNode(text));return {label,input};};
 const button=(text,fn)=>{const el=node('button',text,'secondary');el.type='button';el.addEventListener('click',()=>run(el,fn));return el;};
 async function run(el,fn,target=$('credit-feedback')){el.disabled=true;try{await fn();}catch(error){say(error?.message||'Unable to complete this action.',target);}finally{el.disabled=false;}}
 async function change(action,data,message){await request(action,data,true);await refresh();say(message);}
 function codeCard(code){
  const card=node('article',undefined,'shift');card.append(node('strong',money(code.amount_cents)+' at '+code.eatery_name),node('p','Reserved until '+new Date(code.expires_at).toLocaleTimeString()+'. Show this QR to the selected eatery.'));
  if(typeof window.qrcode==='function'){const qr=window.qrcode(0,'M');qr.addData('https://servcycl.com/#food-credit='+creditCode(code.id));qr.make();const image=node('div',undefined,'credit-qr');image.innerHTML=qr.createSvgTag({cellSize:4,margin:4,scalable:true});image.setAttribute('role','img');image.setAttribute('aria-label','Food-credit redemption QR code');card.append(image);}
  const input=node('input');input.readOnly=true;input.value=code.id;input.setAttribute('aria-label','Redemption code');card.append(input,button('Copy code',async()=>{await navigator.clipboard.writeText(code.id);say('Code copied.');}),button('Cancel code',()=>change('cancel_code',{code:code.id},'Code cancelled. Reserved credits are available again.')));return card;
 }
 async function drawWallet(data,version){
  $('credit-member-code').value=data.member_code;
  const lots=$('credit-lots'),offers=$('credit-offers'),codes=$('credit-codes'),history=$('credit-history');
  [lots,offers,codes,history].forEach(el=>el.replaceChildren());
  const usable=data.lots.filter(l=>!l.expires_at||new Date(l.expires_at)>new Date());
  $('credit-balance').textContent=money(usable.reduce((total,l)=>total+l.available_cents,0))+' available · '+money(usable.reduce((total,l)=>total+l.remaining_cents-l.available_cents,0))+' reserved';
  if(!data.offers.length)offers.textContent='No food-credit offers waiting for you.';
  for(const offer of data.offers){
   const card=node('article',undefined,'shift');card.append(node('strong',money(offer.amount_cents)+' from '+offer.eatery_name),node('p',offer.terms),node('p','No expiration. '+(offer.transferable?'Gifting allowed. ':'Gifting unavailable. ')+(offer.coop_allowed?'Eligible for agreed Co-Op locations.':'Use at the issuing eatery.')));
   const consent=check('I agree to this food-credit offer and its rules. This does not mark cash wages as paid.');
   card.append(consent.label,button('Accept credits',async()=>{if(!consent.input.checked)throw new Error('Review and check the offer agreement first.');await change('accept_offer',{offer_id:offer.id,agree:true},'Credits added to your wallet.');}),button('Decline offer',()=>change('decline_offer',{offer_id:offer.id},'Offer declined.')));offers.append(card);
  }
  if(!usable.some(l=>l.remaining_cents>0))lots.textContent='No food credits yet. After a worked food-credit shift, the eatery can send an offer for you to review.';
  for(const lot of usable.filter(l=>l.remaining_cents>0)){
   const card=node('article',undefined,'shift');card.append(node('strong',lot.issuer_name+' · '+money(lot.available_cents)+' available'),node('p',money(lot.remaining_cents)+' remaining. No expiration.'),node('p',lot.terms));
   const targets=await request('targets',{lot_id:lot.id});if(version!==revision)return;
   const form=node('form'),amount=field('Amount to redeem','number');amount.input.min='0.01';amount.input.step='0.01';amount.input.max=(lot.available_cents/100).toFixed(2);
   const label=node('label','Redeeming eatery'),select=node('select');select.setAttribute('aria-label','Redeeming eatery');for(const t of targets)select.append(new Option(t.name,t.id));
   const submit=node('button','Create 10-minute QR code','secondary');form.append(amount.wrap,label,select,submit);form.addEventListener('submit',ev=>{ev.preventDefault();run(submit,()=>change('create_code',{lot_id:lot.id,eatery_id:select.value,amount_cents:creditCents(amount.input.value)},'Redemption code created. Credits are reserved until used, cancelled or expired.'));});card.append(form);
   if(lot.transferable){
    const gift=node('form'),recipient=field('Recipient member code'),giftAmount=field('Amount to gift','number');giftAmount.input.min='0.01';giftAmount.input.step='0.01';giftAmount.input.max=(lot.available_cents/100).toFixed(2);const confirm=check('I checked the recipient code. The gift keeps the issuing eatery’s rules.');confirm.input.required=true;
    const send=node('button','Send food-credit gift','secondary');gift.append(node('h3','Gift to a friend or family member'),recipient.wrap,giftAmount.wrap,confirm.label,send);gift.addEventListener('submit',ev=>{ev.preventDefault();run(send,async()=>{if(!confirm.input.checked)throw new Error('Confirm the recipient code before sending.');await change('gift',{lot_id:lot.id,recipient_code:creditCode(recipient.input.value),amount_cents:creditCents(giftAmount.input.value)},'Gift sent. The recipient can see it in their Food credits wallet.');});});card.append(gift);
   }else card.append(node('p','The issuing eatery has not enabled gifting for these credits.'));
   lots.append(card);
  }
  if(!data.codes.length)codes.textContent='No active redemption codes.';for(const code of data.codes)codes.append(codeCard(code));
  if(!data.ledger.length)history.textContent='Your credit history will appear here.';
  const names={issued:'Credits accepted',gift_sent:'Gift sent',gift_received:'Gift received',redeemed:'Redeemed',redemption_voided:'Redemption reversed'};
  for(const entry of data.ledger){const row=node('article',undefined,'shift');row.append(node('strong',(names[entry.kind]||entry.kind)+' · '+money(entry.delta_cents)),node('p',entry.issuer_name+' · '+new Date(entry.created_at).toLocaleString()+' · Balance after: '+money(entry.balance_after_cents)));history.append(row);}
 }
 function drawEatery(data){
  ownEatery=data.eatery_id;$('credit-eatery-panel').classList.toggle('hidden',!ownEatery);if(!ownEatery)return;
  $('credit-transfers').checked=data.rules.transfers_enabled;$('credit-coop').checked=data.rules.coop_enabled;$('credit-terms').value=data.rules.terms;
  const shifts=$('credit-eligible-shifts');shifts.replaceChildren();
  if(!data.eligible_shifts.length)shifts.textContent='No completed food-credit shifts are awaiting an offer.';
  for(const shift of data.eligible_shifts){const card=node('article',undefined,'shift'),form=node('form'),amount=field('Agreed food-credit amount','number');amount.input.min='0.01';amount.input.step='0.01';amount.input.max=(shift.amount_cents/100).toFixed(2);const submit=node('button','Send credit offer','secondary');card.append(node('strong',shift.title+' · '+shift.worker_name),node('p','Recorded shift estimate: '+money(shift.amount_cents)+'. Send only the agreed food-credit amount. The worker must accept it.'));form.append(amount.wrap,submit);form.addEventListener('submit',ev=>{ev.preventDefault();run(submit,()=>change('offer',{request_id:shift.request_id,amount_cents:creditCents(amount.input.value)},'Credit offer sent for the worker’s review.'));});card.append(form);shifts.append(card);}
  const offers=$('credit-eatery-offers');offers.replaceChildren();
  for(const offer of data.offers){const row=node('article',undefined,'shift');row.append(node('strong',offer.worker_name+' · '+money(offer.amount_cents)+' · '+offer.status));if(offer.status==='pending')row.append(button('Withdraw offer',()=>change('withdraw_offer',{offer_id:offer.id},'Pending offer withdrawn.')));offers.append(row);}
  const partners=$('credit-partner');partners.replaceChildren(new Option('Choose a participating eatery',''));for(const partner of data.partners)partners.append(new Option(partner.name,partner.id));
  const agreements=$('credit-agreements');agreements.replaceChildren();if(!data.agreements.length)agreements.textContent='No Co-Op agreements yet. Each direction requires its own accepted agreement.';
  for(const agreement of data.agreements){
   const row=node('article',undefined,'shift');row.append(node('strong',agreement.issuer_name+' → '+agreement.redeemer_name+' · '+agreement.status),node('p','Issuer reimburses the accepting eatery at 100% of redeemed credit value. Outstanding limit: '+money(agreement.max_outstanding_cents)+'. Currently owed: '+money(agreement.outstanding_cents)+'.'));
   if(agreement.status==='proposed'&&agreement.redeemer_eatery_id===ownEatery){const consent=check('I agree to accept these credits and the face-value reimbursement terms.');row.append(consent.label,button('Accept Co-Op agreement',async()=>{if(!consent.input.checked)throw new Error('Agree to the reimbursement terms first.');await change('accept_coop',{agreement_id:agreement.id,agree:true},'Co-Op agreement active.');}));}
   if(agreement.status!=='closed')row.append(button(agreement.status==='proposed'?'Close proposal':'Stop future Co-Op redemptions',()=>change('close_coop',{agreement_id:agreement.id},'Agreement closed. Existing reimbursement obligations remain.')));agreements.append(row);
  }
  const reimbursements=$('credit-reimbursements');reimbursements.replaceChildren();if(!data.reimbursements.length)reimbursements.textContent='No reimbursements recorded.';
  for(const entry of data.reimbursements){const row=node('article',undefined,'shift');row.append(node('strong',money(entry.amount_cents)+' · '+entry.issuer_name+' owes '+entry.redeemer_name),node('p','Status: '+entry.status+(entry.payment_reference?' · External reference: '+entry.payment_reference:'')));
   if(entry.status==='outstanding'&&entry.issuer_eatery_id===ownEatery){const form=node('form'),reference=field('Reference for payment made outside ServCycl');reference.input.maxLength=200;const submit=node('button','Report external payment','secondary');form.append(reference.wrap,submit);form.addEventListener('submit',ev=>{ev.preventDefault();run(submit,()=>change('report_payment',{redemption_id:entry.redemption_id,reference:reference.input.value.trim()},'Payment reported. The receiving eatery must confirm receipt.'));});row.append(form);}
   if(entry.status==='payment_reported'&&entry.redeemer_eatery_id===ownEatery)row.append(button('Confirm payment received',()=>change('confirm_payment',{redemption_id:entry.redemption_id},'Receipt confirmed. Reimbursement marked settled.')));reimbursements.append(row);
  }
  const redemptions=$('credit-redemption-history');redemptions.replaceChildren();if(!data.redemptions.length)redemptions.textContent='No completed redemptions.';
  for(const entry of data.redemptions){const row=node('article',undefined,'shift');row.append(node('strong',money(entry.amount_cents)+' from '+entry.issuer_name+' · '+entry.status),node('p',new Date(entry.redeemed_at).toLocaleString()));if(entry.status==='redeemed')row.append(button('Void mistaken redemption',()=>change('void_redemption',{code:entry.id},'Redemption reversed and credits restored.')));redemptions.append(row);}
 }
 async function refresh(){
  const version=++revision,user=getUser();stopCamera();$('credit-preview').replaceChildren();
  if(!user||!db){$('credit-wallet-content').classList.add('hidden');$('credit-eatery-panel').classList.add('hidden');$('credit-session').textContent='Sign in or create an account to use your food-credit wallet.';$('credit-signin').classList.remove('hidden');$('credit-member-code').value='';['credit-lots','credit-offers','credit-codes','credit-history','credit-eatery-offers','credit-reimbursements'].forEach(id=>$(id).replaceChildren());say('');return;}
  $('credit-session').textContent='Loading food credits…';$('credit-signin').classList.add('hidden');
  try{const [wallet,eatery]=await Promise.all([request('wallet'),request('eatery')]);if(version!==revision||getUser()?.id!==user.id)return;$('credit-wallet-content').classList.remove('hidden');$('credit-session').textContent='Credits remain tied to the issuing eatery’s rules.';drawEatery(eatery);await drawWallet(wallet,version);}catch(error){if(version===revision)say(error?.message||'Unable to load food credits.');}
 }
 $('credit-nav').addEventListener('click',refresh);
 $('credit-signin').addEventListener('click',showAccount);
 $('credit-refresh').addEventListener('click',()=>refresh());
 $('credit-copy-member').addEventListener('click',()=>run($('credit-copy-member'),async()=>{if(!needUser())return;await navigator.clipboard.writeText($('credit-member-code').value);say('Member code copied. Share it with someone who wants to gift you credits.');}));
 $('credit-rules-form').addEventListener('submit',ev=>{ev.preventDefault();run($('credit-save-rules'),()=>change('rules',{transfers:$('credit-transfers').checked,coop:$('credit-coop').checked,terms:$('credit-terms').value.trim()},'Rules saved for future offers. Existing credit terms are unchanged.'));});
 $('credit-coop-form').addEventListener('submit',ev=>{ev.preventDefault();run($('credit-propose'),()=>change('propose_coop',{eatery_id:$('credit-partner').value,max_outstanding_cents:creditCents($('credit-coop-limit').value)},'Proposal sent. The other eatery must accept before credits can be redeemed there.'));});
 async function preview(){
  const code=creditCode($('credit-scan-code').value);const data=await request('preview',{code});const panel=$('credit-preview');panel.replaceChildren(node('p','Confirm '+money(data.amount_cents)+' of credits issued by '+data.issuer_name+'. This will reduce the member’s credit balance.'));
  panel.append(button('Confirm redemption '+money(data.amount_cents),()=>change('redeem',{code},'Redemption completed.')));
 }
 $('credit-scan-form').addEventListener('submit',ev=>{ev.preventDefault();run($('credit-preview-button'),preview);});
 function stopCamera(){if(timer){clearInterval(timer);timer=null;}if(camera){camera.getTracks().forEach(track=>track.stop());camera=null;}$('credit-camera').classList.add('hidden');$('credit-stop-camera').classList.add('hidden');}
 $('credit-stop-camera').addEventListener('click',stopCamera);
 $('credit-start-camera').addEventListener('click',()=>run($('credit-start-camera'),async()=>{
  if(!('BarcodeDetector' in window)||!navigator.mediaDevices?.getUserMedia)throw new Error('Camera scanning is unavailable in this browser. Paste or type the code instead.');
  stopCamera();const detector=new window.BarcodeDetector({formats:['qr_code']});camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});const video=$('credit-camera');video.srcObject=camera;video.classList.remove('hidden');$('credit-stop-camera').classList.remove('hidden');await video.play();
  timer=setInterval(async()=>{if(scanBusy)return;scanBusy=true;try{const codes=await detector.detect(video);if(codes[0]){$('credit-scan-code').value=creditCode(codes[0].rawValue);stopCamera();await preview();}}catch(error){say(error?.message||'Unable to scan this code.');}finally{scanBusy=false;}},350);
 }));
 document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>{if(el.dataset.view!=='credits')stopCamera();}));
 window.addEventListener('pagehide',stopCamera);
 const fragment=new URLSearchParams(window.location.hash.slice(1)).get('food-credit');if(fragment){try{$('credit-scan-code').value=creditCode(fragment);setTimeout(()=>$('credit-nav').click(),0);}catch{}}
 return {refresh};
}
