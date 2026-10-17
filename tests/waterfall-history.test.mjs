import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
function fixture(){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:({average:'0.5',floor:'-100',range:'100'})[id]||'20',checkValidity:()=>true});return elements.get(id);};
 const c=vm.createContext({$:get,performance,trace:[-1],maximum:[-1],latest:null,key:'old',previous:0,
  waterHist:[Float32Array.of(-80,-70)],view:{a:.1,b:.9},water:{width:2,height:20},waterMap:null,lut32:Uint32Array.from({length:256},(_,i)=>i),
  wc:{fillRect(){},drawImage(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(img){c.pixels=new Uint32Array(img.data.buffer);}},
  draw(){},labels(){},autoScale(){},state(){},radio:{gainMax:76},gainMode:'HARDWARE',analogBandwidth:20});
 vm.runInContext(app.slice(app.indexOf('function wmap('),app.indexOf('for(const el of [spec,water')),c);
 vm.runInContext(app.slice(app.indexOf('function resetSpectrum('),app.indexOf('function resize(')),c);
 vm.runInContext(app.slice(app.indexOf('function render(f)'),app.indexOf('async function loop(')),c);
 vm.runInContext(app.split('\n').find(l=>l.startsWith('function bandwidthChanged()')),c);
 for(const prefix of ["$('gainAgc').onclick=","$('gainManual').onclick=","$('gain').oninput="])
  vm.runInContext(app.split('\n').find(l=>l.startsWith(prefix)),c);
 return {c,get};
}
test('bandwidth and gain changes preserve waterfall history and zoom; explicit clear empties it',()=>{
 const {c,get}=fixture(),history=c.waterHist,view=c.view;
 for(const change of [()=>c.bandwidthChanged(),()=>get('gainManual').onclick(),()=>get('gainAgc').onclick(),()=>get('gain').oninput()]){
  c.trace=[-1];c.maximum=[-1];change();assert.equal(c.waterHist,history);assert.equal(c.view,view);assert.equal(c.trace,null);assert.equal(c.maximum,null);
 }
 c.clear();assert.equal(c.waterHist.length,0);assert.equal(c.view.a,0);assert.equal(c.view.b,1);
});
test('received configuration changes append rows without erasing history or mixing spectrum averages',()=>{
 const {c}=fixture(),original=c.waterHist[0];
 const frame={frequency:2412,rate:80000000,bits:10,fft:2,bandwidth:20,gainMode:'HARDWARE',gain:40,spectrum:[-30,-40],delivered_ksps:1,elapsed_ms:1,peak_hz:2412000000,sequence:1};
 const changes=[{}, {bandwidth:17},{frequency:2442},{rate:40000000},{bits:8},{gainMode:'MANUAL'},{gain:37}];
 for(const [i,patch] of changes.entries()){
  Object.assign(frame,patch);c.render(frame);assert.equal(c.waterHist.length,i+2);assert.equal(c.waterHist.at(-1),original);assert.equal(c.trace.length,frame.fft);assert.equal(c.trace[0],-30);
 }
});
test('FFT size changes can clear history instead of retaining mixed-size rows',()=>{
 const {c}=fixture();c.resetSpectrum(4);
 assert.equal(c.waterHist.length,0);assert.equal(c.trace,null);assert.equal(c.maximum,null);
});
