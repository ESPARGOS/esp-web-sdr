import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const connectionSource=await readFile(new URL('../serial-transport.js',import.meta.url),'utf8');
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
test('remembered USB identities never silently select between identical boards',async()=>{
 const port=()=>({getInfo:()=>({usbVendorId:0x303a,usbProductId:0x1001})}),a=port(),b=port();let ports=[a],picks=0;
 const ctx=vm.createContext({localStorage:{getItem:()=>JSON.stringify({vid:0x303a,pid:0x1001})},navigator:{serial:{getPorts:async()=>ports,requestPort:async()=>{picks++;return b;}}}});
 vm.runInContext(connectionSource,ctx);
 vm.runInContext(source.slice(source.indexOf("const PORT_KEY="),source.indexOf("$('connect').title=")),ctx);
 const choose=vm.runInContext('choosePort',ctx);
 assert.equal(await choose({auto:true}),a);assert.equal(picks,0);
 ports=[a,b];assert.equal(await choose({auto:true}),null);assert.equal(picks,0);
 assert.equal(await choose({}),b);assert.equal(picks,1);
 ports=[a];assert.equal(await choose({choosePort:true}),b);assert.equal(picks,2);
 ports=[];assert.equal(await choose({auto:true}),null);assert.equal(picks,2);
});
test('remembered USB connections stay on USB and explicit selection ignores remembered ports',async()=>{
 let serialPicks=0,usbPicks=0;const device={vendorId:0x303a,productId:0x1001};
 const ctx=vm.createContext({localStorage:{getItem:()=>JSON.stringify({vid:0x303a,pid:0x1001,kind:'webusb'})},navigator:{
  serial:{getPorts:async()=>[],requestPort:async()=>{serialPicks++;}},
  usb:{getDevices:async()=>[device],requestDevice:async()=>{usbPicks++;return device;}}
 }});
 vm.runInContext(connectionSource,ctx);
 vm.runInContext(source.slice(source.indexOf('const PORT_KEY='),source.indexOf("$('connect').title=")),ctx);
 const choose=vm.runInContext('choosePort',ctx);
 assert.equal((await choose({auto:true})).kind,'webusb');assert.equal(usbPicks,0);
 assert.equal((await choose({choosePort:true,kind:'webusb'})).kind,'webusb');assert.equal(usbPicks,1);assert.equal(serialPicks,0);
});

test('viewer opens the platform-default picker and still allows explicit overrides',async()=>{
 for(const mobile of [false,true]){
  const picks=[];
  const ctx=vm.createContext({localStorage:{getItem:()=>null},navigator:{userAgentData:{mobile},
   serial:{getPorts:async()=>[],requestPort:async()=>{picks.push('webserial');return {}; }},
   usb:{getDevices:async()=>[],requestDevice:async()=>{picks.push('webusb');return {vendorId:0x303a};}}
  }});
  vm.runInContext(connectionSource,ctx);
  vm.runInContext(source.slice(source.indexOf('const PORT_KEY='),source.indexOf("$('connect').title=")),ctx);
  const choose=vm.runInContext('choosePort',ctx);
  await choose({});assert.equal(picks.at(-1),mobile?'webusb':'webserial');
  await choose({choosePort:true,kind:mobile?'webserial':'webusb'});
  assert.equal(picks.at(-1),mobile?'webserial':'webusb');
 }
});
