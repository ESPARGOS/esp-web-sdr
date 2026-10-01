'use strict';
const $=id=>document.getElementById(id);
function preferredSampleRate(rates=radio.rxRates){return rates.includes(80000000)?80000000:Math.max(...rates);}
function applyRadioProfile(){
 const tuning=radio.frequencyInput();$('frequency').min=tuning.min;$('frequency').max=tuning.max;$('frequency').step=tuning.step;
 $('gain').min=radio.gainMin;$('gain').max=radio.gainMax;$('gain').step=radio.gainStep;$('gain').value=Math.min(Math.max(40,radio.gainMin),radio.gainMax);$('gainValue').textContent=`${$('gain').value} / ${radio.gainMax}`;
 $('gainMode').querySelector('[value=HARDWARE]').disabled=!radio.hasHardwareAgc;
 if(!radio.hasGain||(!radio.hasHardwareAgc&&$('gainMode').value==='HARDWARE'))$('gainMode').value='MANUAL';
 for(const [id,rates] of [['rate',radio.rxRates]]){
  for(const o of $(id).options)o.disabled=!rates.includes(Number(o.value));
  $(id).value=String(preferredSampleRate(rates));
 }
 const bandwidth=radio.bandwidthRange;
 analogBandwidth=bandwidth?(bandwidth[0]<=20&&bandwidth[1]>=20&&(20-bandwidth[0])%bandwidth[2]===0?20:bandwidth[3]):0;
 $('bandwidthControl').hidden=!bandwidth;
 if(bandwidth){$('bandwidth').min=bandwidth[0];$('bandwidth').max=bandwidth[1];$('bandwidth').step=bandwidth[2];$('bandwidth').value=analogBandwidth||bandwidth[1];$('bandwidthOpen').checked=analogBandwidth===0;}
 for(const option of $('bits').options)option.disabled=!radio.sampleBits.includes(Number(option.value));
 if(!radio.sampleBits.includes(Number($('bits').value)))$('bits').value=String(radio.sampleBits[0]);

 {
  if(!radio.validFrequency(tuneFrequency)){tuneFrequency=2412;$('frequency').value='2412';}
 }
 state();labels();
}
let connected=false,paused=false,latest=null,trace=null,maximum=null,previous=0,key='',running=false,tuneFrequency=2412,analogBandwidth=20;
const spec=$('spectrum'),water=$('waterfall'),sc=spec.getContext('2d'),wc=water.getContext('2d');
const lut=Array.from({length:256},(_,i)=>{const stops=[[3,8,23],[18,31,81],[38,63,153],[30,139,181],[66,213,174],[217,237,103],[255,162,61],[255,244,228]];const p=i/255*(stops.length-1),j=Math.min(stops.length-2,Math.floor(p)),t=p-j;return stops[j].map((v,k)=>Math.round(v*(1-t)+stops[j+1][k]*t));});

// ---- display zoom (wheel), pan (drag), reset (double-click) -------------
// view = visible fraction [a, b] of the received span; the waterfall keeps its
// rows (newest first) so it can be redrawn for any view.
let view={a:0,b:1},waterHist=[],drag=null,suppressClick=false,keepView=false;
var specCov=0; // fraction of the received samples that went through an on-chip FFT
function viewFrac(x,el){const r=el.getBoundingClientRect();return view.a+(x-r.left)/r.width*(view.b-view.a);}
function setView(a,b,free){const nb=(latest&&latest.fft)||2048,minW=Math.max(8/nb,1/1024);let w=Math.max(minW,Math.min(1,b-a));
 if(free){b=a+w;}else if(w>=1){a=0;b=1;}else{a=Math.max(0,Math.min(1-w,a));b=a+w;}view={a,b};redrawWater();draw();labels();}
// released beyond the received span: retune the LO by whole MHz so the view centre is covered
function retuneToView(){const c=latest||config(),span=c.rate/1e6,shift=Math.round(((view.a+view.b)/2-.5)*span);
 if(!connected||!shift){setView(view.a,view.b);return;}const lo0=loFrequency();tuneFrequency=radio.nearestFrequency(tuneFrequency+shift);$('frequency').value=tuneFrequency;
 const d=(loFrequency()-lo0)/span;keepView=true;setView(view.a-d,view.b-d);}
function wmap(W,nb){if(!waterMap||waterMap.W!==W||waterMap.nb!==nb||waterMap.a!==view.a||waterMap.b!==view.b){
 const lo=new Uint16Array(W),hi=new Uint16Array(W),span=view.b-view.a;
 for(let x=0;x<W;x++){const f0=view.a+x/W*span,f1=view.a+(x+1)/W*span;lo[x]=Math.min(nb-1,Math.floor(f0*nb));hi[x]=Math.min(nb,Math.max(lo[x]+1,Math.floor(f1*nb)));}
 waterMap={W,nb,a:view.a,b:view.b,lo,hi};}return waterMap;}
function paintRows(rows,y0){const n=rows.length;if(!n)return;const W=water.width,nb=rows[0].length,m=wmap(W,nb),floor=Number($('floor').value),range=Number($('range').value),scale=255/range;
 if(!lut32){lut32=new Uint32Array(256);for(let i=0;i<256;i++){const [r,g,b]=lut[i];lut32[i]=(255<<24|b<<16|g<<8|r)>>>0;}}
 const img=wc.createImageData(W,n),px=new Uint32Array(img.data.buffer),lo=m.lo,hi=m.hi;
 for(let r=0;r<n;r++){const row=rows[r],base=r*W;for(let x=0;x<W;x++){let v=row[lo[x]];for(let j=lo[x]+1;j<hi[x];j++)if(row[j]>v)v=row[j];let q=(v-floor)*scale;q=q<0?0:q>255?255:q|0;px[base+x]=lut32[q];}}
 wc.putImageData(img,0,y0);}
