import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const families=['ESP32','C2','H2','C3','C5','C6','C61','S2','S3','S31'];
for(const [label,expected] of [['2.442 GHz',2442],['5.500 GHz',5500]])test(`${label} preset sets the matching receiver frequency`,async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const [,frequency]=Array.from(html.matchAll(/<button data-freq="(\d+)">([^<]+)<\/button>/g)).find(match=>match[2]===label);
 const button={dataset:{freq:frequency}},input={};let updated=0;
 const c=vm.createContext({tuneFrequency:2412,$:()=>input,labels:()=>{updated++;},document:{querySelectorAll:()=>[button]}});
 vm.runInContext(app.split('\n').find(line=>line.startsWith("for(const b of document.querySelectorAll('[data-freq]'))b.onclick=")),c);
 button.onclick();assert.equal(c.tuneFrequency,expected);assert.equal(input.value,String(expected));assert.equal(updated,1);
});

function fixture(family){
 const elements=new Map();
 const values={gain:'40',frequency:'2412',rate:'80000000',bits:'8',fft:'2048',bandwidth:'20',specDetector:'mean',dcMode:'raw',specRow:'10'};
 const options={rate:[4000000,6400000,8000000,10000000,10666667,16000000,20000000,32000000,40000000,80000000],bits:[8,10],fft:[256,512,1024,2048,4096]};
 const get=id=>{
  if(!elements.has(id))elements.set(id,{value:values[id]||'',checked:false,options:(options[id]||[]).map(v=>({value:String(v)})),
   setAttribute(k,v){this[k]=v;},prepend(el){el.parentElement=this;},querySelector:()=>({}),classList:{toggle(){}},checkValidity:()=>true});
  return elements.get(id);
 };
 const rates=family==='H2'?[32000000,16000000,10666667,6400000]:['C2','C3','C6'].includes(family)?[80000000]:['ESP32','S2','S3'].includes(family)?[80000000,40000000,16000000]:[80000000,40000000,20000000,10000000,8000000,4000000];
 const profiles=rates.flatMap((r)=> (family==='C61'?[256,512,1024]:[256,512,1024,2048]).map(n=>[r,0,n,1,1]));
 const radio={family,rxRates:rates,gainMin:0,gainMax:76,gainStep:1,hasGain:true,hasHardwareAgc:true,bandwidthRange:[13,54,1,0],sampleBits:[8,10],
  frequencyInput:()=>({min:100,max:6000,step:1}),frequencyWarning:()=>'',validFrequency:()=>true,
  canStreamSpectrum:true,spectrumProfiles:r=>profiles.filter(p=>p[0]===r),spectrumContinuous:()=>false,specCapabilities:{profiles}};
 const context=vm.createContext({navigator:{},radio,document:{getElementById:get,querySelectorAll:()=>[]},
  savedPort:()=>null,spectrumMode:false,connected:true,paused:false,tuneFrequency:2412,analogBandwidth:20,labels(){},clear(){},serialWarning(){}});
 vm.runInContext(app.slice(0,app.indexOf('let connected=')),context);
 vm.runInContext(app.slice(app.indexOf('function state(){'),app.indexOf('function bandwidthChanged()')),context);
 vm.runInContext(app.slice(app.indexOf('function loOffset('),app.indexOf("$('dcMode').onchange=")),context);
 vm.runInContext(app.split('\n').find(l=>l.startsWith('function config()')),context);
 vm.runInContext(app.slice(app.indexOf('function specSizes('),app.indexOf('async function specLoop()')),context);
 vm.runInContext(app.split('\n').find(line=>line.startsWith('function bandwidthChanged()')),context);
 for(const start of ["$('iqMode').onclick=","$('specMode').onclick=","$('gainAgc').onclick=","$('gainManual').onclick=","$('bandwidthOpen').onclick=","$('bandwidthFilter').onclick=","$('bandwidth').onchange=","for(const id of ['rate','bits','fft'])"])
  vm.runInContext(app.split('\n').find(l=>l.startsWith(start)),context);
 vm.runInContext('applyRadioProfile()',context);
 return {context,get,radio,config:()=>vm.runInContext('specConfig()',context)};
}
for(const family of families)test(`${family}: spectrum toggles and rate changes preserve receiver settings`,()=>{
 const f=fixture(family),{context:c,get,radio}=f;
 assert.equal(c.analogBandwidth,20);assert.equal(get('bandwidth').value,20);assert.equal(get('bandwidthOpen')['aria-pressed'],'false');
 c.tuneFrequency=2442;
 for(const gainMode of ['HARDWARE','MANUAL'])for(const bandwidth of [17,0]){
  get(gainMode==='HARDWARE'?'gainAgc':'gainManual').onclick();get('gain').value='37';
  assert.equal(get('gainAgc')['aria-pressed'],String(gainMode==='HARDWARE'));
  assert.equal(get('gainManual')['aria-pressed'],String(gainMode==='MANUAL'));
  assert.equal(get('gain').disabled,gainMode!=='MANUAL');
  c.analogBandwidth=bandwidth;get('bandwidth').value='17';
  for(const enabled of [true,false]){
   get(enabled?'specMode':'iqMode').onclick();
   assert.equal(get('iqControls').hidden,enabled);assert.equal(get('specOptions').hidden,!enabled);
   assert.equal(get('specMode')['aria-pressed'],String(enabled));
   assert.equal(get('fftControl').parentElement,get(enabled?'specOptions':'iqControls'));
   for(const rate of radio.rxRates){
    get('rate').value=String(rate);get('rate').onchange();
    const config=f.config();
    assert.equal(c.analogBandwidth,bandwidth);assert.equal(get('bandwidthOpen')['aria-pressed'],String(bandwidth===0));assert.equal(get('bandwidth').value,'17');
    assert.equal(config.bandwidth,bandwidth);assert.equal(config.frequency,2442);assert.equal(config.rate,rate);
    assert.equal(config.gainMode,gainMode);assert.equal(config.gain,37);assert.equal(get('bits').value,'8');
   }
  }
 }
});

