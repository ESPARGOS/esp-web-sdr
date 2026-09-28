'use strict';
const $=id=>document.getElementById(id);
const s3Channels=Array.from({length:13},(_,i)=>2412+i*5).concat(2484);
function nearestS3Channel(f){return s3Channels.reduce((a,b)=>Math.abs(a-f)<=Math.abs(b-f)?a:b);}
function applyRadioProfile(){
 $('gain').min=radio.gainMin;$('gain').max=radio.gainMax;$('gain').step=radio.gainStep;$('gain').value=Math.min(Math.max(40,radio.gainMin),radio.gainMax);$('gainValue').textContent=`${$('gain').value} / ${radio.gainMax}`;
 $('gainMode').querySelector('[value=HARDWARE]').disabled=!radio.hasHardwareAgc;
 if(!radio.hasGain||(!radio.hasHardwareAgc&&$('gainMode').value==='HARDWARE'))$('gainMode').value='MANUAL';
 for(const [id,rates] of [['rate',radio.rxRates]]){
  for(const o of $(id).options)o.disabled=!rates.includes(Number(o.value));
  if(!rates.includes(Number($(id).value)))$(id).value=String(rates[0]);
 }
 const bandwidth=radio.bandwidthRange;analogBandwidth=bandwidth?bandwidth[3]:0;
 $('bandwidthControl').hidden=!bandwidth;
 if(bandwidth){$('bandwidth').min=bandwidth[0];$('bandwidth').max=bandwidth[1];$('bandwidth').step=bandwidth[2];$('bandwidth').value=bandwidth[3]||bandwidth[1];$('bandwidthOpen').checked=bandwidth[3]===0;}
 $('rxTrigger').querySelector('[value=wifi]').disabled=!radio.rxRates.some(rate=>[20000000,40000000,80000000].includes(rate));
 if($('rxTrigger').selectedOptions[0].disabled)$('rxTrigger').value='free';
 for(const option of $('bits').options)option.disabled=!radio.sampleBits.includes(Number(option.value));
 if(!radio.sampleBits.includes(Number($('bits').value)))$('bits').value=String(radio.sampleBits[0]);

 {
  if(!radio.validFrequency(tuneFrequency)){tuneFrequency=2412;$('frequency').value='2412';}
 }
 state();labels();
}
let connected=false,paused=false,latest=null,trace=null,maximum=null,previous=0,key='',running=false,tuneFrequency=2412,analogBandwidth=0;
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
function config(){return {frequency:tuneFrequency,rate:Number($('rate').value),bits:Number($('bits').value),fft:Number($('fft').value),bandwidth:analogBandwidth,gainMode:$('gainMode').value,gain:Number($('gain').value),trigger:{mode:$('rxTrigger').value,threshold:Number($('rxThreshold').value),...((radio.family==='S3'||radio.family==='C6')&&$('rxTrigger').value==='ble'?{offset_hz:(Number($('bleChannel').value)-tuneFrequency)*1e6}:{})}};}
function clear(){trace=null;maximum=null;wc.fillStyle='#11191e';wc.fillRect(0,0,water.width,water.height);draw();}
function resize(){const old=document.createElement('canvas');old.width=water.width;old.height=water.height;old.getContext('2d').drawImage(water,0,0);const d=Math.min(devicePixelRatio||1,2);spec.width=Math.round(spec.clientWidth*d);spec.height=Math.round(spec.clientHeight*d);water.width=Math.round(water.clientWidth);water.height=Math.round(water.clientHeight);wc.fillStyle='#11191e';wc.fillRect(0,0,water.width,water.height);wc.drawImage(old,0,0,old.width,old.height,0,0,water.width,old.height);draw();}
function labels(f){const warning=connected?radio.frequencyWarning(tuneFrequency):'';$('tuningWarning').textContent=warning;$('tuningWarning').hidden=!warning;const c=f||config();$('axis').replaceChildren(...Array.from({length:5},(_,i)=>{const el=document.createElement('span');el.textContent=((c.frequency*1e6+(i/4-.5)*c.rate)/1e6).toFixed(3);return el;}));}
function draw(){const w=spec.width,h=spec.height,d=Math.min(devicePixelRatio||1,2),floor=Number($('floor').value),range=Number($('range').value);sc.fillStyle='#182126';sc.fillRect(0,0,w,h);sc.lineWidth=d;sc.font=`${14*d}px Carlito,sans-serif`;
for(let i=0;i<=4;i++){const y=i*h/4;sc.strokeStyle='#344047';sc.beginPath();sc.moveTo(0,y);sc.lineTo(w,y);sc.stroke();sc.fillStyle='#a1adb2';sc.fillText(`${Math.round(floor+range-i*range/4)}`,8*d,Math.max(16*d,y-5*d));}
for(let i=1;i<8;i++){sc.strokeStyle='#293135';sc.beginPath();sc.moveTo(i*w/8,0);sc.lineTo(i*w/8,h);sc.stroke();}
function line(values,color,fill){if(!values)return;sc.beginPath();values.forEach((v,i)=>{let x=i/(values.length-1)*w,y=Math.max(0,Math.min(h,(1-(v-floor)/range)*h));if(i)sc.lineTo(x,y);else sc.moveTo(x,y);});sc.strokeStyle=color;sc.lineWidth=1.2*d;sc.stroke();if(fill){sc.lineTo(w,h);sc.lineTo(0,h);sc.closePath();const g=sc.createLinearGradient(0,0,0,h);g.addColorStop(0,'#37c96445');g.addColorStop(1,'#37c96403');sc.fillStyle=g;sc.fill();}}
if($('hold').checked)line(maximum,'#e6b969',false);line(trace,'#37c964',true);}
function render(f){const k=[f.frequency,f.rate,f.bits,f.fft,f.bandwidth,f.gainMode,f.gainMode==='MANUAL'?f.gain:'HARDWARE'].join('/');if(key!==k){key=k;clear();}latest=f;const a=Number($('average').value);trace=f.spectrum.map((v,i)=>trace?10*Math.log10(a*10**(trace[i]/10)+(1-a)*10**(v/10)):v);maximum=f.spectrum.map((v,i)=>maximum?Math.max(maximum[i],v):v);draw();
wc.drawImage(water,0,0,water.width,water.height-1,0,1,water.width,water.height-1);const row=wc.createImageData(water.width,1),floor=Number($('floor').value),range=Number($('range').value);
for(let x=0;x<water.width;x++){const lo=Math.floor(x*f.fft/water.width),hi=Math.max(lo+1,Math.floor((x+1)*f.fft/water.width));let v=-140;for(let j=lo;j<hi;j++)v=Math.max(v,f.spectrum[Math.min(j,f.fft-1)]);const c=lut[Math.max(0,Math.min(255,Math.round((v-floor)/range*255)))];row.data.set([...c,255],x*4);}wc.putImageData(row,0,0);
$('gainStatus').textContent=f.gain_actual?.mode==='HARDWARE'?'Hardware AGC':f.gain_actual?`Manual · index ${f.gain_actual.index}`:'Update SDR firmware for gain control.';$('empty').hidden=true;labels(f);const now=performance.now();$('fps').textContent=previous?(1000/(now-previous)).toFixed(1):'—';previous=now;$('throughput').textContent=f.delivered_ksps.toFixed(1);$('latency').textContent=f.elapsed_ms.toFixed(1);$('peak').textContent=(f.peak_hz/1e6).toFixed(4);$('crc').textContent=`CRC OK · #${f.sequence}`;}
async function loop(){if(running)return;running=true;try{while(connected){if(paused){await new Promise(r=>setTimeout(r,100));continue;}try{const f=await(await api('frame',config())).json();if(connected&&!paused){if(selectRxFrame(f)){render(f);}}error('');}catch(e){paused=true;if(radio.failed){connected=false;await radio.run(()=>radio.close()).catch(()=>{});}state();error(e,true);}await new Promise(r=>setTimeout(r,10));}}finally{running=false;}}
function state(){
 const warning=connected?radio.frequencyWarning(tuneFrequency):'';$('tuningWarning').textContent=warning;$('tuningWarning').hidden=!warning;
 for(const control of document.querySelectorAll('aside input,aside select'))control.disabled=!connected;
 $('deviceModel').textContent=connected?(radio.deviceName||'ESP32-'+radio.family):'';$('deviceModel').hidden=!connected;
 $('status').textContent=connected?(paused?'Paused':$('rxTrigger').value==='free'?'Receiving':'Trigger armed'):'Disconnected';
 $('connect').textContent=connected?'Disconnect':'Connect ESP-SDR';$('light').classList.toggle('on',connected&&!paused);
 $('pause').disabled=!connected;$('pause').textContent=paused?'Resume':'Pause';
 
 for(const b of document.querySelectorAll('[data-freq]'))b.disabled=!connected||!radio.validFrequency(+b.dataset.freq);
 $('gainMode').querySelector('[value=HARDWARE]').disabled=connected&&!radio.hasHardwareAgc;$('gainMode').disabled=!connected||!radio.hasGain;
 $('gain').disabled=!connected||$('gainMode').value!=='MANUAL'||!radio.hasGain;
 $('bandwidthOpen').disabled=!connected||!radio.bandwidthRange;$('bandwidth').disabled=!connected||!radio.bandwidthRange||$('bandwidthOpen').checked;
}
function bandwidthChanged(){if(!$('bandwidthOpen').checked&&!$('bandwidth').checkValidity()){$('bandwidth').reportValidity();return;}analogBandwidth=$('bandwidthOpen').checked?0:Number($('bandwidth').value);clear();}
$('bandwidthOpen').onchange=()=>{state();bandwidthChanged();};$('bandwidth').onchange=bandwidthChanged;
$('gainMode').onchange=()=>{state();clear();};$('gain').oninput=()=>{$('gainValue').textContent=`${$('gain').value} / ${radio.gainMax}`;clear();};
$('connect').onclick=async()=>{$('connect').disabled=true;try{if(connected){connected=false;state();await api('disconnect',{});}else{await api('connect',{});applyRadioProfile();connected=true;paused=false;previous=0;latest=null;clear();loop();}error('');}catch(e){error(e,!['NotFoundError','AbortError'].includes(e?.name));}finally{$('connect').disabled=false;state();}};
$('pause').onclick=()=>{paused=!paused;previous=0;state();};$('clear').onclick=clear;
for(const id of ['rate','bits','fft'])$(id).onchange=()=>{labels();};
$('frequency').onchange=()=>{tuneFrequency=Number($('frequency').value);labels();};
$('frequency').onkeydown=e=>{if(e.key==='Enter')$('frequency').blur();};
for(const b of document.querySelectorAll('[data-freq]'))b.onclick=()=>{$('frequency').value=b.dataset.freq;tuneFrequency=Number(b.dataset.freq);labels();};
for(const id of ['floor','range'])$(id).oninput=()=>{$('floorValue').textContent=$('floor').value+' dBFS';$('rangeValue').textContent=$('range').value+' dB';$('scale').textContent=`${$('floor').value} → ${Number($('floor').value)+Number($('range').value)} dBFS`;clear();};
$('hold').onchange=()=>{maximum=null;draw();};
spec.onmousemove=e=>{if(!latest)return;const x=(e.clientX-spec.getBoundingClientRect().left)/spec.clientWidth,i=Math.max(0,Math.min(latest.fft-1,Math.floor(x*latest.fft)));$('cursor').textContent=`${((latest.frequency*1e6+(x-.5)*latest.rate)/1e6).toFixed(5)} MHz · ${latest.spectrum[i].toFixed(1)} dBFS`;};
spec.onclick=e=>{if(connected&&latest){tuneFrequency=Math.round(latest.frequency+((e.clientX-spec.getBoundingClientRect().left)/spec.clientWidth-.5)*latest.rate/1e6);if(radio.family==='S31')tuneFrequency=Math.max(2300,Math.min(2800,tuneFrequency));if(radio.family==='C61')tuneFrequency=Math.max(2400,Math.min(2500,tuneFrequency));if((radio.family==='S3'||radio.family==='C6'))tuneFrequency=radio.hasExtendedTune?Math.max(radio.tuneRange[0],Math.min(radio.tuneRange[1],tuneFrequency)):nearestS3Channel(tuneFrequency);$('frequency').value=tuneFrequency;labels();}};
new ResizeObserver(resize).observe(spec);labels();state();