function pushWater(rowsNewestFirst){waterHist=rowsNewestFirst.concat(waterHist);if(waterHist.length>water.height)waterHist.length=water.height;}
function redrawWater(){wc.fillStyle='#11191e';wc.fillRect(0,0,water.width,water.height);paintRows(waterHist.slice(0,water.height),0);}
for(const el of [spec,water,$('axisCanvas')]){
 el.addEventListener('wheel',e=>{e.preventDefault();const f=viewFrac(e.clientX,el),k=e.deltaY<0?0.8:1.25,a=f-(f-view.a)*k;setView(a,a+(view.b-view.a)*k);},{passive:false});
 el.addEventListener('mousedown',e=>{if(e.button===0)drag={x:e.clientX,a:view.a,b:view.b,el,moved:false};});
 el.addEventListener('dblclick',e=>{e.preventDefault();setView(0,1);});
 el.title='Wheel: zoom · drag: pan (past the edge = retune) · double-click: full span · click: tune';
}
window.addEventListener('mousemove',e=>{if(!drag)return;const dx=e.clientX-drag.x;if(!drag.moved&&Math.abs(dx)<4)return;drag.moved=true;
 const r=drag.el.getBoundingClientRect(),d=dx/r.width*(drag.b-drag.a);setView(drag.a-d,drag.b-d,connected);});
window.addEventListener('mouseup',()=>{if(drag&&drag.moved&&drag.el===spec)suppressClick=true;const was=drag&&drag.moved;drag=null;if(was&&(view.a<-1e-9||view.b>1+1e-9))retuneToView();});
// ---- frequency axis: nice 1-2-5 ticks, shared with the spectrum grid -------
function axisTicks(c,W){const span=(view.b-view.a)*c.rate,f0=c.frequency*1e6+(view.a-.5)*c.rate,f1=f0+span;
 const raw=span/Math.max(2,W/110),p=10**Math.floor(Math.log10(raw)),m=raw/p,step=(m<1.5?1:m<3.5?2:m<7.5?5:10)*p,minor=step/(step/p===2?4:5);
 const x=f=>(f-f0)/span*W,major=[],minors=[];for(let f=Math.ceil(f0/minor)*minor;f<=f1;f+=minor){const r=Math.round(f/minor)*minor;if(Math.abs(r/step-Math.round(r/step))<1e-6)major.push(r);else minors.push(r);}
 return {step,major,minors,x};}
function drawAxis(c){const el=$('axisCanvas');if(!el)return;const d=Math.min(devicePixelRatio||1,2),W=Math.round(el.clientWidth*d),H=Math.round(el.clientHeight*d);
 if(el.width!==W||el.height!==H){el.width=W;el.height=H;}const g=el.getContext('2d');g.fillStyle='#182126';g.fillRect(0,0,W,H);if(!c||!c.rate)return;
 const t=axisTicks(c,W),dec=Math.max(0,Math.ceil(-Math.log10(t.step/1e6)-1e-9));g.strokeStyle='#5b686e';g.lineWidth=d;g.beginPath();
 for(const f of t.minors){const x=Math.round(t.x(f))+.5;g.moveTo(x,0);g.lineTo(x,4*d);}g.stroke();g.strokeStyle='#a1adb2';g.beginPath();
 for(const f of t.major){const x=Math.round(t.x(f))+.5;g.moveTo(x,0);g.lineTo(x,9*d);}g.stroke();
 g.font=`${13*d}px Carlito,sans-serif`;g.fillStyle='#c0c9cd';g.textBaseline='bottom';
 for(const f of t.major){const s=(f/1e6).toFixed(dec),tw=g.measureText(s).width;g.fillText(s,Math.max(2*d,Math.min(W-tw-2*d,t.x(f)-tw/2)),H-3*d);}
 const mark=(fMHz,col)=>{const x=t.x(fMHz*1e6);if(x<0||x>W)return;g.fillStyle=col;g.beginPath();g.moveTo(x-5*d,0);g.lineTo(x+5*d,0);g.lineTo(x,7*d);g.closePath();g.fill();};
 mark(c.frequency,'#e0a040');if(tuneFrequency!==c.frequency)mark(tuneFrequency,'#37c964');}
// ---- 0 Hz handling / offset LO ---------------------------------------------
try{const v=localStorage.getItem('espSdrDcMode');if(v&&$('dcMode').querySelector(`option[value="${v}"]`))$('dcMode').value=v;}catch(e){}
function loOffset(rate){return $('dcMode').value==='offset'?(rate>=40000000?5:2):0;}
function loFrequency(){const o=loOffset(Number($('rate').value));if(!o)return tuneFrequency;
 for(const f of [tuneFrequency-o,tuneFrequency+o])if(radio.validFrequency(f))return f;return tuneFrequency;}
$('dcMode').onchange=()=>{try{localStorage.setItem('espSdrDcMode',$('dcMode').value);}catch(e){}labels();draw();};

