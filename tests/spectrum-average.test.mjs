import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const radioSource=await readFile(new URL('../radio.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../app.js',import.meta.url),'utf8');
function fixture(){const ctx=vm.createContext({performance});vm.runInContext(radioSource,ctx);return ctx;}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-4,`${actual} != ${expected}`);
test('spectrum mean weights every FFT, including across waterfall rows',()=>{
 const c=fixture(),make=vm.runInContext('(n,max)=>new SpectrumAccumulator(n,max)',c);
 const a=make(2,false);a.add([-20,-30],1);a.add([-40,-10],9);
 const row=a.finish();assert.equal(row.weight,10);
 close(row.bins[0],10*Math.log10((.01+9*.0001)/10));
 close(row.bins[1],10*Math.log10((.001+9*.1)/10));
 assert.deepEqual(Array.from(row.peak),[-20,-10]);assert.equal(a.finish(),null);
 a.add([-50,-50],30);const row2=a.finish(),batch=make(2,false);
 batch.add(row.bins,row.weight);batch.add(row2.bins,row2.weight);
 close(batch.finish().bins[0],10*Math.log10((.01+9*.0001+30*.00001)/40));
});
test('maximum detector ignores weights and reusable accumulators do not retain old peaks',()=>{
 const c=fixture(),a=vm.runInContext('new SpectrumAccumulator(2,true)',c);
 a.add([-10,-40],1);a.add([-50,-20],100);a.add([0,0],0);
 const first=a.finish();assert.deepEqual(Array.from(first.bins),[-10,-20]);
 a.add([-80,-90],1);assert.deepEqual(Array.from(a.finish().bins),[-80,-90]);
 assert.deepEqual(Array.from(first.bins),[-10,-20]);
});
test('reused IQ FFT buffers retain normalization, average all blocks and reset between captures',()=>{
 const c=fixture(),spec=vm.runInContext('spectrum',c);
 for(const n of [256,512,256]){
  const iq=new Float32Array(4*n);
  for(let j=0;j<2*n;j++){const a=j<n?.25:.5;iq[2*j]=a*Math.cos(2*Math.PI*17*j/n);iq[2*j+1]=a*Math.sin(2*Math.PI*17*j/n);}
  const p=spec(iq,n);close(p[n/2+17],10*Math.log10((.25**2+.5**2)/2));
  assert.equal(p.indexOf(Math.max(...p)),n/2+17);
  assert.ok(spec(new Float32Array(4*n),n).every(v=>v===-140));
 }
});
function loopFixture(frames,{rowMs=20,change=false}={}){
 const c=fixture();let dc='raw';
 Object.assign(c,{SpectrumAccumulator:vm.runInContext('SpectrumAccumulator',c),
  specPending:[],specLast:null,specCount:[],specCov:null,specRAF:0,specInfo:null,
  connected:true,paused:false,spectrumMode:true,
  $:id=>({value:id==='specRow'?String(rowMs):dc}),requestAnimationFrame:()=>1,specFrame(){},
  specConfig:()=>({fft:256,rate:1000,frequency:2412,gainMode:'HARDWARE',gain:0,bandwidth:0,maxHold:false}),
  specToDbfs:bins=>bins,
 });
 const radio=vm.runInContext('radio',c);radio.spectrumContinuous=()=>true;
 radio.spec=async(_,onFrame)=>{
  for(const [i,f] of frames.entries()){
   if(change&&i===1)dc='fill';
   onFrame({t:f.t,pairs:f.pairs,ffts:f.ffts},new Float32Array(256).fill(f.db),{});
  }
  c.paused=true;return {};
 };
 vm.runInContext(appSource.split('\n').find(line=>line.startsWith('function specDisplayKey(')),c);
 vm.runInContext(appSource.slice(appSource.indexOf('async function specLoop()'),appSource.indexOf('function specFrame()')),c);
 return c;
}
test('waterfall duration includes the last frame span and flushes a partial row on stop',async()=>{
 const c=loopFixture([{t:0,pairs:10,ffts:1,db:-20},{t:.01,pairs:10,ffts:9,db:-40},{t:.02,pairs:5,ffts:2,db:-50}]);
 await vm.runInContext('specLoop()',c);
 assert.equal(c.specPending.length,2);assert.equal(c.specPending[0].weight,10);assert.equal(c.specPending[1].weight,2);
 close(c.specPending[0].bins[0],10*Math.log10((.01+9*.0001)/10));
});
test('changing DC display mode discards the partial row instead of mixing different settings',async()=>{
 const c=loopFixture([{t:0,pairs:5,ffts:1,db:-20},{t:.005,pairs:5,ffts:1,db:-40}],{change:true});
 await vm.runInContext('specLoop()',c);assert.equal(c.specPending.length,0);
});

test('rows queued before a settings change are discarded before drawing',()=>{
 const c=loopFixture([]);
 vm.runInContext(appSource.slice(appSource.indexOf('function renderSpec('),appSource.indexOf("$('iqMode').onclick=",appSource.indexOf('function renderSpec('))),c);
 // No canvas or trace is provided: a stale row must return before touching them.
 c.rows=[{key:'old-frequency',bins:new Float32Array(256),peak:new Float32Array(256),weight:1}];
 vm.runInContext('renderSpec(rows)',c);
});

test('display batching averages all rows by FFT count and preserves peaks beyond waterfall height',()=>{
 const c=loopFixture([]),elements=new Map(),originalGet=c.$;
 c.$=id=>{
  if(!elements.has(id))elements.set(id,{value:({average:'0',floor:'-100',range:'100'})[id]??originalGet(id).value});
  return elements.get(id);
 };
 Object.assign(c,{key:'',trace:null,maximum:null,latest:null,
  clear(){c.trace=null;c.maximum=null;},draw(){},labels(){},autoScale(){},pushWater(){},
  paintRows(rows){c.painted=rows;},water:{height:2,width:4},wc:{drawImage(){}},
 });
 vm.runInContext(appSource.slice(appSource.indexOf('function renderSpec('),appSource.indexOf("$('iqMode').onclick=",appSource.indexOf('function renderSpec('))),c);
 const key=vm.runInContext('specDisplayKey(specConfig())',c);
 c.rows=[[-10,1],[-40,9],[-50,30]].map(([db,weight])=>({key,bins:new Float32Array(256).fill(db),peak:new Float32Array(256).fill(db),weight}));
 vm.runInContext('renderSpec(rows)',c);
 close(c.trace[0],10*Math.log10((.1+9*.0001+30*.00001)/40));
 assert.equal(c.maximum[0],-10);assert.equal(c.painted.length,2);
 assert.equal(c.painted[0][0],-50);assert.equal(c.painted[1][0],-40);
});
