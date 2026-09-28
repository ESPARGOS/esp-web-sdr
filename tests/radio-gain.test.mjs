import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function makeRadio(){
 const context=vm.createContext({});vm.runInContext(source,context);
 const radio=vm.runInContext('radio',context);radio.applyLimits('LIMITS {"gain":[0,76,1],"bandwidth":[13,54,1,0],"rates":[80000000],"bits":[8,10]}');radio.hasGain=true;radio.hasHardwareAgc=true;
 const commands=[];radio.command=async value=>commands.push(value);
 radio.line=async prefix=>prefix==='OK'?'OK':'GAIN HARDWARE -1 0 50 0';
 return {radio,commands};
}
test('default gain command selects hardware AGC',async()=>{
 const {radio,commands}=makeRadio();const gain=await radio.setGain();
 assert.deepEqual(commands,['GAIN HARDWARE','GAIN?']);assert.equal(gain.mode,'HARDWARE');assert.equal(gain.index,null);
});
test('manual gain still applies the selected index',async()=>{
 const {radio,commands}=makeRadio();radio.line=async prefix=>prefix==='OK'?'OK':'GAIN MANUAL 23 0 50 1';
 const gain=await radio.setGain('MANUAL',23);
 assert.deepEqual(commands,['GAIN MANUAL 23','GAIN?']);assert.equal(gain.index,23);
});
test('software mode is rejected without sending a command',async()=>{
 const {radio,commands}=makeRadio();await assert.rejects(radio.setGain('AUTO',40));assert.equal(commands.length,0);
});
test('missing hardware AGC never falls back to software AGC',async()=>{
 const {radio,commands}=makeRadio();radio.hasHardwareAgc=false;
 await assert.rejects(radio.setGain(),/hardware AGC/);assert.equal(commands.length,0);
});
test('software gain responses are rejected',async()=>{
 const {radio}=makeRadio();radio.line=async prefix=>prefix==='OK'?'OK':'GAIN AUTO 40 0 50 1';
 await assert.rejects(radio.setGain(),/Invalid gain response/);
});