async function api(path,body){let value;
 if(path==='connect')value=await radio.connect({port:body.port});
 else if(path==='disconnect'){value=await radio.run(()=>radio.close());}
 else if(path==='frame')value=await radio.capture(body);
 else throw Error('Unknown operation');
 return {json:async()=>value};
}
function error(e,communication=false){
 const box=$('error');box.textContent=e?.message||e;box.hidden=!e;
 if(e&&communication){const link=document.createElement('a');link.href='/flash.html';link.textContent='Install / update ESP-SDR firmware';box.append(' ',link);}
}
function config(){return {frequency:loFrequency(),rate:Number($('rate').value),bits:Number($('bits').value),fft:Number($('fft').value),bandwidth:analogBandwidth,gainMode:$('gainMode').value,gain:Number($('gain').value),trigger:{mode:'free'}};}
function clear(){trace=null;maximum=null;waterHist=[];if(!keepView)view={a:0,b:1};keepView=false;wc.fillStyle='#11191e';wc.fillRect(0,0,water.width,water.height);draw();}
function resize(){const old=document.createElement('canvas');old.width=water.width;old.height=water.height;old.getContext('2d').drawImage(water,0,0);const d=Math.min(devicePixelRatio||1,2);spec.width=Math.round(spec.clientWidth*d);spec.height=Math.round(spec.clientHeight*d);water.width=Math.round(water.clientWidth);water.height=Math.round(water.clientHeight);wc.fillStyle='#11191e';wc.fillRect(0,0,water.width,water.height);wc.drawImage(old,0,0,old.width,old.height,0,0,water.width,old.height);draw();}
function fmtHz(hz){const a=Math.abs(hz);return a>=1e9?(hz/1e9).toFixed(6)+' GHz':a>=1e6?(hz/1e6).toFixed(3)+' MHz':a>=1e3?(hz/1e3).toFixed(1)+' kHz':hz.toFixed(0)+' Hz';}
function measBar(c){
 const spec=connected&&$('specMode').checked,n=spec?specConfig().fft:c.fft,center=c.frequency*1e6,span=c.rate;
 // Hann window: 3 dB bandwidth 1.44 bins
 const rbw=1.44*c.rate/n,top=Number($('floor').value)+Number($('range').value),div=Number($('range').value)/4;
 const det=spec?($('specDetector').value==='max'?'max-hold':'average'):'average';
 const acq=spec?(specLast?`${(specLast.pairs/c.rate*1e3).toFixed(2)} ms · ${specLast.ffts} FFT · gapless`:'—')
  :(latest?.samples?`${(latest.samples/c.rate*1e3).toFixed(3)} ms burst`:'—');
 const item=(k,v)=>`<span>${k} <b style="color:#e8eef0;font-weight:600">${v}</b></span>`;
 $('meas').innerHTML=[item('Start',fmtHz(center-span/2)),item('Center',fmtHz(center)),item('Span',fmtHz(span)),item('Stop',fmtHz(center+span/2)),
  item('RBW',fmtHz(rbw)),item('Bins',`${n}`),item('Ref',`${top} dBFS`),item('Div',`${div} dB`),item('Det',det),item('Acq',acq),item('Mode',spec?'SPEC on-chip':'burst IQ')].join('');
}
function labels(f){const warning=connected?radio.frequencyWarning(tuneFrequency):'';$('tuningWarning').textContent=warning;$('tuningWarning').hidden=!warning;$('frequency').classList.toggle('offband',!!warning);$('frequency').title=warning;const c=f||config();drawAxis(c);measBar(c);}
function draw(){const w=spec.width,h=spec.height,d=Math.min(devicePixelRatio||1,2),floor=Number($('floor').value),range=Number($('range').value);sc.fillStyle='#182126';sc.fillRect(0,0,w,h);sc.lineWidth=d;sc.font=`${14*d}px Carlito,sans-serif`;
for(let i=0;i<=4;i++){const y=i*h/4;sc.strokeStyle='#344047';sc.beginPath();sc.moveTo(0,y);sc.lineTo(w,y);sc.stroke();sc.fillStyle='#a1adb2';sc.fillText(`${Math.round(floor+range-i*range/4)}`,8*d,Math.max(16*d,y-5*d));}
{const c=latest?{frequency:latest.frequency,rate:latest.rate}:config(),t=axisTicks(c,w);sc.strokeStyle='#202a2f';sc.beginPath();for(const f of t.minors){const x=Math.round(t.x(f))+.5;sc.moveTo(x,0);sc.lineTo(x,h);}sc.stroke();sc.strokeStyle='#33424a';sc.beginPath();for(const f of t.major){const x=Math.round(t.x(f))+.5;sc.moveTo(x,0);sc.lineTo(x,h);}sc.stroke();if(tuneFrequency!==c.frequency){const x=t.x(tuneFrequency*1e6);sc.save();sc.setLineDash([4*d,4*d]);sc.strokeStyle='#37c96490';sc.beginPath();sc.moveTo(x,0);sc.lineTo(x,h);sc.stroke();sc.restore();}drawAxis(c);}
function line(values,color,fill){if(!values)return;sc.beginPath();const L=values.length-1,sp=view.b-view.a,i0=Math.max(0,Math.floor(view.a*L)-1),i1=Math.min(L,Math.ceil(view.b*L)+1);for(let i=i0;i<=i1;i++){const v=values[i],x=(i/L-view.a)/sp*w,y=Math.max(0,Math.min(h,(1-(v-floor)/range)*h));if(i>i0)sc.lineTo(x,y);else sc.moveTo(x,y);}sc.strokeStyle=color;sc.lineWidth=1.2*d;sc.stroke();if(fill){sc.lineTo(w,h);sc.lineTo(0,h);sc.closePath();const g=sc.createLinearGradient(0,0,0,h);g.addColorStop(0,'#37c96445');g.addColorStop(1,'#37c96403');sc.fillStyle=g;sc.fill();}}
if($('hold').checked)line(maximum,'#e6b969',false);line(trace,'#37c964',true);}
function render(f){const k=[f.frequency,f.rate,f.bits,f.fft,f.bandwidth,f.gainMode,f.gainMode==='MANUAL'?f.gain:'HARDWARE'].join('/');if(key!==k){key=k;clear();}latest=f;const a=Number($('average').value);trace=f.spectrum.map((v,i)=>trace?10*Math.log10(a*10**(trace[i]/10)+(1-a)*10**(v/10)):v);maximum=f.spectrum.map((v,i)=>maximum?Math.max(maximum[i],v):v);draw();
wc.drawImage(water,0,0,water.width,water.height-1,0,1,water.width,water.height-1);pushWater([Float32Array.from(f.spectrum)]);paintRows([waterHist[0]],0);autoScale(trace);
$('gainStatus').textContent=f.gain_actual?.mode==='HARDWARE'?'Hardware AGC':f.gain_actual?`Manual · index ${f.gain_actual.index}`:'Update SDR firmware for gain control.';$('empty').hidden=true;labels(f);$('fpsLabel').textContent='frames/s';$('throughputLabel').textContent='kS/s delivered';$('latencyLabel').textContent='ms / capture + transfer';const now=performance.now();$('fps').textContent=previous?(1000/(now-previous)).toFixed(1):'—';previous=now;$('throughput').textContent=f.delivered_ksps.toFixed(1);$('latency').textContent=f.elapsed_ms.toFixed(1);$('peak').textContent=(f.peak_hz/1e6).toFixed(4);$('crc').textContent=`CRC OK · #${f.sequence}${f.dropped_captures?` · ${f.dropped_captures} dropped · ${f.samples} samples`:''}`;}
async function loop(){
 if(running)return;
 running=true;
 try{
  while(connected&&!paused){
   try{
    if($('specMode').checked&&radio.hasSpec)await specLoop();
    else{
    const f=await(await api('frame',config())).json();
    if(connected&&!paused&&!radio.changingBaud&&selectRxFrame(f))render(f);
    }
    if(!radio.changingBaud)error('');
   }catch(e){
    if(radio.changingBaud)break;
    paused=true;
    const disconnected=!!radio.failed;
    if(disconnected){connected=false;await radio.run(()=>radio.close()).catch(()=>{});}
    state();
    error(disconnected?e:`${e?.message||e} Change the settings and select Resume.`,disconnected);
    break;
   }
   if(connected&&!paused)await new Promise(r=>setTimeout(r,10));
  }
 }finally{running=false;}
}
function serialWarning(){
 const warning=$('serialWarning'),button=$('lowerBaud');
 warning.hidden=!connected||radio.droppedCaptures<3;
 const available=radio.supportsBaudChange&&radio.transport==='UART'&&radio.baudRate>1000000;
 button.hidden=!available;button.disabled=!!radio.changingBaud;
 button.textContent=radio.changingBaud?'Switching…':'Switch to 1 MBaud';
 $('serialWarningText').textContent=available
  ?'Repeated capture errors. A slower serial connection may help; the RF sample rate stays the same.'
  :radio.transport==='UART'&&radio.baudRate===1000000
   ?'Capture errors continue at 1 MBaud. Check the USB connection or try a smaller FFT.'
   :radio.transport==='USB'?'Repeated capture errors. Check the USB connection or try a smaller FFT.'
   :'Repeated capture errors. Check the USB connection. Updated firmware enables a slower UART connection.';
}
function state(){
 serialWarning();
 $('baudStatus').hidden=!connected||radio.transport!=='UART';
 $('baudStatus').textContent=radio.transport==='UART'?`${radio.baudRate/1000000} MBaud`:'';
 $('connect').disabled=!!radio.changingBaud;
 const warning=connected?radio.frequencyWarning(tuneFrequency):'';$('tuningWarning').textContent=warning;$('tuningWarning').hidden=!warning;$('frequency').classList.toggle('offband',!!warning);$('frequency').title=warning;
 for(const control of document.querySelectorAll('aside input,aside select'))control.disabled=!connected||!!radio.changingBaud;
 const specOk=connected&&!radio.changingBaud&&radio.hasSpec&&radio.transport==='USB';$('specMode').disabled=!specOk;if(!specOk)$('specMode').checked=false;else if(!specUserOff&&!$('specMode').checked){$('specMode').checked=true;setTimeout(specWideOpen,0);}$('specRow').disabled=!specOk||!$('specMode').checked;$('specDetector').disabled=$('specRow').disabled;
 if(connected&&$('specMode').checked)$('bits').disabled=true;
 {const specOn=connected&&$('specMode').checked,sizes=specOn?specSizes(Number($('rate').value)):[512,1024,2048,4096];
  for(const o of $('fft').options){o.disabled=!sizes.includes(Number(o.value));o.hidden=o.disabled;}
  $('specNote').hidden=!specOn;
  $('specNote').textContent=Number($('rate').value)===80000000?(Number($('fft').value)>256?'80 MS/s with 1024/2048 bins: the second core transforms every 14th block (~7 % of the samples); 256 bins cover ~10 %.':'80 MS/s: 256 bins cover ~10 % of the samples; 1024/2048 bins need the second core.'):
   'Hardware AGC in SPEC = viewer auto gain (keeps peaks below −14 dBFS). Manual gain is kept as set.';
  if(!sizes.includes(Number($('fft').value)))$('fft').value=String(specOn?sizes[sizes.length-1]:2048);}
 $('deviceModel').textContent=connected?(radio.deviceName||'ESP32-'+radio.family):'';$('deviceModel').hidden=!connected;
 $('status').textContent=connected?(paused?'Paused':'Receiving'):'Disconnected';
 $('connect').textContent=connected?'Disconnect':'Connect ESP-SDR';$('light').classList.toggle('on',connected&&!paused);
 $('pause').disabled=!connected||!!radio.changingBaud;$('pause').textContent=paused?'Resume':'Pause';
 
 for(const b of document.querySelectorAll('[data-freq]'))b.disabled=!connected||!!radio.changingBaud||(+b.dataset.freq===5500&&radio.family!=='C5')||!radio.validFrequency(+b.dataset.freq);
 $('gainMode').querySelector('[value=HARDWARE]').disabled=connected&&!radio.hasHardwareAgc;$('gainMode').disabled=!connected||!!radio.changingBaud||!radio.hasGain;
 $('gain').disabled=!connected||!!radio.changingBaud||$('gainMode').value!=='MANUAL'||!radio.hasGain;
 $('bandwidthOpen').disabled=!connected||!!radio.changingBaud||!radio.bandwidthRange;$('bandwidth').disabled=!connected||!!radio.changingBaud||!radio.bandwidthRange||$('bandwidthOpen').checked;
}
function bandwidthChanged(){if(!$('bandwidthOpen').checked&&!$('bandwidth').checkValidity()){$('bandwidth').reportValidity();return;}analogBandwidth=$('bandwidthOpen').checked?0:Number($('bandwidth').value);clear();}
$('bandwidthOpen').onchange=()=>{state();bandwidthChanged();};$('bandwidth').onchange=bandwidthChanged;
$('gainMode').onchange=()=>{agcNote='';state();clear();};$('gain').oninput=()=>{$('gainValue').textContent=`${$('gain').value} / ${radio.gainMax}`;clear();};
radio.onCaptureError=serialWarning;
$('lowerBaud').onclick=async()=>{
 if(!connected||radio.changingBaud)return;
 paused=true;radio.changingBaud=true;state();
 try{
  await radio.setBaudRate(1000000);
  paused=false;previous=0;latest=null;clear();error('');
 }catch(e){connected=!!radio.port&&!radio.failed;error(e,!connected);}
 finally{radio.changingBaud=false;state();if(connected&&!paused)loop();}
};
// Port memory: the last port that connected (USB VID/PID) is reused without the
// picker; the first picker lists only Espressif native USB (Shift+click: all ports).
const PORT_KEY='espSdrPort';
function savedPort(){try{return JSON.parse(localStorage.getItem(PORT_KEY)||'null');}catch(e){return null;}}
function rememberPort(p){try{const i=p.getInfo?.()||{};if(i.usbVendorId)localStorage.setItem(PORT_KEY,JSON.stringify({vid:i.usbVendorId,pid:i.usbProductId}));}catch(e){}}
async function choosePort(ev){
 if(!navigator.serial)throw Error('WebSerial support is required in this browser.');
 if(!ev?.shiftKey){const saved=savedPort(),ports=await navigator.serial.getPorts();
  const hit=ports.find(p=>{const i=p.getInfo?.()||{};return saved?i.usbVendorId===saved.vid&&i.usbProductId===saved.pid:i.usbVendorId===0x303a;});
  if(hit)return hit;if(ev?.auto)return null;}
 return navigator.serial.requestPort(ev?.shiftKey?{}:{filters:[{usbVendorId:0x303a}]});
}
$('connect').title='Connects to the remembered port. Shift+click: choose any serial port.';
$('connect').onclick=async(ev)=>{if(ev?.auto&&(connected||$('connect').disabled))return;$('connect').disabled=true;try{if(connected){connected=false;state();const done=api('disconnect',{});
 const timedOut=await Promise.race([done.then(()=>false),new Promise(r=>setTimeout(()=>r(true),2000))]);
 if(timedOut){await radio.closePort().catch(()=>{});await done.catch(()=>{});}}else{const port=await choosePort(ev);if(!port)return;await api('connect',{port});rememberPort(port);applyRadioProfile();specWideOpen();connected=true;paused=false;previous=0;latest=null;clear();loop();}error('');}catch(e){error(e,!['NotFoundError','AbortError'].includes(e?.name));}finally{$('connect').disabled=false;state();}};
