import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function makeRadio(){
 const context=vm.createContext({performance});vm.runInContext(source,context);
 return {radio:vm.runInContext('radio',context),crc:vm.runInContext('crc32',context)};
}
test('C2 identity negotiates buffer length without changing C5/S3 compatibility',()=>{
 const {radio}=makeRadio();
 for(const [name,n] of [['C5',12284],['S3',12284],['C2',8190],['C2',4096]]){
  radio.applyIdentity(`${name}SDR 6 burst ${n}`);
  assert.equal(radio.family,name);assert.equal(radio.maxSamples,n);
 }
 for(const bad of ['C2SDR 5 burst 12284','C2SDR 6 burst 0','C2SDR 6 burst 999999','C4SDR 6 burst 12284','C2SDR 6 burst 12284 junk'])
  assert.throws(()=>radio.applyIdentity(bad),/Unsupported/);
});
test('C2 without extended tuning capability uses safe Wi-Fi channel centers',()=>{
 const {radio}=makeRadio();radio.applyIdentity('C2SDR 6 burst 8190');
 assert.deepEqual(Array.from(radio.rxRates),[80000000]);
 for(const f of [2412,2437,2472,2484])assert.equal(radio.validFrequency(f),true);
 for(const f of [2300,2413,2480,2500,5180,2412.5,NaN])assert.equal(radio.validFrequency(f),false);
});
for(const bits of [8,10])test(`C2 negotiated odd-length IQ${bits} capture decodes signed samples and checks CRC`,async()=>{
 const {radio,crc}=makeRadio();const n=4097;radio.applyIdentity(`C2SDR 6 burst ${n}`);
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
 radio.line=async()=>`DATA 12284 0 250`;
 await assert.rejects(radio.capture({frequency:2412,rate:80000000,bits,fft:512}),/capture length/);
});



test('C2 negotiates UART snapshot spectra and leaves uncalibrated bandwidth disabled',()=>{
 const {radio}=makeRadio();radio.applyIdentity('C2SDR 6 burst 8190');
 radio.applyLimits('LIMITS {"gain":[0,79,1],"bandwidth":null,"rates":[80000000],"bits":[8,10]}');
 assert.equal(radio.bandwidthRange,null);
 radio.transport='UART';
 radio.applySpectrumCapabilities('SPECINFO {"continuous":false,"transports":["UART"],"profiles":[[80000000,0,256,1,1,0],[80000000,0,2048,1,1,0]]}');
 assert.deepEqual(Array.from(radio.rxRates),[80000000]);
});

test('C2 extended tuning uses the negotiated range',()=>{
 const {radio}=makeRadio();radio.applyIdentity('C2SDR 6 burst 8190');
 radio.hasExtendedTune=true;radio.tuneRange=[100,6000];
 for(const f of [100,2300,2413,2484,6000])assert.equal(radio.validFrequency(f),true);
 assert.match(radio.frequencyWarning(2300),/Outside/);
 assert.equal(radio.frequencyWarning(2413),'');
});


test('C2 controls negotiate three rates and approximate analog bandwidth',()=>{
 const {radio}=makeRadio();radio.applyIdentity('C2SDR 6 burst 8190');
 radio.applyLimits('LIMITS {"gain":[0,79,1],"bandwidth":[12,20,1,0],"rates":[80000000,40000000,16000000],"bits":[8,10]}');
 assert.deepEqual(Array.from(radio.rxRates),[80000000,40000000,16000000]);
 assert.deepEqual(Array.from(radio.bandwidthRange),[12,20,1,0]);
 radio.transport='UART';
 radio.applySpectrumCapabilities('SPECINFO {"continuous":false,"transports":["UART"],"profiles":[[80000000,0,2048,1,1,0],[40000000,1,2048,1,1,0],[16000000,6,2048,1,1,0]]}');
});
