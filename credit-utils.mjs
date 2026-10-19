export function creditCents(value){
 const text=String(value).trim();
 if(!/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,2})?$/.test(text))throw new Error('Enter an amount with no more than two decimal places.');
 const [whole,fraction='']=text.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(cents<1||cents>10000000)throw new Error('Enter an amount from $0.01 to $100,000.00.');return cents;
}
export function creditCode(value){
 let code=String(value).trim();
 if(code.startsWith('https://')){let url;try{url=new URL(code);}catch{throw new Error('Invalid credit code.');}if(!['https://servcycl.com','https://www.servcycl.com'].includes(url.origin)||url.pathname!=='/')throw new Error('Use a ServCycl food-credit QR code.');code=new URLSearchParams(url.hash.slice(1)).get('food-credit')||'';}
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code))throw new Error('Enter or scan a valid food-credit code.');return code.toLowerCase();
}
export const creditMoney=cents=>(Number(cents)/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