$('pause').onclick=()=>{paused=!paused;previous=0;state();if(!paused){error('');loop();}};$('clear').onclick=clear;
for(const id of ['rate','bits','fft'])$(id).onchange=()=>{state();labels();if(id==='rate')specWideOpen();};
$('frequency').onchange=()=>{tuneFrequency=Number($('frequency').value);labels();};
$('frequency').onkeydown=e=>{if(e.key==='Enter')$('frequency').blur();};
for(const b of document.querySelectorAll('[data-freq]'))b.onclick=()=>{$('frequency').value=b.dataset.freq;tuneFrequency=Number(b.dataset.freq);labels();};
for(const id of ['floor','range'])$(id).oninput=()=>{$('floorValue').textContent=$('floor').value+' dBFS';$('rangeValue').textContent=$('range').value+' dB';$('scale').textContent=`${$('floor').value} → ${Number($('floor').value)+Number($('range').value)} dBFS`;clear();};
$('hold').onchange=()=>{maximum=null;draw();};
spec.onmousemove=e=>{if(!latest)return;const x=(e.clientX-spec.getBoundingClientRect().left)/spec.clientWidth,i=Math.max(0,Math.min(latest.fft-1,Math.floor(x*latest.fft)));$('cursor').textContent=`${((latest.frequency*1e6+(x-.5)*latest.rate)/1e6).toFixed(5)} MHz · ${latest.spectrum[i].toFixed(1)} dBFS`;};
spec.onclick=e=>{if(suppressClick){suppressClick=false;return;}if(connected&&latest){tuneFrequency=radio.nearestFrequency(latest.frequency+(viewFrac(e.clientX,spec)-.5)*latest.rate/1e6);$('frequency').value=tuneFrequency;labels();}};
new ResizeObserver(resize).observe(spec);labels();state();

