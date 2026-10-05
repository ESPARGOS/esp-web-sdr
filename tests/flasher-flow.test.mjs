import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as catalog from '../flasher/catalog.mjs';
const source=(await readFile(new URL('../flasher/app.js',import.meta.url),'utf8'))
 .replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify('https://example.test/flasher/app.js'))
 .replace(/initialize\(\);\s*$/,'globalThis.ready=initialize();');
async function fixture({chip='ESP32-S31',search='',vendor=0x10c4,fallback=false,flash='16MB',crystal=40}={}){
 const variants={
  esp32c2:{chip:'ESP32-C2',target:'esp32c2',label:'C2',flash_size:'2MB',flash_size_policy:'minimum',xtal_mhz:26},
  esp32c61:{chip:'ESP32-C61',target:'esp32c61',label:'C61',flash_size:'2MB',flash_size_policy:'minimum'},
  esp32s31:{chip:'ESP32-S31',target:'esp32s31',label:'S31 viewer',flash_size:'2MB',flash_size_policy:'minimum'},
  'esp32s31-stream':{chip:'ESP32-S31',target:'esp32s31',label:'S31 Soapy',application:'soapysdr',flash_size:'16MB'},
  future:{chip:'ESP32-H4',target:'esp32h4',label:'Future',flash_size:'2MB'}
 };
 const nodes=new Map(),events=[];let portRequests=0;
 const element=()=>({value:'',textContent:'',dataset:{},options:[],append(option){this.options.push(option);},after(){}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 $('revision').options.push({value:'',textContent:'Choose firmware'});
 class Transport{constructor(){this.baudrate=115200;}async disconnect(){events.push('disconnect');}}
 class ESPLoader{
  constructor(options){Object.assign(this,options);events.push(['loader',this.baudrate]);}
  async detectChip(){this.chip={CHIP_NAME:chip,getCrystalFreq:async()=>crystal,readMac:async()=> '00:00:00:00:00:00'};}
  async main(){await this.detectChip();}
  async detectFlashSize(){return flash;}
  async changeBaud(){events.push(['baud',this.baudrate]);if(!fallback)this.transport.baudrate=this.baudrate;}
  async writeFlash(){events.push('write');}
 }
 const context=vm.createContext({...catalog,ESPLoader,Transport,URL,URLSearchParams,isSecureContext:true,
  document:{getElementById:$,createElement:element},window:{addEventListener(){}},location:{search},
  navigator:{serial:{requestPort:async()=>{portRequests++;return {getInfo:()=>({usbVendorId:vendor})};}}},
  fetch:async()=>({ok:true,json:async()=>['ESP32-C2','ESP32-C61','ESP32-S31']}),
  loadManifest:async()=>({variants}),checkedImages:async()=>{events.push('download');return [{data:new Uint8Array(1)}];},
  finishSession:async(_l,_t,disconnect)=>{await disconnect();return true;}
 });
 for(const v of Object.values(variants))v.parts=[];
 vm.runInContext(source,context);await context.ready;
 return {$,events,variants,portRequests:()=>portRequests,connect:()=>$('connect').onclick(),install:()=>$('install').onclick()};
}
test('connect first suggests both S31 applications and keeps all profiles selectable',async()=>{
 const f=await fixture();assert.equal(f.$('connect').disabled,false);assert.equal(f.$('revision').disabled,true);
 await f.connect();assert.equal(f.$('revision').value,'esp32s31');assert.equal(f.$('revision').disabled,false);
 assert.deepEqual(f.events,[['loader',115200]]);
 const suggested=f.$('revision').options.filter(o=>o.dataset?.suggested==='true');
 assert.deepEqual(suggested.map(o=>o.value),['esp32s31','esp32s31-stream']);
 assert.equal(f.$('revision').dataset.suggested,'true');
 assert.equal(f.$('revision').options.length,6);
 assert.ok(f.$('revision').options.every(o=>!o.disabled));
 f.$('revision').value='esp32s31-stream';f.$('revision').onchange();await f.install();
 assert.ok(f.events.includes('write'));assert.ok(!f.events.some(e=>Array.isArray(e)&&e[0]==='baud'));
});
test('matching profile links survive detection; other-chip links select the detected chip',async()=>{
 for(const [search,expected] of [['?board=esp32s31-stream','esp32s31-stream'],['?board=esp32c61','esp32s31']]){
  const f=await fixture({search});await f.connect();assert.equal(f.$('revision').value,expected);
 }
});
test('switching from Soapy to viewer negotiates UART speed only at installation',async()=>{
 const f=await fixture({search:'?board=esp32s31-stream'});await f.connect();
 f.$('revision').value='esp32s31';f.$('revision').onchange();await f.install();
 assert.deepEqual(f.events,[['loader',115200],['baud',2000000],'download','write','disconnect']);
});
test('native USB stays at ROM baud and UART fallback prevents any write',async()=>{
 const usb=await fixture({vendor:0x303a});await usb.connect();await usb.install();
 assert.ok(usb.events.includes('write'));assert.ok(!usb.events.some(e=>Array.isArray(e)&&e[0]==='baud'));
 const uart=await fixture({fallback:true});await uart.connect();await uart.install();
 assert.ok(!uart.events.includes('download'));assert.ok(!uart.events.includes('write'));
 assert.match(uart.$('status').textContent,/UART too slow/);
});
test('incompatible selections fail before flashing and leave the connection usable',async()=>{
 const f=await fixture({flash:'4MB'});await f.connect();
 for(const profile of ['esp32c61','esp32s31-stream','future']){
  f.$('revision').value=profile;f.$('revision').onchange();
  assert.equal(f.$('revision').dataset.suggested,'false');await f.install();
  assert.equal(f.$('status').dataset.error,'true');assert.ok(!f.events.includes('disconnect'));assert.ok(!f.events.includes('write'));
 }
 f.$('revision').value='esp32s31';f.$('revision').onchange();await f.install();assert.ok(f.events.includes('write'));
});
test('a chip without a matching crystal profile can connect and browse the whole catalog',async()=>{
 const f=await fixture({chip:'ESP32-C2',crystal:40});await f.connect();
 assert.equal(f.$('revision').value,'');assert.equal(f.$('revision').disabled,false);
 assert.ok(f.$('revision').options.every(o=>o.dataset?.suggested!=='true'));
 f.$('revision').value='esp32c2';f.$('revision').onchange();await f.install();
 assert.match(f.$('status').textContent,/26 MHz crystal/);assert.ok(!f.events.includes('disconnect'));
});

test('Install can reconnect and flash repeatedly without reopening the port picker',async()=>{
 const f=await fixture();await f.connect();await f.install();
 assert.equal(f.$('install').disabled,false);assert.equal(f.$('revision').disabled,false);
 await f.install();
 f.$('revision').value='esp32s31-stream';f.$('revision').onchange();await f.install();
 assert.equal(f.events.filter(e=>e==='write').length,3);
 assert.equal(f.events.filter(e=>e==='disconnect').length,3);
 assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='loader').length,3);
 assert.equal(f.portRequests(),1);assert.equal(f.$('revision').value,'esp32s31-stream');
 assert.equal(f.$('install').disabled,false);
});
test('repeat installation never silently replaces an incompatible selected profile',async()=>{
 const f=await fixture();await f.connect();await f.install();
 f.$('revision').value='esp32c61';f.$('revision').onchange();await f.install();
 assert.equal(f.$('revision').value,'esp32c61');assert.match(f.$('status').textContent,/connected chip is ESP32-S31/);
 assert.equal(f.events.filter(e=>e==='write').length,1);
 await f.$('disconnect').onclick();assert.equal(f.$('install').disabled,true);
});
