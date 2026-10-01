import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
test('remembered USB identities never silently select between identical boards',async()=>{
 const port=()=>({getInfo:()=>({usbVendorId:0x303a,usbProductId:0x1001})}),a=port(),b=port();let ports=[a],picks=0;
 const ctx=vm.createContext({localStorage:{getItem:()=>JSON.stringify({vid:0x303a,pid:0x1001})},navigator:{serial:{getPorts:async()=>ports,requestPort:async()=>{picks++;return b;}}}});
 vm.runInContext(source.slice(source.indexOf("const PORT_KEY="),source.indexOf("$('connect').title=")),ctx);
 const choose=vm.runInContext('choosePort',ctx);
 assert.equal(await choose({auto:true}),a);assert.equal(picks,0);
 ports=[a,b];assert.equal(await choose({auto:true}),null);assert.equal(picks,0);
 assert.equal(await choose({}),b);assert.equal(picks,1);
 ports=[a];assert.equal(await choose({choosePort:true}),b);assert.equal(picks,2);
 ports=[];assert.equal(await choose({auto:true}),null);assert.equal(picks,2);
});