let triggerScanned=0,triggerMatched=0;
function selectRxFrame(f){
 const selected=f.trigger||config().trigger;
 if(f.frequency!==tuneFrequency||f.rate!==Number($('rate').value)||JSON.stringify(selected)!==JSON.stringify(config().trigger))return false;
 if(selected.mode==='ble'&&radio.family!=='S3'&&radio.family!=='C6'&&![2402,2426,2480].includes(f.frequency))throw Error('BLE advertising detection requires 2402, 2426 or 2480 MHz.');
 const result=rxTrigger(f.iq,f.rate,selected);f.trigger_result=result;
 triggerScanned++;if(result.matched)triggerMatched++;
 $('triggerStatus').textContent=selected.mode==='free'?'Free running':`${result.matched?'Matched snapshot':'Waiting'} · ${triggerMatched}/${triggerScanned} selected · peak ${result.peak_dbfs.toFixed(1)} dBFS`;
 return result.matched;
}
function triggerChanged(){
 triggerScanned=0;triggerMatched=0;latest=null;clear();
 const mode=$('rxTrigger').value;
 $('rxThresholdLabel').hidden=mode==='free';$('bleChannelLabel').hidden=mode!=='ble';
 $('triggerStatus').textContent=mode==='free'?'Free running':'Armed for matching snapshots';state();labels();
}
$('rxTrigger').onchange=()=>{
 if($('rxTrigger').value==='wifi')$('rate').value=String([20000000,40000000,80000000].find(rate=>radio.rxRates.includes(rate)));
 if($('rxTrigger').value==='ble'){$('rate').value=(radio.family==='S3'||radio.family==='C6')?'80000000':'4000000';tuneFrequency=(radio.family==='S3'||radio.family==='C6')&&!radio.hasExtendedTune?nearestS3Channel(Number($('bleChannel').value)):Number($('bleChannel').value);$('frequency').value=tuneFrequency;}
 triggerChanged();
};
$('rxThreshold').onchange=triggerChanged;
$('bleChannel').onchange=()=>{tuneFrequency=(radio.family==='S3'||radio.family==='C6')&&!radio.hasExtendedTune?nearestS3Channel(Number($('bleChannel').value)):Number($('bleChannel').value);$('frequency').value=tuneFrequency;triggerChanged();};
