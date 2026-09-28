import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function makeRadio(){
 const context=vm.createContext({performance});vm.runInContext(source,context);
 return {radio:vm.runInContext('radio',context),crc:vm.runInContext('crc32',context)};
}
test('C6 identity negotiates buffer length without changing C5/S3 compatibility',()=>{
 const {radio}=makeRadio();
 for(const [name,n] of [['C5',16380],['S3',16380],['C6',15360],['C6',16380]]){
  radio.applyIdentity(`${name}SDR 6 burst ${n}`);
  assert.equal(radio.family,name);assert.equal(radio.maxSamples,n);
 }
 for(const bad of ['C6SDR 5 burst 16380','C6SDR 6 burst 0','C6SDR 6 burst 999999','C2SDR 6 burst 16380','C6SDR 6 burst 16380 junk'])
  assert.throws(()=>radio.applyIdentity(bad),/Unsupported/);
});
test('C6 rejects 5 GHz and fractional tuning; C5 keeps its wider range',()=>{
 const {radio}=makeRadio();radio.applyIdentity('C6SDR 6 burst 16380');
 for(const f of [2412,2437,2472,2484])assert.equal(radio.validFrequency(f),true);
 for(const f of [2400,2402,2426,2480,2500,5180,2412.5,NaN])assert.equal(radio.validFrequency(f),false);
 radio.applyIdentity('C5SDR 6 burst 16380');assert.equal(radio.validFrequency(5180),true);
});
for(const bits of [8,10])test(`C6 negotiated odd-length IQ${bits} capture decodes signed samples and checks CRC`,async()=>{
 const {radio,crc}=makeRadio();const n=4097;radio.applyIdentity(`C6SDR 6 burst ${n}`);
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

test('C6 negotiates measured analog bandwidth and sends MHz settings',async()=>{
 const {radio}=makeRadio();radio.applyIdentity('C6SDR 6 burst 16380');
 radio.applyLimits('LIMITS '+JSON.stringify({gain:[0,79,1],bandwidth:[12,54,1,0],rates:[80000000],bits:[8,10]}));
 assert.deepEqual(Array.from(radio.bandwidthRange),[12,54,1,0]);
 radio.port={};const commands=[];radio.command=async c=>commands.push(c);radio.line=async()=> 'OK';
 for(const bw of [0,12,20,39,54])await radio.tune(2484,bw);
 assert.deepEqual(commands,['FREQ 2484','BANDWIDTH 0','BANDWIDTH 12','BANDWIDTH 20','BANDWIDTH 39','BANDWIDTH 54']);
 for(const bw of [11,55,12.5])await assert.rejects(radio.tune(2484,bw),/bandwidth/);
 await assert.rejects(radio.capture({rate:40000000,bits:10,fft:1024}),/Invalid capture/);
});
test('extended C6 tuning sends exact MHz and warns without blocking capture',async()=>{
 const {radio}=makeRadio();radio.applyIdentity('C6SDR 6 burst 16380');radio.port={};
 radio.hasExtendedTune=true;radio.tuneRange=[2100,2800];
 const commands=[];radio.command=async c=>commands.push(c);radio.line=async()=> 'OK';
 for(const f of [2100,2390,2402,2413,2426,2480,2500,2800]){
  assert.equal(radio.validFrequency(f),true);
  if(f<2412||f>2484)assert.match(radio.frequencyWarning(f),/Tuning will be attempted/);
  else assert.equal(radio.frequencyWarning(f),'');
  await radio.tune(f);assert.equal(commands.at(-1),'FREQ '+f);assert.equal(radio.frequency,f);
 }
 await radio.tune(2412);assert.equal(radio.frequencyWarning(2412),'');
 const count=commands.length;
 for(const f of [2099,2801,5180,2412.5,NaN,Infinity])await assert.rejects(radio.tune(f),/whole-MHz/);
 assert.equal(commands.length,count);
});
test('old C6 firmware requires an update and rejected tuning does not change cached frequency',async()=>{
 const {radio}=makeRadio();radio.applyIdentity('C6SDR 6 burst 16380');radio.port={};
 const commands=[];radio.command=async c=>commands.push(c);radio.line=async()=>{throw Error('ERR command');};
 await assert.rejects(radio.tune(2402),/updated firmware/);assert.equal(commands.length,0);
 radio.hasExtendedTune=true;radio.tuneRange=[2100,2800];radio.frequency=2412;
 await assert.rejects(radio.tune(2402),/ERR command/);assert.equal(radio.frequency,2412);
});
