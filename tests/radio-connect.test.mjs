import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const connectionSource=await readFile(new URL('../serial-transport.js',import.meta.url),'utf8');
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
function makeRadio(timer=(f)=>f()){
 const context=vm.createContext({performance,setTimeout:timer});
 vm.runInContext(connectionSource,context);vm.runInContext(source,context);return vm.runInContext('radio',context);
}
test('UART bridges exit reset and ROM download mode before synchronization',async()=>{
 for(const vendor of [0x10c4,0x1a86,0x0403,0x067b]){
  const events=[];
  const r=makeRadio((f,ms)=>{events.push(ms);f();});
  r.port={getInfo:()=>({usbVendorId:vendor}),setSignals:async s=>events.push({...s})};
  await r.startUartFirmware();
  assert.deepEqual(events,[{dataTerminalReady:false,requestToSend:true},100,
   {dataTerminalReady:false,requestToSend:false}]);
 }
});
test('native USB and unidentified ports do not receive UART reset signals',async()=>{
 for(const info of [{usbVendorId:0x303a},{}]){
  const r=makeRadio();r.port={getInfo:()=>info,setSignals:()=>assert.fail('unexpected UART reset')};
  await r.startUartFirmware();
 }
});
test('connect resets a UART bridge before sending the synchronization marker',async()=>{
 const events=[];
 const port={open:async()=>events.push('open'),getInfo:()=>({usbVendorId:0x10c4}),
  setSignals:async s=>events.push(s.requestToSend?'reset':'run'),
  readable:{getReader:()=>({})},writable:{getWriter:()=>({})}};
 const context=vm.createContext({performance,setTimeout:f=>f(),isSecureContext:true,
  navigator:{serial:{requestPort:async()=>port}}});
 vm.runInContext(connectionSource,context);vm.runInContext(source,context);const r=vm.runInContext('radio',context);
 r.close=async()=>{};r.pump=async()=>{};
 r.synchronize=async()=>{events.push('sync');assert.deepEqual(events,['open','reset','run','sync']);};
 r.command=async()=>{};
 const responses=['ESP32SDR 6 burst 16380','CAPS RXLIMITS',
  'LIMITS {"gain":[0,72,1],"bandwidth":[12,67,1,0],"rates":[80000000,40000000,16000000],"bits":[8,10]}'];
 r.line=async()=>responses.shift();
 assert.equal((await r.connect()).family,'ESP32');
 assert.equal(responses.length,0);
});
