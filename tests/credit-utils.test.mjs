import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {creditCents,creditCode} from '../credit-utils.mjs';
const require=createRequire(import.meta.url),qrcode=require('../vendor/qrcode.js');
test('credit amounts convert exactly and reject fractions of a cent, negatives and exponent notation',()=>{assert.equal(creditCents('0.01'),1);assert.equal(creditCents('19.95'),1995);assert.equal(creditCents('100000.00'),10000000);for(const value of ['0','-1','1.001','1e2','100000.01','Infinity','NaN'])assert.throws(()=>creditCents(value));});
test('QR parser accepts ServCycl fragments and rejects foreign or malformed links',()=>{const id='12345678-1234-4123-8123-123456789abc';assert.equal(creditCode(id.toUpperCase()),id);assert.equal(creditCode('https://servcycl.com/#food-credit='+id),id);assert.throws(()=>creditCode('https://malicious.invalid/#food-credit='+id));assert.throws(()=>creditCode('https://servcycl.com/other#food-credit='+id));assert.throws(()=>creditCode('javascript:alert(1)'));});
test('pinned local QR library generates a complete SVG with no remote image dependency',()=>{const qr=qrcode(0,'M');qr.addData('https://servcycl.com/#food-credit=12345678-1234-4123-8123-123456789abc');qr.make();const svg=qr.createSvgTag({cellSize:4,margin:4,scalable:true});assert.match(svg,/<svg/);assert.match(svg,/viewBox=/);assert.ok(qr.getModuleCount()>=21);assert.ok(!svg.includes('<image'));assert.ok(!svg.includes('<script'));});
