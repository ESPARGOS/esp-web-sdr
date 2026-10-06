import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
function radioFixture(){
 const context=vm.createContext({performance,setTimeout});vm.runInContext(source,context);
 const radio=vm.runInContext('radio',context),commands=[];let responses=[];
 radio.command=async s=>commands.push(s);radio.line=async()=>responses.shift();
 return {radio,commands,respond:(...r)=>{responses=r;}};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('GPIO discovery is capability-gated and reads retained states without writes',async()=>{
 const {radio:r,commands,respond}=radioFixture();
 await r.negotiateGpio('CAPS');assert.equal(r.hasGpio,false);assert.equal(commands.length,0);
 respond('GPIO 0:Z 3:0 14:1 61:Z');await r.negotiateGpio('CAPS GPIO');
 assert.deepEqual(commands,['GPIO?']);assert.equal(r.hasGpio,true);
 assert.equal(JSON.stringify(r.gpioPins),'[{"pin":0,"state":"Z"},{"pin":3,"state":"0"},{"pin":14,"state":"1"},{"pin":61,"state":"Z"}]');
 await r.negotiateGpio('CAPS');assert.equal(r.gpioPins.length,0);
 respond('GPIO');await r.negotiateGpio('CAPS GPIO');assert.equal(r.gpioPins.length,0);
});
test('GPIO discovery rejects malformed, duplicate, unsorted and out-of-range pins',async()=>{
 for(const response of ['OK','GPIO 64:Z','GPIO 1:2','GPIO 0:Z 0:1','GPIO 3:Z 1:Z','GPIO -1:Z','GPIO 01:Z','GPIO 1:Z junk']){
  const {radio,respond}=radioFixture();respond(response);
  await assert.rejects(radio.negotiateGpio('CAPS GPIO'),/Invalid GPIO/);
 }
});
test('GPIO writes use the serial queue and update state only after a matching acknowledgement',async()=>{
 const {radio:r,commands,respond}=radioFixture();respond('GPIO 3:Z');await r.negotiateGpio('CAPS GPIO');
 const capture=deferred(),entered=deferred();r.run(async()=>{entered.resolve();await capture.promise;});await entered.promise;
 respond('OK GPIO 3 1');const write=r.setGpio(3,'1');await Promise.resolve();
 assert.deepEqual(commands,['GPIO?']);assert.equal(r.gpioPins[0].state,'Z');
 capture.resolve();await write;assert.equal(r.gpioPins[0].state,'1');
 for(const response of ['ERR gpio_args','OK GPIO 3 1','OK GPIO 4 0','OK']){
  respond(response);await assert.rejects(r.setGpio(3,'0'));assert.equal(r.gpioPins[0].state,'1');
 }
 respond('OK GPIO 3 Z');await r.setGpio(3,'Z');assert.equal(r.gpioPins[0].state,'Z');
 const n=commands.length;await assert.rejects(r.setGpio(12,'1'));await assert.rejects(r.setGpio(3,'X'));assert.equal(commands.length,n);
});
function element(){return {dataset:{},children:[],hidden:false,attributes:{},append(...els){this.children.push(...els);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attributes[k]=v;},querySelectorAll(){return this.children.flatMap(row=>row.children[1].children);}};}
function uiFixture(){
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};
 const events=[],radio={hasGpio:true,gpioPins:[{pin:3,state:'Z'},{pin:14,state:'1'}],setGpio:async(pin,value)=>{events.push('write');radio.gpioPins.find(p=>p.pin===pin).state=value;}};
 const c=vm.createContext({$:get,radio,document:{createElement:element},connected:true,paused:false,connectionBusy:false,loopDone:Promise.resolve(),
  clear:()=>events.push('clear'),error:e=>{if(e)events.push('error');},loop:()=>events.push('resume')});
 vm.runInContext(app.slice(app.indexOf('function updateGpioControls(){'),app.indexOf('function bandwidthChanged()')),c);
 c.state=()=>c.updateGpioControls();c.state();return {c,get,events,radio};
}
test('GPIO rows render compact mutually exclusive buttons, retaining state on reconnect',()=>{
 const {c,get,radio}=uiFixture();const buttons=get('gpioPins').querySelectorAll();
 assert.equal(get('gpioControls').hidden,false);assert.deepEqual(buttons.slice(0,3).map(b=>b.textContent),['Z','0','1']);
 assert.deepEqual(buttons.map(b=>b.attributes['aria-pressed']),['true','false','false','false','false','true']);
 radio.changingGpio=true;c.state();assert(buttons.every(b=>b.disabled));
 c.connected=false;c.state();assert.equal(get('gpioControls').hidden,true);
 c.connected=true;radio.changingGpio=false;radio.gpioPins=[{pin:3,state:'0'}];c.state();
 assert.deepEqual(get('gpioPins').querySelectorAll().map(b=>b.attributes['aria-pressed']),['false','true','false']);
 radio.hasGpio=false;c.state();assert.equal(get('gpioControls').hidden,true);
});
test('GPIO UI waits for capture to drain, preserves selection until acknowledged and resumes',async()=>{
 const {c,get,events,radio}=uiFixture(),capture=deferred(),ack=deferred(),entered=deferred();c.loopDone=capture.promise;
 radio.setGpio=async(pin,value)=>{events.push('write');entered.resolve();await ack.promise;radio.gpioPins[0].state=value;};
 const buttons=get('gpioPins').querySelectorAll(),write=buttons[2].onclick();
 assert.equal(c.paused,true);assert(buttons.every(b=>b.disabled));assert.deepEqual(events,[]);
 capture.resolve();await entered.promise;assert.deepEqual(events,['write']);
 assert.equal(buttons[0].attributes['aria-pressed'],'true');
 ack.resolve();await write;assert.equal(buttons[2].attributes['aria-pressed'],'true');
 assert.equal(c.paused,false);assert.deepEqual(events,['write','clear','resume']);
});
test('GPIO failures keep the acknowledged selection and preserve paused state',async()=>{
 const {c,get,events,radio}=uiFixture();c.paused=true;radio.setGpio=async()=>{throw Error('ERR gpio_io');};
 await get('gpioPins').querySelectorAll()[2].onclick();
 assert.equal(c.paused,true);assert.equal(radio.gpioPins[0].state,'Z');assert.equal(radio.changingGpio,false);
 assert.deepEqual(events,['error']);
});

test('GPIO failure while receiving leaves reception paused so the error remains visible',async()=>{
 const {c,get,events,radio}=uiFixture();radio.setGpio=async()=>{throw Error('ERR gpio_io');};
 await get('gpioPins').querySelectorAll()[2].onclick();
 assert.equal(c.paused,true);assert.deepEqual(events,['error']);
});
