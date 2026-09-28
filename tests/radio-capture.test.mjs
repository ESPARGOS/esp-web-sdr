import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function receiver(corrupt=false){
 const context=vm.createContext({performance});vm.runInContext(source,context);
 const radio=vm.runInContext('radio',context),commands=[];
 const bytes=new Uint8Array(16380*2);bytes.fill(16);
 context.bytes=bytes;const crc=vm.runInContext('crc32(bytes)',context);
 radio.tune=async()=>{};radio.setGain=async()=>({mode:'HARDWARE',index:null});
 radio.command=async command=>commands.push(command);
 radio.line=async()=>`DATA 16380 ${(corrupt?crc^1:crc).toString(16)} 205`;
 radio.read=async()=>bytes;
 return {radio,commands};
}
const config={frequency:2412,rate:80000000,bits:8,fft:512,filter:'AUTO',analogFilter:'AUTO'};
test('receive-only driver still decodes and validates captured IQ',async()=>{
 const {radio,commands}=receiver();const frame=await radio.capture(config);
 assert.deepEqual(commands,['CAP16 16380 0']);
 assert.equal(frame.samples,16380);assert.equal(frame.iq[0],.125);assert.equal(frame.iq[1],-.125);
 assert.equal(frame.rate,80000000);assert.equal(frame.spectrum.length,512);
 assert.equal(frame.crc_ok,true);
});
test('corrupt capture is rejected',async()=>{
 const {radio}=receiver(true);await assert.rejects(radio.capture(config),/CRC mismatch/);
});
