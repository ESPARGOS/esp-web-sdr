import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const families=['ESP32','C3','C5','C6','C61','S2','S3','S31'];
function fixture(family){
 const elements=new Map();
 const values={gainMode:'HARDWARE',gain:'40',frequency:'2412',rate:'80000000',bits:'8',fft:'2048',bandwidth:'20',specDetector:'mean'};
 const options={rate:[4000000,8000000,10000000,16000000,20000000,40000000,80000000],bits:[8,10],fft:[256,512,1024,2048,4096]};
 const get=id=>{
  if(!elements.has(id))elements.set(id,{value:values[id]||'',checked:false,options:(options[id]||[]).map(v=>({value:String(v)})),
   setAttribute(k,v){this[k]=v;},prepend(el){el.parentElement=this;},querySelector:()=>({}),classList:{toggle(){}},checkValidity:()=>true});
  return elements.get(id);
 };
 const rates=['C3','C6'].includes(family)?[80000000]:['ESP32','S2','S3'].includes(family)?[80000000,40000000,16000000]:[80000000,40000000,20000000,10000000,8000000,4000000];
 const profiles=rates.flatMap((r)=> (family==='S3'?(r===80000000?[256]:[256,1024,2048]):family==='C61'?[256,512,1024]:[256,512,1024,2048]).map(n=>[r,0,n,1,1]));
 const radio={family,rxRates:rates,gainMin:0,gainMax:76,gainStep:1,hasGain:true,hasHardwareAgc:true,bandwidthRange:[13,54,1,0],sampleBits:[8,10],
  frequencyInput:()=>({min:100,max:6000,step:1}),frequencyWarning:()=>'',validFrequency:()=>true,
  canStreamSpectrum:true,spectrumProfiles:r=>profiles.filter(p=>p[0]===r),spectrumContinuous:()=>false,specCapabilities:{profiles}};
 const context=vm.createContext({radio,document:{getElementById:get,querySelectorAll:()=>[]},
  spectrumMode:false,connected:true,paused:false,tuneFrequency:2412,analogBandwidth:20,labels(){},clear(){},serialWarning(){}});
 vm.runInContext(app.slice(0,app.indexOf('let connected=')),context);
 vm.runInContext(app.slice(app.indexOf('function state(){'),app.indexOf('function bandwidthChanged()')),context);
 vm.runInContext(app.split('\n').find(l=>l.startsWith('function config()')),context);
 vm.runInContext(app.slice(app.indexOf('function specSizes('),app.indexOf('async function specLoop()')),context);
 for(const start of ["$('iqMode').onclick=","$('specMode').onclick=","for(const id of ['rate','bits','fft'])"])
  vm.runInContext(app.split('\n').find(l=>l.startsWith(start)),context);
 vm.runInContext('applyRadioProfile()',context);
 return {context,get,radio,config:()=>vm.runInContext('specConfig()',context)};
}
for(const family of families)test(`${family}: spectrum toggles and rate changes preserve receiver settings`,()=>{
 const f=fixture(family),{context:c,get,radio}=f;
 assert.equal(c.analogBandwidth,20);assert.equal(get('bandwidth').value,20);assert.equal(get('bandwidthOpen').checked,false);
 c.tuneFrequency=2442;
 for(const gainMode of ['HARDWARE','MANUAL'])for(const bandwidth of [17,0]){
  get('gainMode').value=gainMode;get('gain').value='37';
  c.analogBandwidth=bandwidth;get('bandwidth').value='17';get('bandwidthOpen').checked=bandwidth===0;
  for(const enabled of [true,false]){
   get(enabled?'specMode':'iqMode').onclick();
   assert.equal(get('iqControls').hidden,enabled);assert.equal(get('specOptions').hidden,!enabled);
   assert.equal(get('specMode')['aria-pressed'],String(enabled));
   assert.equal(get('fftControl').parentElement,get(enabled?'specOptions':'iqControls'));
   for(const rate of radio.rxRates){
    get('rate').value=String(rate);get('rate').onchange();
    const config=f.config();
    assert.equal(c.analogBandwidth,bandwidth);assert.equal(get('bandwidthOpen').checked,bandwidth===0);assert.equal(get('bandwidth').value,'17');
    assert.equal(config.bandwidth,bandwidth);assert.equal(config.frequency,2442);assert.equal(config.rate,rate);
    assert.equal(config.gainMode,gainMode);assert.equal(config.gain,37);assert.equal(get('gainMode').value,gainMode);assert.equal(get('bits').value,'8');
   }
  }
 }
});
