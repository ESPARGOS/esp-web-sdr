import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function makeRadio(){
 const context=vm.createContext({performance});vm.runInContext(source,context);
 return {radio:vm.runInContext('radio',context),crc:vm.runInContext('crc32',context)};
}
test('C3 identity negotiates buffer length without changing C5/S3 compatibility',()=>{
 const {radio}=makeRadio();
 for(const [name,n] of [['C5',12284],['S3',12284],['C3',16380],['C3',12284]]){
  radio.applyIdentity(`${name}SDR 6 burst ${n}`);
  assert.equal(radio.family,name);assert.equal(radio.maxSamples,n);
 }
 for(const bad of ['C3SDR 5 burst 12284','C3SDR 6 burst 0','C3SDR 6 burst 999999','C4SDR 6 burst 12284','C3SDR 6 burst 12284 junk'])
  assert.throws(()=>radio.applyIdentity(bad),/Unsupported/);
});
test('older C3 firmware remains restricted to Wi-Fi channel centers',()=>{
 const {radio}=makeRadio();radio.applyIdentity('C3SDR 6 burst 16380');
 assert.deepEqual(Array.from(radio.rxRates),[80000000]);
 for(const f of [2412,2437,2472,2484])assert.equal(radio.validFrequency(f),true);
 for(const f of [2300,2413,2480,2500,5180,2412.5,NaN])assert.equal(radio.validFrequency(f),false);
});
for(const bits of [8,10])test(`C3 negotiated odd-length IQ${bits} capture decodes signed samples and checks CRC`,async()=>{
 const {radio,crc}=makeRadio();const n=4097;radio.applyIdentity(`C3SDR 6 burst ${n}`);
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


test('C3 negotiates and sends the measured analog bandwidth through the normal viewer driver',async()=>{
 const {radio}=makeRadio();radio.applyIdentity('C3SDR 6 burst 16380');
 radio.applyLimits('LIMITS {"gain":[0,79,1],"bandwidth":[14,62,1,0],"rates":[80000000],"bits":[8,10]}');
 assert.deepEqual(Array.from(radio.bandwidthRange),[14,62,1,0]);
 radio.port={};const commands=[];
 radio.command=async c=>commands.push(c);radio.line=async()=> 'OK';
 await radio.tune(2412,20);
 assert.deepEqual(commands,['FREQ 2412','BANDWIDTH 20']);
 await radio.tune(2412,20);assert.equal(commands.length,2);
 await radio.tune(2484,62);await radio.tune(2484,0);
 assert.deepEqual(commands.slice(2),['FREQ 2484','BANDWIDTH 62','BANDWIDTH 0']);
 for(const bad of [13,63,20.5])await assert.rejects(radio.tune(2412,bad),/analog bandwidth/);
 await assert.rejects(radio.tune(2413,20),/extended tuning/);
});

test('extended C3 tuning attempts exact MHz and warns without blocking capture',async()=>{
 const {radio}=makeRadio();radio.applyIdentity('C3SDR 6 burst 16380');
 radio.hasExtendedTune=true;radio.tuneRange=[2100,2800];
 radio.applyLimits('LIMITS {"gain":[0,79,1],"bandwidth":[14,62,1,0],"rates":[80000000],"bits":[8,10]}');
 radio.port={};const commands=[];
 radio.command=async c=>commands.push(c);radio.line=async()=> 'OK';
 for(const f of [2100,2300,2390,2402,2413,2426,2480,2500,2700,2800]){
  assert.equal(radio.validFrequency(f),true);await radio.tune(f,20);
  assert.equal(commands.at(-1),f===2100?'BANDWIDTH 20':`FREQ ${f}`);
 }
 for(const f of [2100,2300,2484,2500,2800])assert.match(radio.frequencyWarning(f),/Outside.*ISM/);
 for(const f of [2400,2402,2412,2413,2426,2480,2483])assert.equal(radio.frequencyWarning(f),'');
 for(const f of [2099,2801,5180,2412.5,NaN])assert.equal(radio.validFrequency(f),false);
 await assert.rejects(radio.tune(2801,20),/2100 to 2800/);
});
