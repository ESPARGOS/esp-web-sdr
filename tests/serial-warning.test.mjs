import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
function fixture(){
 const ctx=vm.createContext({performance});vm.runInContext(source,ctx);
 const radio=vm.runInContext('radio',ctx),crc=vm.runInContext('crc32',ctx);
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 Object.assign(ctx,{$,connected:true});
 vm.runInContext(app.slice(app.indexOf('let serialWarningDismissedAt='),app.indexOf('function state(){')),ctx);
 radio.onCaptureError=()=>vm.runInContext('serialWarning()',ctx);
 radio.hasSpec=true;radio.hasSpecN=true;radio.rxRates=[80000000];radio.transport='UART';radio.supportsBaudChange=true;
 radio.applySpectrumCapabilities('SPECINFO '+JSON.stringify({continuous:false,transports:['UART'],profiles:[[80000000,0,256,1,1]]}));
 radio.run=fn=>fn();radio.tune=async()=>{};radio.setGain=async()=>0;
 radio.command=async()=>{};radio.line=async()=> 'SPEC 256 80000000 12288 2412';
 const frame=new Uint8Array(288),v=new DataView(frame.buffer);frame.set([83,80,67,49]);frame[26]=8;frame[27]=2;v.setUint32(284,crc(frame.subarray(0,284)),true);
 const bad=frame.slice();bad[70]^=1;
 async function stream(chunks){radio.read=async()=>{assert.ok(chunks.length);return chunks.shift();};return radio.spec({rate:80000000,fft:256,frequency:2412},()=>{},()=>false);}
 const end=new TextEncoder().encode('SPECEND 0 0 2 512 10000 0 0 2 0 0 2 1\n');
 return {ctx,radio,$,frame,bad,end,stream};
}
test('spectrum corruption triggers the baud warning without a valid frame, across stream restarts',async()=>{
 const {radio,$,bad,end,stream}=fixture();
 await stream([bad,bad,end]);assert.equal(radio.spectrumCrcErrors,2);assert.equal($('serialWarning').hidden,true);
 let notices=0;const notify=radio.onCaptureError;radio.onCaptureError=()=>{notices++;notify();};
 const info=await stream([bad,end]);
 assert.equal(notices,1);assert.equal(info.crcErrors,1);assert.equal(radio.spectrumCrcErrors,3);
 assert.equal($('serialWarning').hidden,false);assert.equal($('lowerBaud').hidden,false);
 assert.match($('serialWarningText').textContent,/CRC.*slower serial/);
 radio.applyIdentity('ESP32SDR 6 burst 16380');radio.onCaptureError();
 assert.equal(radio.spectrumCrcErrors,0);assert.equal($('serialWarning').hidden,true);
});
test('healthy spectra and host backlog drops do not trigger a CRC warning',async()=>{
 const {radio,$,frame,end,stream}=fixture();
 radio.onCaptureError();await stream([frame,frame,frame,end]);radio.hostDropped=999999;radio.onCaptureError();
 assert.equal(radio.spectrumCrcErrors,0);assert.equal($('serialWarning').hidden,true);
});
test('raw capture warning and USB / 1 MBaud guidance remain available',()=>{
 const {ctx,radio,$}=fixture();radio.droppedCaptures=3;radio.onCaptureError();
 assert.equal($('serialWarning').hidden,false);assert.equal($('lowerBaud').hidden,false);
 radio.baudRate=1000000;radio.onCaptureError();assert.equal($('lowerBaud').hidden,true);assert.match($('serialWarningText').textContent,/1 MBaud/);
 radio.transport='USB';radio.onCaptureError();assert.equal($('lowerBaud').hidden,true);assert.match($('serialWarningText').textContent,/USB connection/);
 ctx.connected=false;radio.onCaptureError();assert.equal($('serialWarning').hidden,true);
});

test('dismissal survives healthy frames and stream restarts, then warns on three new errors',async()=>{
 const {radio,$,frame,bad,end,stream}=fixture();
 await stream([bad,bad,bad,end]);
 assert.equal($('serialWarning').hidden,false);
 $('dismissSerialWarning').onclick();
 assert.equal($('serialWarning').hidden,true);
 assert.equal(radio.spectrumCrcErrors,3);
 await stream([frame,frame,end]);radio.onCaptureError();
 assert.equal($('serialWarning').hidden,true);
 await stream([bad,bad,end]);
 assert.equal($('serialWarning').hidden,true);
 await stream([bad,end]);
 assert.equal($('serialWarning').hidden,false);
 assert.equal(radio.spectrumCrcErrors,6);
 $('dismissSerialWarning').onclick();radio.onCaptureError();
 assert.equal($('serialWarning').hidden,true);
});

test('dismissal preserves both error counters and counts new raw and spectrum errors together',()=>{
 const {radio,$}=fixture();
 radio.droppedCaptures=2;radio.spectrumCrcErrors=3;radio.onCaptureError();
 $('dismissSerialWarning').onclick();
 assert.equal(radio.droppedCaptures,2);assert.equal(radio.spectrumCrcErrors,3);
 radio.droppedCaptures++;radio.spectrumCrcErrors++;radio.onCaptureError();
 assert.equal($('serialWarning').hidden,true);
 radio.droppedCaptures++;radio.onCaptureError();
 assert.equal($('serialWarning').hidden,false);
});

for(const reset of ['disconnect','device identity'])test(`dismissal resets after ${reset}`,()=>{
 const {ctx,radio,$}=fixture();
 radio.droppedCaptures=20;radio.onCaptureError();$('dismissSerialWarning').onclick();
 if(reset==='disconnect'){
  ctx.connected=false;radio.onCaptureError();assert.equal($('serialWarning').hidden,true);
  radio.droppedCaptures=0;ctx.connected=true;
 }else radio.applyIdentity('ESP32SDR 6 burst 16380');
 radio.onCaptureError();assert.equal($('serialWarning').hidden,true);
 radio.droppedCaptures=3;radio.onCaptureError();
 assert.equal($('serialWarning').hidden,false);
});

test('tuning-warning dismissal lasts for the selected frequency and resets on reconnect',()=>{
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{classList:{toggle(){}}});return elements.get(id);};
 const c=vm.createContext({$,connected:true,tuneFrequency:2600,radio:{frequencyWarning:frequency=>frequency>2483?'Outside ISM band':''}});
 vm.runInContext(app.slice(app.indexOf('let dismissedTuningFrequency='),app.indexOf('let dismissedFirmwareVersion=')),c);
 c.tuningWarning();assert.equal($('tuningWarning').hidden,false);
 $('dismissTuningWarning').onclick();c.tuningWarning();assert.equal($('tuningWarning').hidden,true);
 c.tuneFrequency=2610;c.tuningWarning();assert.equal($('tuningWarning').hidden,false);
 $('dismissTuningWarning').onclick();c.connected=false;c.tuningWarning();c.connected=true;c.tuningWarning();
 assert.equal($('tuningWarning').hidden,false);
 c.tuneFrequency=2442;c.tuningWarning();assert.equal($('tuningWarning').hidden,true);
});