test('gain buttons respect AGC support, disconnection and baud changes',()=>{
 const {context,get,radio,config}=fixture('C61');
 radio.hasHardwareAgc=false;vm.runInContext('applyRadioProfile()',context);
 assert.equal(config().gainMode,'MANUAL');assert.equal(get('gainAgc').disabled,true);
 assert.equal(get('gainManual').disabled,false);assert.equal(get('gain').disabled,false);
 get('gainAgc').onclick();assert.equal(config().gainMode,'MANUAL');
 for(const update of [()=>{radio.changingBaud=true;},()=>{radio.changingBaud=false;context.connected=false;}]){
  update();vm.runInContext('state()',context);
  assert.equal(get('gainAgc').disabled,true);assert.equal(get('gainManual').disabled,true);assert.equal(get('gain').disabled,true);
 }
});

test('Open bypasses the analog filter and Filter restores the last selected bandwidth',()=>{
 const {context,get,config}=fixture('C61');
 get('bandwidth').value='17';get('bandwidth').onchange();
 assert.equal(config().bandwidth,17);
 get('bandwidthOpen').onclick();
 assert.equal(config().bandwidth,0);assert.equal(get('bandwidth').disabled,true);
 assert.equal(get('bandwidthOpen')['aria-pressed'],'true');assert.equal(get('bandwidthFilter')['aria-pressed'],'false');
 get('bandwidthOpen').onclick();assert.equal(get('bandwidth').value,17);
 get('bandwidthFilter').onclick();
 assert.equal(config().bandwidth,17);assert.equal(get('bandwidth').disabled,false);
 assert.equal(get('bandwidthOpen')['aria-pressed'],'false');assert.equal(get('bandwidthFilter')['aria-pressed'],'true');
 // Invalid edits do not change the active filter or replace the last valid setting.
 let reported=0;get('bandwidth').checkValidity=()=>false;get('bandwidth').reportValidity=()=>{reported++;};
 get('bandwidth').value='99';get('bandwidth').onchange();
 assert.equal(config().bandwidth,17);assert.equal(reported,1);
 get('bandwidthOpen').onclick();assert.equal(get('bandwidth').value,17);
 get('bandwidth').checkValidity=()=>true;get('bandwidthFilter').onclick();
 assert.equal(context.analogBandwidth,17);
});

for(const reason of ['disconnected','baud change','GPIO change','unsupported'])test(`bandwidth buttons are disabled when ${reason}`,()=>{
 const {context,get,radio,config}=fixture('C61');
 if(reason==='disconnected')context.connected=false;
 if(reason==='baud change')radio.changingBaud=true;
 if(reason==='GPIO change')radio.changingGpio=true;
 if(reason==='unsupported')radio.bandwidthRange=null;
 vm.runInContext('state()',context);
 for(const id of ['bandwidthOpen','bandwidthFilter','bandwidth'])assert.equal(get(id).disabled,true);
 get('bandwidthOpen').onclick();get('bandwidthFilter').onclick();assert.equal(config().bandwidth,20);
});

test('firmware with an open-filter default selects Open and uses its advertised range',()=>{
 const {context,get,radio,config}=fixture('H2');
 radio.bandwidthRange=[4,11,1,0];vm.runInContext('applyRadioProfile()',context);
 assert.equal(config().bandwidth,0);assert.equal(get('bandwidthOpen')['aria-pressed'],'true');
 assert.equal(get('bandwidth').min,4);assert.equal(get('bandwidth').max,11);assert.equal(get('bandwidth').disabled,true);
 get('bandwidthFilter').onclick();assert.equal(config().bandwidth,11);
});
