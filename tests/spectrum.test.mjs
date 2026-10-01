import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function fixture(){const ctx=vm.createContext({performance});vm.runInContext(source,ctx);return {
 decoder:n=>vm.runInContext(`new SpectrumDecoder(${n})`,ctx),
 crc:vm.runInContext('crc32',ctx),radio:vm.runInContext('radio',ctx)};}
function frame(crc,n,seq=0){const b=new Uint8Array(n+32),v=new DataView(b.buffer);b.set([83,80,67,49]);v.setUint32(4,seq,true);v.setBigUint64(8,BigInt(seq*12345),true);v.setUint32(16,n,true);v.setUint16(20,1,true);b[26]=Math.log2(n);b[27]=2;b.fill(73,28,n+28);v.setUint32(n+28,crc(b.subarray(0,n+28)),true);return b;}
const report='SPECEND 0 0 2 512 10000 0 0 2 0 0 2 1\n';
test('spectrum decoder accepts all FFT sizes under arbitrary serial fragmentation',()=>{
 const f=fixture();for(const n of [256,512,1024,2048])for(const chunk of [1,7,64,513]){
  const d=f.decoder(n),b=frame(f.crc,n),events=[];
  for(let i=0;i<b.length;i+=chunk)events.push(...d.feed(b.subarray(i,i+chunk)));
  assert.equal(events.length,1);assert.equal(events[0].header.n,n);assert.equal(events[0].bins.length,n);assert.equal(d.crcErrors,0);
 }
});
test('spectrum decoder resynchronizes after garbage, a corrupted frame, and a truncated tail',()=>{
 const f=fixture(),d=f.decoder(256),bad=frame(f.crc,256);bad[70]^=1;
 const bytes=Uint8Array.from([...new TextEncoder().encode('boot\r\n'),...bad,...frame(f.crc,256,1),...frame(f.crc,256,2).slice(0,65),...new TextEncoder().encode(report)]);
 const events=[];for(let i=0;i<bytes.length;i+=13)events.push(...d.feed(bytes.subarray(i,i+13)));
 assert.equal(events.length,2);assert.equal(events[0].header.frame,1);assert.equal(events[1].report,report.trim());assert.ok(d.crcErrors>=2);
});
test('spectrum profiles gate both the transport and the actual chip rates',()=>{
 const {radio}=fixture();radio.hasSpec=true;radio.rxRates=[80000000];radio.transport='UART';
 radio.applySpectrumCapabilities('SPECINFO '+JSON.stringify({continuous:false,transports:['USB','UART'],profiles:[[80000000,0,512,1,1]]}));
 assert.equal(radio.canStreamSpectrum,true);assert.equal(radio.spectrumProfiles(40000000).length,0);
 assert.throws(()=>radio.applySpectrumCapabilities('SPECINFO '+JSON.stringify({continuous:true,transports:['USB'],profiles:[[40000000,1,256,4,1]]})),/Invalid spectrum/);
 radio.hasSpec=false;assert.equal(radio.canStreamSpectrum,false);
});
test('mixed capabilities label continuous and snapshot profiles separately',()=>{
 const {radio}=fixture();radio.hasSpec=true;radio.rxRates=[80000000];radio.transport='USB';
 const caps={continuous:false,transports:['USB'],profiles:[[80000000,0,256,1,1,1],[80000000,0,1024,1,1,0]]};
 radio.applySpectrumCapabilities('SPECINFO '+JSON.stringify(caps));
 assert.equal(radio.spectrumContinuous(80000000,256),true);
 assert.equal(radio.spectrumContinuous(80000000,1024),false);
 radio.transport='UART';assert.equal(radio.canStreamSpectrum,false);
 caps.profiles[0][5]=2;assert.throws(()=>radio.applySpectrumCapabilities('SPECINFO '+JSON.stringify(caps)),/Invalid spectrum/);
});
test('a missing stream boundary marks the connection failed before ordinary reuse',async()=>{
 const {radio}=fixture();radio.hasSpec=true;radio.hasSpecN=true;radio.rxRates=[80000000];radio.transport='USB';
 radio.applySpectrumCapabilities('SPECINFO '+JSON.stringify({continuous:true,transports:['USB'],profiles:[[80000000,0,256,1,1]]}));
 radio.run=fn=>fn();radio.tune=async()=>{};radio.setGain=async()=>0;radio.writer={};
 const commands=[];radio.command=async c=>commands.push(c);radio.line=async()=> 'SPEC 256 80000000 12288 2412';
 radio.read=async()=>{throw Error('reader stalled');};
 await assert.rejects(radio.spec({rate:80000000,fft:256,frequency:2412},()=>{},()=>false),/reader stalled/);
 assert.match(String(radio.failed),/reader stalled/);assert.equal(radio.lossy,false);assert.equal(commands.at(-1),'');
});
