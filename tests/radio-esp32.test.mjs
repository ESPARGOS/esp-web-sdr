import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function makeRadio(){const c=vm.createContext({performance});vm.runInContext(source,c);return vm.runInContext('radio',c);}
test('original ESP32 negotiates UART snapshot capabilities and channel tuning',async()=>{
 const r=makeRadio();r.applyIdentity('ESP32SDR 6 burst 16380');
 r.applyLimits('LIMITS {"gain":[0,72,1],"bandwidth":null,"rates":[80000000,40000000,16000000],"bits":[8,10]}');
 assert.equal(r.family,'ESP32');assert.equal(r.maxSamples,16380);assert.equal(r.gainMax,72);
 assert.deepEqual(Array.from(r.rxRates),[80000000,40000000,16000000]);assert.equal(r.bandwidthRange,null);
 r.port={};const commands=[];r.command=async c=>commands.push(c);r.line=async()=> 'OK';
 for(let f=2412;f<=2472;f+=5){assert.equal(r.validFrequency(f),true);await r.tune(f);assert.equal(commands.at(-1),'FREQ '+f);}
 for(const f of [2402,2413,2426,2480,2484,5180,2412.5]){assert.equal(r.validFrequency(f),false);await assert.rejects(r.tune(f),/5 MHz steps/);}
 await assert.rejects(r.tune(2412,20),/not characterized/);
 r.hasGain=true;r.hasHardwareAgc=true;r.line=async p=>p==='OK'?'OK':'GAIN MANUAL 72 0 72 1';
 assert.equal((await r.setGain('MANUAL',72)).index,72);await assert.rejects(r.setGain('MANUAL',73),/gain index/);
 for(const rate of [4000000,8000000,20000000])await assert.rejects(r.capture({rate,bits:8,fft:512}),/Invalid capture/);
});

test('original ESP32 exposes measured MHz control through capability negotiation',async()=>{
 const r=makeRadio();r.applyIdentity('ESP32SDR 6 burst 16380');
 r.applyLimits('LIMITS {"gain":[0,72,1],"bandwidth":[12,67,1,0],"rates":[80000000,40000000,16000000],"bits":[8,10]}');
 assert.deepEqual(Array.from(r.bandwidthRange),[12,67,1,0]);
 r.port={};const commands=[];r.command=async c=>commands.push(c);r.line=async()=> 'OK';
 for(const bw of [0,12,20,40,67])await r.tune(2412,bw);
 assert.deepEqual(commands,['FREQ 2412','BANDWIDTH 0','BANDWIDTH 12','BANDWIDTH 20','BANDWIDTH 40','BANDWIDTH 67']);
 for(const bw of [11,68,20.5])await assert.rejects(r.tune(2412,bw),/bandwidth/);
});
