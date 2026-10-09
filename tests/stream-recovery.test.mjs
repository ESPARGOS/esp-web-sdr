import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {setImmediate as nextTurn} from 'node:timers/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
function radioFixture(){
 const c=vm.createContext({performance});vm.runInContext(source,c);
 const radio=vm.runInContext('radio',c);
 radio.port={};radio.family='C61';radio.hasExtendedTune=true;radio.tuneRange=[100,6000];
 radio.bandwidthRange=null;radio.frequency=2412;
 const commands=[];let reject=false;
 radio.command=async s=>commands.push(s);
 radio.line=async()=>{if(reject){reject=false;throw Error('ERR command');}return 'OK';};
 return {radio,commands,rejectNext:()=>{reject=true;}};
}
test('a rejected retune invalidates the cache and the command queue accepts a correction',async()=>{
 const {radio,commands,rejectNext}=radioFixture();rejectNext();
 await assert.rejects(radio.run(()=>radio.tune(2612)),/ERR command/);
 assert.equal(radio.frequency,null);assert.equal(radio.failed,null);
 await radio.run(()=>radio.tune(2412));
 assert.deepEqual(commands,['FREQ 2612','FREQ 2412']);assert.equal(radio.frequency,2412);
 await assert.rejects(radio.run(()=>radio.tune(6001)),/whole-MHz/);
 await radio.run(()=>radio.tune(2612));assert.equal(radio.frequency,2612);
});
for(const failure of ['validation','device rejection','disconnect'])test(`${failure}: streaming has a recoverable pause or clean disconnect`,async()=>{
 const {radio,commands,rejectNext}=radioFixture();
 if(failure==='device rejection')rejectNext();
 const elements=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{setAttribute(){},prepend(el){el.parentElement=this;},value:'HARDWARE',options:[],classList:{toggle(){}},querySelector:()=>({})});return elements.get(id);};
 const controls=[{}],presets=[{dataset:{freq:'2412'}},{dataset:{freq:'5500'}}];
 const document={querySelectorAll:s=>s==='[data-freq]'?presets:controls};
 let frames=0,closed=0;
 radio.close=async()=>{closed++;};
 const errors=[];
 const ctx=vm.createContext({navigator:{},radio,$,document,gainMode:'HARDWARE',analogBandwidth:20,savedPort:()=>null,spectrumMode:false,connected:true,connectionBusy:false,paused:false,running:false,previous:0,
  clear:()=>{},tuneFrequency:failure==='validation'?6001:2612,setTimeout,
  config:()=>({frequency:ctx.tuneFrequency}),selectRxFrame:()=>true,
  render:()=>{frames++;ctx.paused=true;},error:(e,communication)=>errors.push({e,communication}),
  api:async(_path,c)=>{
   if(failure==='disconnect'){radio.failed=Error('USB disconnected');throw radio.failed;}
   await radio.run(()=>radio.tune(c.frequency));return {json:async()=>({frequency:c.frequency})};
  }});
 vm.runInContext(app.slice(app.indexOf('async function loop(){'),app.indexOf('function bandwidthChanged')),ctx);
 vm.runInContext(app.split('\n').find(s=>s.startsWith("$('pause').onclick=")),ctx);
 await vm.runInContext('loop()',ctx);
 assert.equal(ctx.running,false);assert.equal(ctx.paused,true);assert.equal(frames,0);
 if(failure==='disconnect'){
  assert.equal(ctx.connected,false);assert.equal(closed,1);assert.equal($('pause').disabled,true);
  assert.equal(controls[0].disabled,true);return;
 }
 assert.equal(ctx.connected,true);assert.equal(closed,0);assert.equal(controls[0].disabled,false);
 assert.equal($('pause').disabled,false);assert.equal($('pause').textContent,'Resume');
 assert.match(errors.at(-1).e,/Change the settings and select Resume/);
 assert.equal(errors.at(-1).communication,false);
 ctx.tuneFrequency=2412;$('pause').onclick();await nextTurn();
 assert.equal(frames,1);assert.equal(ctx.connected,true);assert.equal(ctx.running,false);
 if(failure==='device rejection')assert.deepEqual(commands,['FREQ 2612','FREQ 2412']);
 // Resume must also restart a worker that has already exited after a normal pause.
 $('pause').onclick();await nextTurn();assert.equal(frames,2);
});