// Keep a frame-selection boundary for future signal-based triggering.
function selectRxFrame(f){
 return f.frequency===loFrequency()&&f.rate===Number($('rate').value)&&
  (!f.trigger||f.trigger.mode==='free');
}

// ---- SPEC stream: firmware-computed spectra (256/1024/2048 bins) ----------
let specPending=[],specLast=null,specRAF=0,specCount=[],specInfo=null,agcNote='',autoT=0,waterMap=null,lut32=null;
// SPEC auto gain (used when 'Hardware AGC' is selected): the chip's AGC would
// switch gain inside the continuous stream, so the viewer ranges a manual
// gain on the frame's total power instead. Gain index is ~1 dB per step.
let specGain=null,gainWin={max:-200,t:0,low:0};
// measured receive gain vs index (VSG60, doc 08): ~1 dB/step, flat 20..30
const GAIN_DB=[[0,0],[10,10.3],[20,21.1],[30,20.8],[40,30.2],[50,41.9],[60,51.3],[70,61.3],[82,73.3]];
function gainDb(g){for(let i=1;i<GAIN_DB.length;i++){const [g0,d0]=GAIN_DB[i-1],[g1,d1]=GAIN_DB[i];if(g<=g1)return d0+(Math.max(g,g0)-g0)/(g1-g0)*(d1-d0);}return GAIN_DB[GAIN_DB.length-1][1]+(g-82);}
const AGC_REF=60,agcMax=()=>Math.min(radio.gainMax,AGC_REF); // above 60 the floor only rises 1:1

