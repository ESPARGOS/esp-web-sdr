import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
const limits={gain:[0,76,1],bandwidth:[13,54,1,0],rates:[16000000,8000000,4000000],bits:[8]};
function makeRadio(){const context=vm.createContext({performance});vm.runInContext(source,context);return vm.runInContext('radio',context);}
const reply=value=>'LIMITS '+JSON.stringify(value);
test('S31 negotiates its capture size, rates and native precision',async()=>{
 const radio=makeRadio();radio.applyIdentity('S31SDR 6 burst 16384');radio.applyLimits(reply(limits));
 assert.equal(radio.family,'S31');assert.equal(radio.maxSamples,16384);assert.equal(radio.gainMax,76);
 assert.equal(radio.validFrequency(2300),true);assert.equal(radio.validFrequency(2800),true);
 assert.equal(radio.validFrequency(2299),false);assert.equal(radio.validFrequency(5180),false);
 await assert.rejects(radio.capture({rate:16000000,bits:10,fft:2048}),/Invalid capture/);
 await assert.rejects(radio.capture({rate:80000000,bits:8,fft:2048}),/Invalid capture/);
});
test('malformed receiver capabilities cannot enable arbitrary control ranges',()=>{
 const radio=makeRadio();
 for(const bad of [null,{}, {...limits,gain:[0,500,1]}, {...limits,gain:[0,76,0]}, {...limits,gain:[30,20,1]}, {...limits,gain:[0,76.5,1]}, {...limits,bandwidth:[13,54,1,12]}, {...limits,bandwidth:[0,54,1,0]}, {...limits,bandwidth:[13,54,0,0]}, {...limits,rates:[]}, {...limits,rates:[16000001]}, {...limits,bits:[12]}])assert.throws(()=>radio.applyLimits(reply(bad)),/Invalid receiver limits/);
 assert.throws(()=>radio.applyLimits('LIMITS broken'),/Invalid receiver limits/);
});
test('MHz requests are validated before sending commands and cached after acknowledgement',async()=>{
 const radio=makeRadio();radio.applyIdentity('C61SDR 6 burst 16380');radio.applyLimits(reply(limits));radio.port={};
 const commands=[];radio.command=async c=>commands.push(c);radio.line=async()=> 'OK';
 await radio.tune(2412,21);await radio.tune(2412,21);await radio.tune(2412,0);
 assert.deepEqual(commands,['FREQ 2412','BANDWIDTH 21','BANDWIDTH 0']);
 for(const bw of [-1,12,55,20.5,NaN])await assert.rejects(radio.tune(2412,bw),/bandwidth/);
 assert.equal(commands.length,3);
});
test('uncharacterized filters remain automatic instead of receiving an invented MHz code',async()=>{
 const radio=makeRadio();radio.applyLimits(reply({...limits,bandwidth:null}));radio.port={};
 const commands=[];radio.command=async c=>commands.push(c);radio.line=async()=> 'OK';
 await radio.tune(2412,0);assert.deepEqual(commands,['FREQ 2412']);
 await assert.rejects(radio.tune(2412,20),/not characterized/);
});
test('gain ranges come from the device, including their lower bound and step',async()=>{
 const radio=makeRadio();radio.applyLimits(reply({...limits,gain:[2,82,2]}));radio.hasGain=true;radio.hasHardwareAgc=true;
 const commands=[];radio.command=async c=>commands.push(c);radio.line=async p=>p==='OK'?'OK':'GAIN MANUAL 82 2 82 1';
 const gain=await radio.setGain('MANUAL',82);assert.equal(gain.index,82);
 for(const value of [0,3,83])await assert.rejects(radio.setGain('MANUAL',value),/gain index/);
 assert.deepEqual(commands,['GAIN MANUAL 82','GAIN?']);
});
