import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function makeRadio(){
 const context=vm.createContext({performance});vm.runInContext(source,context);
 return {radio:vm.runInContext('radio',context),crc:vm.runInContext('crc32',context)};
}
test('C61 identity negotiates buffer length without changing C5/S3 compatibility',()=>{
 const {radio}=makeRadio();
 for(const [name,n] of [['C5',16380],['S3',16380],['C61',15360],['C61',16380]]){
  radio.applyIdentity(`${name}SDR 6 burst ${n}`);
  assert.equal(radio.family,name);assert.equal(radio.maxSamples,n);
 }
 for(const bad of ['C61SDR 5 burst 16380','C61SDR 6 burst 0','C61SDR 6 burst 999999','C4SDR 6 burst 16380','C61SDR 6 burst 16380 junk'])
  assert.throws(()=>radio.applyIdentity(bad),/Unsupported/);
});
test('C61 rejects 5 GHz and fractional tuning; C5 keeps its wider range',()=>{
 const {radio}=makeRadio();radio.applyIdentity('C61SDR 6 burst 16380');
 for(const f of [2400,2402,2412,2484,2500])assert.equal(radio.validFrequency(f),true);
 for(const f of [2399,2501,5180,2412.5,NaN])assert.equal(radio.validFrequency(f),false);
 radio.applyIdentity('C5SDR 6 burst 16380');assert.equal(radio.validFrequency(5180),true);
});
for(const bits of [8,10])test(`C61 negotiated odd-length IQ${bits} capture decodes signed samples and checks CRC`,async()=>{
 const {radio,crc}=makeRadio();const n=4097;radio.applyIdentity(`C61SDR 6 burst ${n}`);
 radio.tune=async()=>{};radio.setGain=async()=>({mode:'HARDWARE',index:null});
 const commands=[];radio.command=async c=>commands.push(c);
 // Full negative I, maximum positive Q; IQ8 truncates the low two bits.
 const bytes=new Uint8Array(Math.ceil(n*bits*2/8));
 if(bits===8)for(let j=0;j<n;j++){bytes[2*j]=128;bytes[2*j+1]=127;}
 else for(let j=0;j<n;j++){
  const w=512|(511<<10);
  for(let b=0;b<20;b++)if(w&(1<<b))bytes[(j*20+b)>>3]|=1<<((j*20+b)&7);
 }
 radio.line=async()=>`DATA ${n} ${crc(bytes).toString(16)} 250`;
 radio.read=async size=>{assert.equal(size,bytes.length);return bytes;};
 const frame=await radio.capture({frequency:2412,rate:80000000,bits,fft:512});
 assert.deepEqual(commands,[`CAP${bits*2} ${n} 0`]);assert.equal(frame.samples,n);
 assert.equal(frame.iq[0],-1);assert.equal(frame.iq.at(-1),bits===8?-508/512:-511/512);
 bytes[0]^=1;
 radio.line=async()=>`DATA ${n} 0 250`;
 await assert.rejects(radio.capture({frequency:2412,rate:80000000,bits,fft:512}),/CRC mismatch/);
 radio.line=async()=>`DATA 16380 0 250`;
 await assert.rejects(radio.capture({frequency:2412,rate:80000000,bits,fft:512}),/capture length/);
});