// measured: gain index ~1 dB/step except 20..30, which is flat -> never park inside it
const gainFix=(g,up)=>g>20&&g<30?(up?30:20):g;
// Firmware bins are |FFT(I+jQ)|^2 in FFT order; this app displays conj(I+jQ)
// (see capture(): q is negated), so web bin j holds firmware bin (n/2-j) mod n.
// code/step = 10log10|X|^2 with X = FFT(IQ10*64*hann)/n; 84.3 dB maps that to
// the dBFS scale of spectrum() (full scale 512, Hann power normalization), for any n.
function specToDbfs(bins,step,n){const out=new Float32Array(n);for(let j=0;j<n;j++){const v=bins[(n/2-j+n)%n];out[j]=v?v/step-84.3:-140;}
 // zero-IF DC offset / LO leakage (35-45 dB over the floor, VSG60 test): bridge DC +-1 bin
 if($('dcMode').value==='fill'){const c=n/2,m=10*Math.log10((10**(out[c-2]/10)+10**(out[c+2]/10))/2);out[c-1]=out[c]=out[c+1]=m;}return out;}
// [stride in n-sample blocks, units (12288 samples) per frame], measured on an
// ESP32-S3 at 1 core: frames stay under ~400 kB/s and few FFTs are skipped.
// Strides measured with the dual-core PIE firmware (stride_sweep.py, mean
// detector, no abandoned blocks, lateness < 60 % of the limit).
const SPEC_PARAMS={16000000:{256:[2,1],1024:[2,4],2048:[3,7]},40000000:{256:[5,3],1024:[5,9],2048:[7,17]},80000000:{256:[10,5],1024:[14,16],2048:[14,30]}};
function specSizes(rate){return radio.hasSpecN?Object.keys(SPEC_PARAMS[rate]||{256:0}).map(Number):[256];}
function specConfig(){const c=config(),rate=SPEC_PARAMS[c.rate]?c.rate:16000000,sizes=specSizes(rate),fft=sizes.includes(c.fft)?c.fft:sizes[0];
 const [stride,upf0]=SPEC_PARAMS[rate][fft];
 // One bank unit is 12288 pairs (0.77 ms at 16 MS/s). With a waterfall row of
 // rowMs, ~2 frames per row are enough: let the chip merge the rest (same
 // detector, same picture, far less dB coding / CRC / USB work on the chip).
 const unitMs=12288e3/rate,rowMs=Number($('specRow').value)||0,upf=Math.min(1000,Math.max(upf0,Math.floor(rowMs/unitMs/2)));
 const auto=c.gainMode==='HARDWARE';if(auto&&specGain===null)specGain=Math.min(agcMax(),Math.max(radio.gainMin,50));
 return {...c,rate,fft,bits:10,stride,upf,maxHold:$('specDetector').value==='max',autoGain:auto,gainMode:auto?'MANUAL':c.gainMode,gain:auto?specGain:c.gain};}
