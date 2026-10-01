import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
const families=['ESP32','C3','C5','C6','C61','S2','S3','S31'];
function fixture(){
 const commands=[],responses=[];
 const port={open:async()=>{},close:async()=>{},getInfo:()=>({}),
  readable:{getReader:()=>({cancel:async()=>{},releaseLock:()=>{}})},
  writable:{getWriter:()=>({releaseLock:()=>{}})}};
 const c=vm.createContext({performance,isSecureContext:true,navigator:{serial:{requestPort:async()=>port}}});
 vm.runInContext(source,c);const r=vm.runInContext('radio',c);
 r.pump=async()=>{};r.synchronize=async()=>{};
 r.command=async s=>commands.push(s);r.line=async()=>responses.length?responses.shift():'OK';
 function handshake(family,range='100 6000 1'){
  responses.push(`${family}SDR 6 burst 16380`,`CAPS RXLIMITS${range?' TUNEEXT':''}`);
  if(range)responses.push(`RANGE ${range}`);
  responses.push('LIMITS {"gain":[0,72,1],"bandwidth":null,"rates":[80000000],"bits":[8,10]}');
 }
 return {r,commands,responses,handshake};
}
for(const family of families)test(`${family}: negotiate and transmit every whole MHz from 100 through 6000`,async()=>{
 const {r,commands,handshake}=fixture();handshake(family);await r.connect();
 assert.deepEqual(commands,['INFO','CAPS','RANGE?','LIMITS?']);
 assert.deepEqual({...r.frequencyInput()},{min:100,max:6000,step:1});
 for(let f=100;f<=6000;f++){
  assert.equal(r.validFrequency(f),true);await r.tune(f);
  assert.equal(commands.at(-1),`FREQ ${f}`);assert.equal(r.nearestFrequency(f),f);
 }
 await r.tune(2612);assert.equal(commands.at(-1),'FREQ 2612');
 for(const f of [99,6001,-1,2612.5,NaN,Infinity]){
  assert.equal(r.validFrequency(f),false);await assert.rejects(r.tune(f),/whole-MHz/);
 }
 assert.equal(r.nearestFrequency(2611.6),2612);
 assert.equal(r.nearestFrequency(0),100);assert.equal(r.nearestFrequency(7000),6000);
 for(const f of [2400,2401,2483])assert.equal(r.frequencyWarning(f),'');
 for(const f of [100,2399,2484,2612,6000])assert.match(r.frequencyWarning(f),/Outside.*ISM/);
 for(const f of [5150,5180,5500,5724,5725,5800,5875,5876,5885,5895])assert.equal(!!r.frequencyWarning(f),family!=='C5');
 for(const f of [5149,5896])assert.match(r.frequencyWarning(f),/Outside.*ISM/);
 assert.match(r.frequencyWarning(2612),/PLL may not lock.*spectrum may not match the selected center frequency/);
 await r.close();assert.equal(r.hasExtendedTune,false);assert.equal(r.tuneRange,null);
});
test('reconnect respects older advertised limits and clears stale capabilities',async()=>{
 const {r,commands,handshake}=fixture();handshake('C61');await r.connect();await r.tune(2612);
 handshake('C61','2100 2800 1');await r.connect();
 assert.equal(r.validFrequency(2612),true);assert.equal(r.validFrequency(5000),false);
 assert.deepEqual({...r.frequencyInput()},{min:2100,max:2800,step:1});
 handshake('ESP32',null);await r.connect();
 assert.equal(r.hasExtendedTune,false);assert.equal(r.tuneRange,null);
 assert.equal(r.validFrequency(2612),false);assert.equal(r.validFrequency(2413),false);
 assert.equal(r.nearestFrequency(2413),2412);
 assert.deepEqual(commands.slice(-3),['INFO','CAPS','LIMITS?']);
});
test('malformed advertised ranges fail negotiation and clear tuning state',async()=>{
 for(const range of ['99 6000 1','100 6001 1','6000 100 1','100 6000 5','100.5 6000 1']){
  const {r,handshake}=fixture();handshake('C61',range);
  await assert.rejects(r.connect(),/Invalid tuning range/);
  assert.equal(r.hasExtendedTune,false);assert.equal(r.tuneRange,null);
 }
});
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
test('actual UI profile and spectrum click handlers retain 2612 MHz on every chip',async()=>{
 for(const family of families){
  const {r,handshake}=fixture();handshake(family);await r.connect();
  const elements=new Map();
  const document={getElementById(id){
   if(!elements.has(id))elements.set(id,{value:id==='gainMode'?'HARDWARE':id==='bits'?'8':'0',
    options:[],querySelector:()=>({})});
   return elements.get(id);
  }};
  const spec={clientWidth:100,getBoundingClientRect:()=>({left:0,width:100})};
  const c=vm.createContext({radio:r,document,spec,view:{a:0,b:1},suppressClick:false,tuneClick:null,setTimeout:fn=>fn(),clearTimeout(){},connected:true,latest:{frequency:2600,rate:40000000},
   tuneFrequency:2612,analogBandwidth:0,state:()=>{},labels:()=>{}});
  vm.runInContext(app.slice(0,app.indexOf('let connected=')),c);
  vm.runInContext('applyRadioProfile()',c);
  assert.deepEqual([elements.get('frequency').min,elements.get('frequency').max,elements.get('frequency').step],[100,6000,1]);
  assert.equal(c.tuneFrequency,2612);
  vm.runInContext(app.split('\n').find(line=>line.startsWith('function viewFrac(')),c);
  vm.runInContext(app.split('\n').find(line=>line.startsWith('function queueTune(')),c);
  vm.runInContext(app.split('\n').find(line=>line.startsWith('spec.onclick=')),c);
  spec.onclick({clientX:80});
  assert.equal(c.tuneFrequency,2612);assert.equal(elements.get('frequency').value,2612);
 }
});
