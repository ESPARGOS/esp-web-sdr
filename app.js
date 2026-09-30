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
async function api(path,body){let value;
 if(path==='connect')value=await radio.connect();
 else if(path==='disconnect'){value=await radio.run(()=>radio.close());}
 else if(path==='frame')value=await radio.capture(body);
 else throw Error('Unknown operation');
 return {json:async()=>value};
}
function error(e,communication=false){
 const box=$('error');box.textContent=e?.message||e;box.hidden=!e;
 if(e&&communication){const link=document.createElement('a');link.href='/flash.html';link.textContent='Install / update ESP-SDR firmware';box.append(' ',link);}
}
function config(){return {frequency:tuneFrequency,rate:Number($('rate').value),bits:Number($('bits').value),fft:Number($('fft').value),bandwidth:analogBandwidth,gainMode:$('gainMode').value,gain:Number($('gain').value),trigger:{mode:'free'}};}
function clear(){trace=null;maximum=null;wc.fillStyle='#11191e';wc.fillRect(0,0,water.width,water.height);draw();}
function resize(){const old=document.createElement('canvas');old.width=water.width;old.height=water.height;old.getContext('2d').drawImage(water,0,0);const d=Math.min(devicePixelRatio||1,2);spec.width=Math.round(spec.clientWidth*d);spec.height=Math.round(spec.clientHeight*d);water.width=Math.round(water.clientWidth);water.height=Math.round(water.clientHeight);wc.fillStyle='#11191e';wc.fillRect(0,0,water.width,water.height);wc.drawImage(old,0,0,old.width,old.height,0,0,water.width,old.height);draw();}
function fmtHz(hz){const a=Math.abs(hz);return a>=1e9?(hz/1e9).toFixed(6)+' GHz':a>=1e6?(hz/1e6).toFixed(3)+' MHz':a>=1e3?(hz/1e3).toFixed(1)+' kHz':hz.toFixed(0)+' Hz';}
function measBar(c){
 const spec=connected&&$('specMode').checked,n=spec?specConfig().fft:c.fft,center=c.frequency*1e6,span=c.rate;
 // Hann window: 3 dB bandwidth 1.44 bins
 const rbw=1.44*c.rate/n,top=Number($('floor').value)+Number($('range').value),div=Number($('range').value)/4;
 const det=spec?($('specDetector').value==='max'?'max-hold':'average'):'average';
 const acq=spec?(specLast?`${(specLast.pairs/c.rate*1e3).toFixed(2)} ms Â· ${specLast.ffts} FFT Â· gapless`:'â€”')
  :(latest?.samples?`${(latest.samples/c.rate*1e3).toFixed(3)} ms burst`:'â€”');
 const item=(k,v)=>`<span>${k} <b style="color:#e8eef0;font-weight:600">${v}</b></span>`;
 $('meas').innerHTML=[item('Start',fmtHz(center-span/2)),item('Center',fmtHz(center)),item('Span',fmtHz(span)),item('Stop',fmtHz(center+span/2)),
  item('RBW',fmtHz(rbw)),item('Bins',`${n}`),item('Ref',`${top} dBFS`),item('Div',`${div} dB`),item('Det',det),item('Acq',acq),item('Mode',spec?'SPEC on-chip':'burst IQ')].join('');
}
function labels(f){const warning=connected?radio.frequencyWarning(tuneFrequency):'';$('tuningWarning').textContent=warning;$('tuningWarning').hidden=!warning;const c=f||config();$('axis').replaceChildren(...Array.from({length:5},(_,i)=>{const el=document.createElement('span');el.textContent=((c.frequency*1e6+(i/4-.5)*c.rate)/1e6).toFixed(3);return el;}));measBar(c);}
function draw(){const w=spec.width,h=spec.height,d=Math.min(devicePixelRatio||1,2),floor=Number($('floor').value),range=Number($('range').value);sc.fillStyle='#182126';sc.fillRect(0,0,w,h);sc.lineWidth=d;sc.font=`${14*d}px Carlito,sans-serif`;
for(let i=0;i<=4;i++){const y=i*h/4;sc.strokeStyle='#344047';sc.beginPath();sc.moveTo(0,y);sc.lineTo(w,y);sc.stroke();sc.fillStyle='#a1adb2';sc.fillText(`${Math.round(floor+range-i*range/4)}`,8*d,Math.max(16*d,y-5*d));}
for(let i=1;i<8;i++){sc.strokeStyle='#293135';sc.beginPath();sc.moveTo(i*w/8,0);sc.lineTo(i*w/8,h);sc.stroke();}
function line(values,color,fill){if(!values)return;sc.beginPath();values.forEach((v,i)=>{let x=i/(values.length-1)*w,y=Math.max(0,Math.min(h,(1-(v-floor)/range)*h));if(i)sc.lineTo(x,y);else sc.moveTo(x,y);});sc.strokeStyle=color;sc.lineWidth=1.2*d;sc.stroke();if(fill){sc.lineTo(w,h);sc.lineTo(0,h);sc.closePath();const g=sc.createLinearGradient(0,0,0,h);g.addColorStop(0,'#37c96445');g.addColorStop(1,'#37c96403');sc.fillStyle=g;sc.fill();}}
if($('hold').checked)line(maximum,'#e6b969',false);line(trace,'#37c964',true);}
function render(f){const k=[f.frequency,f.rate,f.bits,f.fft,f.bandwidth,f.gainMode,f.gainMode==='MANUAL'?f.gain:'HARDWARE'].join('/');if(key!==k){key=k;clear();}latest=f;const a=Number($('average').value);trace=f.spectrum.map((v,i)=>trace?10*Math.log10(a*10**(trace[i]/10)+(1-a)*10**(v/10)):v);maximum=f.spectrum.map((v,i)=>maximum?Math.max(maximum[i],v):v);draw();
wc.drawImage(water,0,0,water.width,water.height-1,0,1,water.width,water.height-1);const row=wc.createImageData(water.width,1),floor=Number($('floor').value),range=Number($('range').value);
for(let x=0;x<water.width;x++){const lo=Math.floor(x*f.fft/water.width),hi=Math.max(lo+1,Math.floor((x+1)*f.fft/water.width));let v=-140;for(let j=lo;j<hi;j++)v=Math.max(v,f.spectrum[Math.min(j,f.fft-1)]);const c=lut[Math.max(0,Math.min(255,Math.round((v-floor)/range*255)))];row.data.set([...c,255],x*4);}wc.putImageData(row,0,0);autoScale(trace);
$('gainStatus').textContent=f.gain_actual?.mode==='HARDWARE'?'Hardware AGC':f.gain_actual?`Manual Â· index ${f.gain_actual.index}`:'Update SDR firmware for gain control.';$('empty').hidden=true;labels(f);$('fpsLabel').textContent='frames/s';$('throughputLabel').textContent='kS/s delivered';$('latencyLabel').textContent='ms / capture + transfer';const now=performance.now();$('fps').textContent=previous?(1000/(now-previous)).toFixed(1):'â€”';previous=now;$('throughput').textContent=f.delivered_ksps.toFixed(1);$('latency').textContent=f.elapsed_ms.toFixed(1);$('peak').textContent=(f.peak_hz/1e6).toFixed(4);$('crc').textContent=`CRC OK Â· #${f.sequence}${f.dropped_captures?` Â· ${f.dropped_captures} dropped Â· ${f.samples} samples`:''}`;}
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
 button.textContent=radio.changingBaud?'Switchingâ€¦':'Switch to 1 MBaud';
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
 const warning=connected?radio.frequencyWarning(tuneFrequency):'';$('tuningWarning').textContent=warning;$('tuningWarning').hidden=!warning;
 for(const control of document.querySelectorAll('aside input,aside select'))control.disabled=!connected||!!radio.changingBaud;
 const specOk=connected&&!radio.changingBaud&&radio.hasSpec&&radio.transport==='USB';$('specMode').disabled=!specOk;if(!specOk)$('specMode').checked=false;$('specRow').disabled=!specOk||!$('specMode').checked;$('specDetector').disabled=$('specRow').disabled;
 if(connected&&$('specMode').checked)$('bits').disabled=true;
 {const specOn=connected&&$('specMode').checked,sizes=specOn?specSizes(Number($('rate').value)):[512,1024,2048,4096];
  for(const o of $('fft').options){o.disabled=!sizes.includes(Number(o.value));o.hidden=o.disabled;}
  $('specNote').hidden=!specOn;
  $('specNote').textContent=Number($('rate').value)===80000000?'80 MS/s: 256 bins only (a larger FFT does not fit between bank switches on one core). Use 16 or 40 MS/s for 1024/2048 bins.':
   'Hardware AGC in SPEC = viewer auto gain (keeps peaks below â’14 dBFS). Manual gain is kept as set.';
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
$('connect').onclick=async()=>{$('connect').disabled=true;try{if(connected){connected=false;state();const done=api('disconnect',{});
 const timedOut=await Promise.race([done.then(()=>false),new Promise(r=>setTimeout(()=>r(true),2000))]);
 if(timedOut){await radio.closePort().catch(()=>{});await done.catch(()=>{});}}else{await api('connect',{});applyRadioProfile();specWideOpen();connected=true;paused=false;previous=0;latest=null;clear();loop();}error('');}catch(e){error(e,!['NotFoundError','AbortError'].includes(e?.name));}finally{$('connect').disabled=false;state();}};
$('pause').onclick=()=>{paused=!paused;previous=0;state();if(!paused){error('');loop();}};$('clear').onclick=clear;
for(const id of ['rate','bits','fft'])$(id).onchange=()=>{state();labels();if(id==='rate')specWideOpen();};
$('frequency').onchange=()=>{tuneFrequency=Number($('frequency').value);labels();};
$('frequency').onkeydown=e=>{if(e.key==='Enter')$('frequency').blur();};
for(const b of document.querySelectorAll('[data-freq]'))b.onclick=()=>{$('frequency').value=b.dataset.freq;tuneFrequency=Number(b.dataset.freq);labels();};
for(const id of ['floor','range'])$(id).oninput=()=>{$('floorValue').textContent=$('floor').value+' dBFS';$('rangeValue').textContent=$('range').value+' dB';$('scale').textContent=`${$('floor').value} â†’ ${Number($('floor').value)+Number($('range').value)} dBFS`;clear();};
$('hold').onchange=()=>{maximum=null;draw();};
spec.onmousemove=e=>{if(!latest)return;const x=(e.clientX-spec.getBoundingClientRect().left)/spec.clientWidth,i=Math.max(0,Math.min(latest.fft-1,Math.floor(x*latest.fft)));$('cursor').textContent=`${((latest.frequency*1e6+(x-.5)*latest.rate)/1e6).toFixed(5)} MHz Â· ${latest.spectrum[i].toFixed(1)} dBFS`;};
spec.onclick=e=>{if(connected&&latest){tuneFrequency=radio.nearestFrequency(latest.frequency+((e.clientX-spec.getBoundingClientRect().left)/spec.clientWidth-.5)*latest.rate/1e6);$('frequency').value=tuneFrequency;labels();}};
new ResizeObserver(resize).observe(spec);labels();state();

// Keep a frame-selection boundary for future signal-based triggering.
function selectRxFrame(f){
 return f.frequency===tuneFrequency&&f.rate===Number($('rate').value)&&
  (!f.trigger||f.trigger.mode==='free');
}

// ---- SPEC stream: firmware-computed spectra (256/1024/2048 bins) ----------
let specPending=[],specLast=null,specRAF=0,specCount=[],specInfo=null,agcNote='',autoT=0,waterMap=null,lut32=null;
// SPEC auto gain (used when 'Hardware AGC' is selected): the chip's AGC would
// switch gain inside the continuous stream, so the viewer ranges a manual
// gain on the frame's total power instead. Gain index is ~1 dB per step.
let specGain=null,gainWin={max:-200,t:0,low:0};
// measured: gain index ~1 dB/step except 20..30, which is flat -> never park inside it
const gainFix=(g,up)=>g>20&&g<30?(up?30:20):g;
// Firmware bins are |FFT(I+jQ)|^2 in FFT order; this app displays conj(I+jQ)
// (see capture(): q is negated), so web bin j holds firmware bin (n/2-j) mod n.
// code/step = 10log10|X|^2 with X = FFT(IQ10*64*hann)/n; 84.3 dB maps that to
// the dBFS scale of spectrum() (full scale 512, Hann power normalization), for any n.
function specToDbfs(bins,step,n){const out=new Float32Array(n);for(let j=0;j<n;j++){const v=bins[(n/2-j+n)%n];out[j]=v?v/step-84.3:-140;}
 // zero-IF DC offset / LO leakage (35-45 dB over the floor, VSG60 test): bridge DC +-1 bin
 const c=n/2,m=10*Math.log10((10**(out[c-2]/10)+10**(out[c+2]/10))/2);out[c-1]=out[c]=out[c+1]=m;return out;}
// [stride in n-sample blocks, units (12288 samples) per frame], measured on an
// ESP32-S3 at 1 core: frames stay under ~400 kB/s and few FFTs are skipped.
// 16 MS/s / 1024 needs stride >= 6: at 4-5 the mean detector overruns the bank switch (LATE abort).
const SPEC_PARAMS={16000000:{256:[4,1],1024:[6,4],2048:[3,7]},40000000:{256:[12,3],1024:[12,9],2048:[6,17]},80000000:{256:[48,5]}};
function specSizes(rate){return radio.hasSpecN?Object.keys(SPEC_PARAMS[rate]||{256:0}).map(Number):[256];}
function specConfig(){const c=config(),rate=SPEC_PARAMS[c.rate]?c.rate:16000000,sizes=specSizes(rate),fft=sizes.includes(c.fft)?c.fft:sizes[0];
 const [stride,upf]=SPEC_PARAMS[rate][fft];
 const auto=c.gainMode==='HARDWARE';if(auto&&specGain===null)specGain=Math.min(radio.gainMax,Math.max(radio.gainMin,40));
 return {...c,rate,fft,bits:10,stride,upf,maxHold:$('specDetector').value==='max',autoGain:auto,gainMode:auto?'MANUAL':c.gainMode,gain:auto?specGain:c.gain};}
async function specLoop(){
 const c=specConfig(),n=c.fft,rowMs=Number($('specRow').value);let agg=null,aggN=0,aggT=0;gainWin={max:-200,t:performance.now(),low:0};
 const changed=()=>{const m=specConfig();return m.frequency!==c.frequency||m.gainMode!==c.gainMode||m.gain!==c.gain||m.bandwidth!==c.bandwidth||m.maxHold!==c.maxHold||m.rate!==c.rate||m.fft!==c.fft||Number($('specRow').value)!==rowMs;};
 if(!specRAF)specRAF=requestAnimationFrame(specFrame);
 specInfo=await radio.spec(c,(h,bins,info)=>{
  specInfo=info;const s=specToDbfs(bins,h.step,n);
  if(!agg){agg=s;aggN=1;aggT=h.t;}else if(c.maxHold){for(let i=0;i<n;i++)if(s[i]>agg[i])agg[i]=s[i];}
  else{aggN++;for(let i=0;i<n;i++)agg[i]=10*Math.log10(((aggN-1)*10**(agg[i]/10)+10**(s[i]/10))/aggN);}
  specLast=h;specCount.push(performance.now());
  if(c.autoGain){let p=0;for(let i=0;i<n;i++)p+=10**(s[i]/10);const tot=10*Math.log10(p/1.5);
   if(tot>gainWin.max)gainWin.max=tot;const now=performance.now();
   if(tot>-6&&specGain>radio.gainMin){specGain=Math.max(radio.gainMin,gainFix(specGain-8,false));gainWin={max:-200,t:now,low:0};}
   else if(now-gainWin.t>400){
    if(gainWin.max>-14&&specGain>radio.gainMin)specGain=Math.max(radio.gainMin,gainFix(specGain-3,false)),gainWin.low=0;
    else if(gainWin.max<-35){if(++gainWin.low>=5&&specGain<radio.gainMax)specGain=Math.min(radio.gainMax,gainFix(specGain+2,true)),gainWin.low=0;}
    else gainWin.low=0;
    gainWin.max=-200;gainWin.t=now;}
   agcNote=`SPEC auto gain Â· index ${specGain} Â· peak total ${tot.toFixed(0)} dBFS`;}
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
 if(!lut32){lut32=new Uint32Array(256);for(let i=0;i<256;i++){const [r,g,b]=lut[i];lut32[i]=(255<<24|b<<16|g<<8|r)>>>0;}}
 // one pixel column = max of the bins it covers (bins > pixels at 2048)
 if(!waterMap||waterMap.W!==W||waterMap.nb!==nb){waterMap={W,nb,lo:Uint16Array.from({length:W},(_,x)=>Math.min(nb-1,Math.floor(x*nb/W))),hi:Uint16Array.from({length:W},(_,x)=>Math.min(nb,Math.max(Math.floor(x*nb/W)+1,Math.floor((x+1)*nb/W))))};}
 const img=wc.createImageData(W,n),px=new Uint32Array(img.data.buffer),scale=255/range,lo=waterMap.lo,hi=waterMap.hi;
 for(let r=0;r<n;r++){const row=rows[rows.length-1-r],base=r*W;for(let x=0;x<W;x++){let v=row[lo[x]];for(let j=lo[x]+1;j<hi[x];j++)if(row[j]>v)v=row[j];let q=(v-floor)*scale;q=q<0?0:q>255?255:q|0;px[base+x]=lut32[q];}}
 wc.putImageData(img,0,0);
 autoScale(trace);
 let peak=0;for(let j=1;j<nb;j++)if(cur[j]>cur[peak])peak=j;
 const now=performance.now();while(specCount.length&&specCount[0]<now-1000)specCount.shift();
 $('empty').hidden=true;labels(c);
 $('fps').textContent=`${specCount.length}`;$('fpsLabel').textContent='spectra/s';
 $('throughput').textContent=(specCount.length*(32+nb)/1e3).toFixed(0);$('throughputLabel').textContent=`kB/s over USB Â· ${c.rate/1e6} MS/s gapless on chip`;
 $('latency').textContent=specLast?(specLast.pairs/c.rate*1e3).toFixed(2):'â€”';$('latencyLabel').textContent=`ms / spectrum Â· ${c.maxHold?'max':'mean'} of ${specLast?.ffts??'â€”'} FFT`;
 $('peak').textContent=((c.frequency*1e6+(peak-nb/2)*c.rate/nb)/1e6).toFixed(4);
 const g=specInfo?.gain;$('gainStatus').textContent=agcNote||(g?.mode==='HARDWARE'?'Hardware AGC':g?`Manual Â· index ${g.index}`:'');
 $('crc').textContent=`SPEC Â· gapless Â· #${specLast?.frame??0}${specLast?.drops?` Â· ${specLast.drops} dropped`:''}${specInfo?.crcErrors?` Â· ${specInfo.crcErrors} CRC err`:''}${specInfo?.hostDropped?` Â· ${Math.round(specInfo.hostDropped/1024)} kB skipped (page busy)`:''}`;
}
// Default analog bandwidth is 20 MHz (-3 dB at +-10 MHz, VSG60 sweep): at 40/80 MS/s
// SPEC would show filtered noise at the edges. Open it once, visibly; the user can close it again.
function specWideOpen(){if($('specMode').checked&&Number($('rate').value)>=40000000&&radio.bandwidthRange&&!$('bandwidthOpen').checked){$('bandwidthOpen').checked=true;analogBandwidth=0;state();}}
$('specMode').onchange=()=>{state();specWideOpen();};
// Auto scale: floor a little under the noise (20th percentile), top a little
// above the strongest bin; applied at most twice a second, smoothed, without
// clearing the waterfall.
function autoScale(values){
 if(!$('autoscale').checked||!values?.length)return;
 const now=performance.now();if(now-autoT<500)return;autoT=now;
 const v=Array.from(values).filter(Number.isFinite).sort((a,b)=>a-b);if(v.length<8)return;
 const lo=v[Math.floor(v.length*.2)]-8,hi=v[v.length-1]+6;
 const f0=Number($('floor').value),r0=Number($('range').value);
 let floor=Math.round(.6*f0+.4*lo),range=Math.round(.6*r0+.4*(hi-lo));
 floor=Math.max(-140,Math.min(-40,floor));range=Math.max(20,Math.min(120,range));
 if(floor===f0&&range===r0)return;
 $('floor').value=floor;$('range').value=range;
 $('floorValue').textContent=floor+' dBFS';$('rangeValue').textContent=range+' dB';
 $('scale').textContent=`${floor} â†’ ${floor+range} dBFS`;draw();
}
$('autoscale').onchange=()=>{autoT=0;};