async function specLoop(){
 const c=specConfig(),n=c.fft,rowMs=Number($('specRow').value);let agg=null,aggN=0,aggT=0;gainWin={max:-200,t:performance.now(),low:0};
 const changed=()=>{const m=specConfig();return m.frequency!==c.frequency||m.gainMode!==c.gainMode||m.gain!==c.gain||m.bandwidth!==c.bandwidth||m.maxHold!==c.maxHold||m.rate!==c.rate||m.fft!==c.fft||Number($('specRow').value)!==rowMs;};
 if(!specRAF)specRAF=requestAnimationFrame(specFrame);
 specInfo=await radio.spec(c,(h,bins,info)=>{
  specInfo=info;if(h.pairs)specCov=h.ffts*n/h.pairs;const s=specToDbfs(bins,h.step,n);
  // auto gain: show levels referred to gain AGC_REF, so gain steps do not move the picture
  const comp=c.autoGain?gainDb(AGC_REF)-gainDb(c.gain):0,d=comp?s.map(v=>v+comp):s;
  if(!agg){agg=d;aggN=1;aggT=h.t;}else if(c.maxHold){for(let i=0;i<n;i++)if(d[i]>agg[i])agg[i]=d[i];}
  else{aggN++;for(let i=0;i<n;i++)agg[i]=10*Math.log10(((aggN-1)*10**(agg[i]/10)+10**(d[i]/10))/aggN);}
  specLast=h;specCount.push(performance.now());
  if(c.autoGain){let p=0;for(let i=0;i<n;i++)p+=10**(s[i]/10);const tot=10*Math.log10(p/1.5);
   if(tot>gainWin.max)gainWin.max=tot;const now=performance.now();
   if(tot>-6&&specGain>radio.gainMin){specGain=Math.max(radio.gainMin,gainFix(specGain-8,false));gainWin={max:-200,t:now,low:0};}
   else if(now-gainWin.t>400){
    if(gainWin.max>-12&&specGain>radio.gainMin)specGain=Math.max(radio.gainMin,gainFix(specGain-3,false)),gainWin.low=0;
    else if(gainWin.max<-30){if(++gainWin.low>=8&&specGain<agcMax())specGain=Math.min(agcMax(),gainFix(specGain+2,true)),gainWin.low=0;}
    else gainWin.low=0;
    gainWin.max=-200;gainWin.t=now;}
   agcNote=`SPEC auto gain · index ${specGain} · levels referred to index ${AGC_REF} · peak total ${tot.toFixed(0)} dBFS`;}
  if(h.t-aggT>=rowMs/1000){specPending.push(agg);agg=null;}
  // hidden tab: no animation frames, so bound the backlog here
  if(specPending.length>1024)specPending.splice(0,specPending.length-512);
  if(specCount.length>4096){const t=performance.now()-1000;let i=0;while(i<specCount.length&&specCount[i]<t)i++;specCount.splice(0,i);}
 },()=>!connected||paused||!$('specMode').checked||changed());
}
function specFrame(){specRAF=0;if(specPending.length){let rows=specPending;specPending=[];if(rows.length>water.height)rows=rows.slice(-water.height);renderSpec(rows);}if(connected&&!paused&&$('specMode').checked)specRAF=requestAnimationFrame(specFrame);}
function renderSpec(rows){
 const c=specConfig(),nb=rows[0].length,k=['spec',c.rate,nb,c.frequency,c.bandwidth,c.autoGain?'AUTO':c.gain,$('specRow').value].join('/');
 if(key!==k){key=k;clear();}
 const cur=Float32Array.from(rows[0]);if(c.maxHold){for(const r of rows)for(let i=0;i<nb;i++)if(r[i]>cur[i])cur[i]=r[i];}
 else for(let i=0;i<nb;i++){let p=0;for(const r of rows)p+=10**(r[i]/10);cur[i]=10*Math.log10(p/rows.length);}
 const a=Number($('average').value);
 if(trace&&trace.length!==nb){trace=null;maximum=null;}
 trace=Array.from(cur,(v,i)=>trace?10*Math.log10(a*10**(trace[i]/10)+(1-a)*10**(v/10)):v);
 maximum=Array.from(cur,(v,i)=>maximum?Math.max(maximum[i],v):v);
 latest={frequency:c.frequency,rate:c.rate,fft:nb,spectrum:trace};draw();
 const n=Math.min(rows.length,water.height),floor=Number($('floor').value),range=Number($('range').value),W=water.width;
 wc.drawImage(water,0,0,W,water.height-n,0,n,W,water.height-n);
 // one pixel column = max of the bins it covers in the current view
 const newest=[];for(let r=0;r<n;r++)newest.push(rows[rows.length-1-r]);pushWater(newest);paintRows(newest,0);
 autoScale(trace);
 let peak=0;for(let j=1;j<nb;j++)if(cur[j]>cur[peak])peak=j;
 const now=performance.now();while(specCount.length&&specCount[0]<now-1000)specCount.shift();
 $('empty').hidden=true;labels(c);
 $('fps').textContent=`${specCount.length}`;$('fpsLabel').textContent='spectra/s';
 {const st=specInfo&&specInfo.stats,el=$('chipStats');el.hidden=!st||performance.now()-st.t>3000;if(!el.hidden)el.textContent=`ESP32-S3 · core0 ${st.core0.toFixed(0)} % · core1 ${st.dual?st.core1.toFixed(0)+' %':'off'} · FFT ${st.coverage.toFixed(0)} % (${(st.fftsPerS/1e3).toFixed(1)} k/s) · RAM free ${(st.heapFree/1024).toFixed(0)} KB (max block ${(st.heapLargest/1024).toFixed(0)} KB) · late ${st.lateMax} · skipped ${st.abandoned} · queue ${st.queue.toFixed(0)} %`;}
 $('throughput').textContent=(specCount.length*(32+nb)/1e3).toFixed(0);$('throughputLabel').textContent=`kB/s over USB · ${c.rate/1e6} MS/s gapless on chip · FFT on ${Math.round(specCov*100)} % of samples`;
 $('latency').textContent=specLast?(specLast.pairs/c.rate*1e3).toFixed(2):'—';$('latencyLabel').textContent=`ms / spectrum · ${c.maxHold?'max':'mean'} of ${specLast?.ffts??'—'} FFT`;
 $('peak').textContent=((c.frequency*1e6+(peak-nb/2)*c.rate/nb)/1e6).toFixed(4);
 const g=specInfo?.gain;$('gainStatus').textContent=agcNote||(g?.mode==='HARDWARE'?'Hardware AGC':g?`Manual · index ${g.index}`:'');
 $('crc').textContent=`SPEC · gapless · #${specLast?.frame??0}${specLast?.drops?` · ${specLast.drops} dropped`:''}${specInfo?.crcErrors?` · ${specInfo.crcErrors} CRC err`:''}${specInfo?.hostDropped?` · ${Math.round(specInfo.hostDropped/1024)} kB skipped (page busy)`:''}`;
}
// Default analog bandwidth is 20 MHz (-3 dB at +-10 MHz, VSG60 sweep): at 40/80 MS/s
// SPEC would show filtered noise at the edges. Open it once, visibly; the user can close it again.
function specWideOpen(){if($('specMode').checked&&Number($('rate').value)>=40000000&&radio.bandwidthRange&&!$('bandwidthOpen').checked){$('bandwidthOpen').checked=true;analogBandwidth=0;state();}}
// Turbo Mode (SPEC) is the default whenever available; a manual switch-off sticks for this page.
var specUserOff=false; // var: state() may run before this line
$('specMode').onchange=()=>{specUserOff=!$('specMode').checked;state();specWideOpen();};
// Auto scale: floor a little under the noise (20th percentile), top a little
// above the strongest bin; applied at most twice a second, smoothed, without
// clearing the waterfall.
let autoPk=null;
// Calm auto scale: floor = 20th percentile - 10 dB in 5 dB steps (4 dB hysteresis),
// top = slowly decaying peak hold + 5 dB in 10 dB steps; evaluated once a second.
function autoScale(values){
 if(!$('autoscale').checked||!values?.length)return;
 const now=performance.now();if(now-autoT<1000)return;autoT=now;
 const v=Array.from(values).filter(Number.isFinite).sort((a,b)=>a-b);if(v.length<8)return;
 const nf=v[Math.floor(v.length*.2)]-10,pk=v[v.length-1];autoPk=autoPk===null?pk:Math.max(pk,autoPk-2);
 const f0=Number($('floor').value),r0=Number($('range').value);
 let floor=Math.abs(nf-f0)>4?Math.round(nf/5)*5:f0,top=f0+r0;
 if(autoPk+5>top||autoPk+25<top)top=Math.ceil((autoPk+5)/10)*10;
 floor=Math.max(-140,Math.min(-40,floor));const range=Math.max(20,Math.min(120,top-floor));
 if(floor===f0&&range===r0)return;
 $('floor').value=floor;$('range').value=range;
 $('floorValue').textContent=floor+' dBFS';$('rangeValue').textContent=range+' dB';
 $('scale').textContent=`${floor} → ${floor+range} dBFS`;redrawWater();draw();
}
$('autoscale').onchange=()=>{autoT=0;autoPk=null;};
// ---- spectrum / waterfall splitter ----------------------------------------
{const sp=$('splitter'),def=[220,380],set=(hs,hw)=>{spec.style.height=hs+'px';water.style.height=hw+'px';resize();redrawWater();};
 try{const v=JSON.parse(localStorage.getItem('espSdrSplit')||'null');if(Array.isArray(v)&&v.length===2)set(v[0],v[1]);}catch(e){}
 let sd=null;sp.addEventListener('pointerdown',e=>{sd={y:e.clientY,hs:spec.clientHeight,hw:water.clientHeight};sp.setPointerCapture(e.pointerId);sp.classList.add('drag');e.preventDefault();});
 sp.addEventListener('pointermove',e=>{if(!sd)return;const tot=sd.hs+sd.hw,hs=Math.max(80,Math.min(tot-80,sd.hs+e.clientY-sd.y));set(hs,tot-hs);});
 sp.addEventListener('pointerup',()=>{if(!sd)return;sd=null;sp.classList.remove('drag');try{localStorage.setItem('espSdrSplit',JSON.stringify([spec.clientHeight,water.clientHeight]));}catch(e){}});
 sp.addEventListener('dblclick',()=>{set(def[0],def[1]);try{localStorage.removeItem('espSdrSplit');}catch(e){}});}

// Start without a click: connect to the remembered port as soon as the page
// loads and whenever a device is plugged in (only ports this site was granted).
if(navigator.serial){navigator.serial.addEventListener('connect',()=>setTimeout(()=>$('connect').onclick({auto:true}),500));
 setTimeout(()=>$('connect').onclick({auto:true}),300);}
