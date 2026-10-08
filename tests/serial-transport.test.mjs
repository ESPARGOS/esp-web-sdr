import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../serial-transport.js',import.meta.url),'utf8');
function fixture({s2=false,claimError=false}={}){
 const calls=[],pending=[];
 const alt=(cls,sub,endpoints=[])=>({interfaceClass:cls,interfaceSubclass:sub,alternateSetting:0,endpoints});
 const int=(n,a)=>({interfaceNumber:n,alternate:a,alternates:[a]});
 const input=s2?4:1,output=s2?3:1;
 const config={configurationValue:1,interfaces:[int(0,alt(2,2)),int(1,alt(10,2,[{type:'bulk',direction:'in',endpointNumber:input,packetSize:64},{type:'bulk',direction:'out',endpointNumber:output,packetSize:64}])),int(2,alt(255,255))]};
 const device={vendorId:0x303a,productId:s2?2:0x1001,opened:false,configuration:null,configurations:[config],
  async open(){this.opened=true;calls.push(['open']);},
  async selectConfiguration(n){this.configuration=config;calls.push(['configuration',n]);},
  async claimInterface(n){calls.push(['claim',n]);if(claimError)throw Error('busy');},
  async controlTransferOut(setup,data){calls.push(['control',setup,data]);return {status:'ok'};},
  transferIn(endpoint,size){calls.push(['read',endpoint,size]);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},
  async transferOut(endpoint,data){calls.push(['write',endpoint,Array.from(data)]);return {status:'ok',bytesWritten:data.length};},
  async close(){calls.push(['close']);this.opened=false;for(const p of pending.splice(0))p.reject(Error('closed'));}
 };
 const navigator={serial:{requestPort:async()=>({kind:'serial-test'})},usb:{requestDevice:async options=>{calls.push(['picker',options]);return device;},getDevices:async()=>[device,{vendorId:0x0403}]}};
 const ctx=vm.createContext({navigator,ReadableStream,WritableStream});vm.runInContext(source,ctx);
 return {api:ctx.SerialConnection,device,calls,pending};
}
for(const s2 of [false,true])test(`CDC ${s2?'S2':'JTAG'} data, line coding and partial signal updates`,async()=>{
 const {api,device,calls,pending}=fixture({s2});const p=new api.NativeUSBPort(device);
 await p.open({baudRate:2000000});
 assert.deepEqual(calls.filter(c=>c[0]==='claim').map(c=>c[1]),[0,1]);
 const coding=calls.find(c=>c[0]==='control'&&c[1].request===0x20);
 assert.deepEqual(Array.from(coding[2]),[128,132,30,0,0,0,8]);
 await p.setSignals({requestToSend:true});await p.setSignals({dataTerminalReady:false});
 assert.deepEqual(calls.filter(c=>c[0]==='control'&&c[1].request===0x22).map(c=>c[1].value),[1,3,2]);
 const reader=p.readable.getReader(),writer=p.writable.getWriter();
 const reading=reader.read();const buffer=new Uint8Array([99,1,2,3,99]);
 pending.shift().resolve({status:'ok',data:new DataView(buffer.buffer,1,3)});
 assert.deepEqual(Array.from((await reading).value),[1,2,3]);
 await writer.write(new Uint8Array([4,5]));
 assert.deepEqual(calls.find(c=>c[0]==='write'),['write',s2?3:1,[4,5]]);
 const waiting=reader.read();await reader.cancel();assert.equal((await waiting).done,true);
 reader.releaseLock();writer.releaseLock();await p.close();assert.equal(device.opened,false);
 await p.open({baudRate:115200});await p.close();
});
test('USB selection is explicit even when WebSerial exists, and granted devices stay backend-specific',async()=>{
 const {api,calls}=fixture();assert.equal(api.defaultKind(),'webserial');
 assert.equal((await api.requestPort()).kind,'serial-test');
 const p=await api.requestPort('webusb');assert.equal(p.kind,'webusb');
 assert.equal(calls.find(c=>c[0]==='picker')[1].filters[0].vendorId,0x303a);
 assert.equal((await api.getPorts('webusb')).length,1);assert.equal((await api.getPorts('webusb'))[0],p);
});
test('failed claims close the device and UART adapters are rejected',async()=>{
 const {api,device}=fixture({claimError:true});const p=new api.NativeUSBPort(device);
 await assert.rejects(p.open(),e=>{assert.equal(e.code,'USB_INTERFACE_UNAVAILABLE');assert.match(e.message,/cdc_acm/);assert.match(e.message,/choose WebSerial/);assert.equal(e.cause.message,'busy');return true;});assert.equal(device.opened,false);
 assert.throws(()=>new api.NativeUSBPort({vendorId:0x0403}),/native Espressif/);
});
test('missing CDC does not claim a JTAG interface',async()=>{
 const {api,device,calls}=fixture();device.configurations[0].interfaces.shift();
 await assert.rejects(new api.NativeUSBPort(device).open(),/no native CDC/);
 assert.equal(calls.some(c=>c[0]==='claim'),false);assert.equal(device.opened,false);
});
test('short writes and read stalls fail visibly rather than silently losing bytes',async()=>{
 const {api,device,pending}=fixture();const p=new api.NativeUSBPort(device);await p.open();
 device.transferOut=async()=>({status:'ok',bytesWritten:0});
 const writer=p.writable.getWriter();await assert.rejects(writer.write(new Uint8Array([1])),/Incomplete/);writer.releaseLock();
 const reader=p.readable.getReader();const read=reader.read();pending.shift().resolve({status:'stall'});
 await assert.rejects(read,/USB stall/);reader.releaseLock();await p.close();
});
test('bootloader reset refreshes a USB handle only for the same unambiguous device',async()=>{
 const {api,device}=fixture();device.serialNumber='board-A';
 const old=new api.NativeUSBPort({...device});
 assert.equal((await api.reconnect(old)).device,device);
 const other=new api.NativeUSBPort({...device,serialNumber:'board-B'});
 await assert.rejects(api.reconnect(other),/Choose the device again/);
 const anonymous=new api.NativeUSBPort({...device,serialNumber:undefined});
 await assert.rejects(api.reconnect(anonymous),/Choose the device again/);
});
test('read pipeline is bounded and preserves submission order',async()=>{
 const {api,device,pending}=fixture();const p=new api.NativeUSBPort(device);await p.open();
 const reader=p.readable.getReader();const first=reader.read();
 assert.equal(pending.length,8);
 const result=value=>({status:'ok',data:new DataView(new Uint8Array([value]).buffer)});
 pending[1].resolve(result(2));pending[0].resolve(result(1));
 assert.deepEqual(Array.from((await first).value),[1]);
 assert.deepEqual(Array.from((await reader.read()).value),[2]);
 await reader.cancel();reader.releaseLock();assert.equal(device.opened,false);
});

test('connection defaults follow the platform, with fallback to the available API',()=>{
 for(const [platform,serial,usb,expected] of [
  [{userAgentData:{mobile:false}},true,true,'webserial'],
  [{userAgentData:{mobile:true}},true,true,'webusb'],
  [{userAgent:'Mozilla/5.0 (Linux; Android 15)'},true,true,'webusb'],
  [{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)'},true,true,'webusb'],
  [{platform:'MacIntel',maxTouchPoints:5},true,true,'webusb'],
  [{platform:'MacIntel',maxTouchPoints:0},true,true,'webserial'],
  [{userAgentData:{mobile:true}},true,false,'webserial'],
  [{userAgentData:{mobile:false}},false,true,'webusb'],
 ]){
  const ctx=vm.createContext({navigator:{...platform,serial:serial?{}:undefined,usb:usb?{}:undefined}});
  vm.runInContext(source,ctx);assert.equal(ctx.SerialConnection.defaultKind(),expected,JSON.stringify(platform));
 }
});
