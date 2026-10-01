'use strict';
// Direct Web Serial driver. No network requests or server-side processing.
const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
// Yield to the event loop without timers: hidden tabs throttle setTimeout to 1 Hz,
// which starves the SPEC reader. MessageChannel tasks are not throttled.
const yieldTask=(()=>{const ch=new MessageChannel(),q=[];ch.port1.onmessage=()=>{const r=q.shift();if(r)r();};return()=>new Promise(r=>{q.push(r);ch.port2.postMessage(0);});})();
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}for(let len=2;len<=n;len*=2){const a=-2*Math.PI/len,cr=Math.cos(a),ci=Math.sin(a);for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){const k=i+j,l=k+len/2,tr=re[l]*wr-im[l]*wi,ti=re[l]*wi+im[l]*wr;re[l]=re[k]-tr;im[l]=im[k]-ti;re[k]+=tr;im[k]+=ti;const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;}}}}
function spectrum(iq,n){const sums=new Float64Array(n),window=Float64Array.from({length:n},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(n-1))),norm=window.reduce((a,b)=>a+b,0)**2,blocks=Math.floor(iq.length/2/n);for(let b=0;b<blocks;b++){const re=new Float64Array(n),im=new Float64Array(n);let mi=0,mq=0;for(let j=0;j<n;j++){mi+=iq[2*(b*n+j)];mq+=iq[2*(b*n+j)+1];}mi/=n;mq/=n;for(let j=0;j<n;j++){re[j]=(iq[2*(b*n+j)]-mi)*window[j];im[j]=(iq[2*(b*n+j)+1]-mq)*window[j];}fft(re,im);for(let j=0;j<n;j++)sums[j]+=(re[j]**2+im[j]**2)/norm/blocks;}return Array.from({length:n},(_,j)=>10*Math.log10(Math.max(1e-14,sums[(j+n/2)%n])));}
class BurstSerialRadio {
 constructor(){this.maxSamples=16380;this.captureSamples=null;this.droppedCaptures=0;this.baudRate=2000000;this.transport=null;this.supportsBaudChange=false;this.changingBaud=false;this.gainMin=0;this.gainMax=0;this.gainStep=1;this.bandwidthRange=null;this.sampleBits=[8,10];this.family="C5";this.hasExtendedTune=false;this.tuneRange=null;this.rxRates=[80000000,40000000,20000000,10000000,8000000,4000000];this.port=null;this.queue=[];this.queued=0;this.wake=null;this.reader=null;this.writer=null;this.failed=null;this.tail=Promise.resolve();this.sequence=0;this.last=null;this.frequency=null;this.filter=null;this.analogFilter=null;this.bandwidth=null;this.gainSetting=null;}
 run(f){const p=this.tail.then(f);this.tail=p.catch(()=>{});return p;}
 async pump(){try{for(;;){const {value,done}=await this.reader.read();if(done)break;if(value){this.queue.push(value);this.queued+=value.length;if(this.lossy&&this.queued>1048576){while(this.queued>262144){const b=this.queue.shift();this.queued-=b.length;this.hostDropped+=b.length;}}if(this.queued>2*1024*1024)throw Error('WebSerial receive queue overflow');if(this.wake)this.wake();}}}catch(e){this.failed=e;}finally{this.failed ||= Error('WebSerial disconnected');if(this.wake)this.wake();}}
 async read(n,deadline=performance.now()+5000,idleMs=Infinity){let idleDeadline=performance.now()+idleMs;const out=new Uint8Array(n);let offset=0;while(offset<n){if(this.queued){const b=this.queue[0],k=Math.min(n-offset,b.length);out.set(b.subarray(0,k),offset);offset+=k;this.queued-=k;idleDeadline=performance.now()+idleMs;if(k===b.length)this.queue.shift();else this.queue[0]=b.subarray(k);continue;}if(this.failed)throw this.failed;const ms=Math.min(deadline,idleDeadline)-performance.now();if(ms<=0)throw Object.assign(Error('WebSerial response timed out'),{code:'SERIAL_TIMEOUT'});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.wake=null;reject(Object.assign(Error('WebSerial response timed out'),{code:'SERIAL_TIMEOUT'}));},ms);this.wake=()=>{clearTimeout(timer);this.wake=null;resolve();};});}return out;}
 async line(prefix=''){let s='',end=performance.now()+5000;for(let j=0;j<256;j++){const b=(await this.read(1,end))[0];if(b===10){s=s.trim();if(!s.startsWith(prefix))throw Error(s||'Empty WebSerial response');return s;}s+=String.fromCharCode(b);}throw Object.assign(Error('Invalid WebSerial header'),{code:'CAPTURE_DAMAGED'});}
 async command(s){await this.writer.write(new TextEncoder().encode(s+'\n'));}
 async synchronize(){
  // Opening a UART bridge or native serial port can reset the board. A command
  // sent during boot is lost, so retry with a fresh marker after draining logs.
  for(let attempt=0;attempt<3;attempt++){
   const marker='SYNC '+Date.now(),deadline=performance.now()+2000;
   await this.command('\n'+marker);let window='';
   try{
    for(let j=0;j<70000;j++){
     window+=String.fromCharCode((await this.read(1,deadline))[0]);
     if(window.length>marker.length+1)window=window.slice(-marker.length-1);
     if(window===marker+'\n')return;
    }
   }catch(e){if(this.failed)throw e;}
  }
  throw Error('SDR synchronization failed. Unplug your ESP32 device and plug it back in, then try connecting again. Check the UART baud setting, install ESP-SDR firmware, and close other SDR clients.');
 }
 async startUartFirmware(){
  // USB/UART bridges wire DTR to GPIO0 and RTS to EN. A previous flasher or
  // port-open transition can leave the ESP32 in reset or the ROM downloader.
  // Native USB ports must not receive this external-UART reset sequence.
  const vendor=this.port.getInfo?.().usbVendorId;
  if(![0x10c4,0x1a86,0x0403,0x067b].includes(vendor))return;
  await this.port.setSignals({dataTerminalReady:false,requestToSend:true});
  try{await new Promise(resolve=>setTimeout(resolve,100));}
  finally{await this.port.setSignals({dataTerminalReady:false,requestToSend:false});}
 }
 async openPort(port,baudRate){
  this.port=port;
  await port.open({baudRate,bufferSize:131072,flowControl:'none'});
  this.baudRate=baudRate;this.reader=port.readable.getReader();this.writer=port.writable.getWriter();
  this.queue=[];this.queued=0;this.failed=null;this.pumping=this.pump();
 }
 async closePort(){
  if(this.reader){await this.reader.cancel().catch(()=>{});await this.pumping;this.reader.releaseLock();this.reader=null;}
  if(this.writer){this.writer.releaseLock();this.writer=null;}
  if(this.port){await this.port.close().catch(()=>{});this.port=null;}
  this.frequency=null;this.filter=null;this.analogFilter=null;this.bandwidth=null;this.gainSetting=null;this.last=null;
 }
 async connectPort(port,baudRate,reset=true){
  // Only an initial connection resets the board. A baud switch must preserve
  // the running firmware and its volatile UART rate.
  const rates=port.getInfo?.().usbVendorId===0x303a?[baudRate]:[...new Set([baudRate,2000000,1000000])];
  let failure;
  for(const rate of rates){
   try{
    await this.openPort(port,rate);
    if(reset)await this.startUartFirmware();
    else{
     // Release EN (RTS) before GPIO0 (DTR): sequential signal updates in
     // the opposite order can reset the board and lose its runtime baud.
     await port.setSignals({requestToSend:false});
     await port.setSignals({dataTerminalReady:false});
    }
    await this.synchronize();return;
   }
   catch(e){failure=e;await this.closePort();}
  }
  throw failure;
 }
 async connect({baudRate=2000000,port=null}={}){
  if(!navigator.serial)throw Error('WebSerial support is required in this browser.');
  if(!isSecureContext)throw Error('Serve this page over HTTPS or localhost.');
  if(!port)port=await navigator.serial.requestPort();
  return this.run(async()=>{
   await this.close();
   try{await this.connectPort(port,baudRate);return await this.negotiate();}
   catch(e){await this.close();throw e;}
  });
 }
 async negotiate(){await this.command('INFO');this.identity=await this.line();this.applyIdentity(this.identity);await this.command('CAPS');const caps=await this.line();this.supportsBaudChange=false;this.transport=null;if(caps.split(' ').includes('UARTBAUD')){await this.command('TRANSPORT?');const t=/^TRANSPORT (UART|USB) (\d+)$/.exec(await this.line());if(!t||(t[1]==='UART'?Number(t[2])!==this.baudRate:Number(t[2])!==0))throw Error('Invalid serial transport response');this.transport=t[1];this.supportsBaudChange=this.transport==='UART';}if(this.family==='S3')this.rxRates=[80000000,...(caps.split(' ').includes('RX40')?[40000000]:[]),...(caps.split(' ').includes('RX16')?[16000000]:[])];this.hasSerialLease=caps.split(' ').some(c=>c==='SERIALLEASE'||c==='DUALSERIAL');this.hasExtendedTune=caps.split(' ').includes('TUNEEXT');this.tuneRange=null;if(this.hasExtendedTune){await this.command('RANGE?');const h=(await this.line('RANGE ')).split(' '),lo=Number(h[1]),hi=Number(h[2]);if(h.length!==4||!Number.isInteger(lo)||!Number.isInteger(hi)||lo<100||hi>6000||lo>=hi||h[3]!=='1')throw Error('Invalid tuning range');this.tuneRange=[lo,hi];}this.hasAnalogFilter=caps.split(' ').includes('LPFANA');this.hasAnalogBandwidth=this.family!=='S3'&&caps.split(' ').includes('ALPF');this.hasFilter12=this.family!=='S3'&&caps.split(' ').includes('LPF12');this.hasFilter=caps.split(' ').includes('LPF')||this.hasAnalogFilter;this.hasGain=caps.split(' ').includes('GAIN');this.hasSpec=caps.split(' ').includes('SPEC');this.hasSpecN=caps.split(' ').includes('SPECN');this.hasSpecStats=caps.split(' ').includes('SPECSTAT');this.hasHardwareAgc=caps.split(' ').includes('HWAGC');if(caps.split(' ').includes('RXLIMITS')){await this.command('LIMITS?');this.applyLimits(await this.line('LIMITS '));}else{await this.command('GAIN?');const g=(await this.line('GAIN ')).split(' ');this.applyLimits('LIMITS '+JSON.stringify({gain:[Number(g[3]),Number(g[4]),1],bandwidth:null,rates:this.rxRates,bits:[8,10]}));}this.deviceName=this.family==='ESP32'?'ESP32':'ESP32-'+this.family;return {identity:this.identity,port:this.deviceName,family:this.family,filter:this.hasFilter};}
 async setBaudRate(baudRate){return this.run(async()=>{
  this.changingBaud=true;
  try{
   if(!this.port||!this.supportsBaudChange||this.transport!=='UART')throw Error('Update ESP-SDR firmware to enable UART baud changes.');
   if(![1000000,2000000].includes(baudRate))throw Error('Choose 1 or 2 MBaud.');
   if(baudRate===this.baudRate)return;
   const port=this.port;
   await this.synchronize();
   await this.command(`BAUD ${baudRate}`);
   let acknowledgement;
   try{acknowledgement=await this.line();}catch(e){
    // The ACK can itself lose bytes. Probe the port at both rates below.
    if(e.code!=='SERIAL_TIMEOUT'&&e.code!=='CAPTURE_DAMAGED')throw e;
   }
   if(acknowledgement?.startsWith('ERR '))throw Error(acknowledgement);
   // Do not send LPF/RELEASE here: the device may already use the new baud.
   await this.closePort();
   try{await this.connectPort(port,baudRate,false);await this.negotiate();}
   catch(e){await this.close();throw e;}
   if(this.transport!=='UART'||this.baudRate!==baudRate)throw Error('The device did not retain the requested baud rate; it may have reset during port reopen. The default connection was recovered.');
  }catch(e){if(this.failed)await this.close();throw e;}finally{this.changingBaud=false;}
 });}
 applyIdentity(identity){
  const m=/^(ESP32|C3|C5|C6|C61|S2|S3|S31)SDR 6 burst (\d+)$/.exec(identity);
  const n=m?Number(m[2]):0;
  if(!m||!Number.isInteger(n)||n<4096||n>16384)throw Error('Unsupported SDR firmware: '+identity);
  this.family=m[1];this.maxSamples=n;this.captureSamples=null;this.droppedCaptures=0;
  this.rxRates=this.family==='ESP32'?[80000000,40000000,16000000]:this.family==='S31'?[16000000,8000000,4000000]:(this.family==='C3'||this.family==='S3'||this.family==='S2'||this.family==='C6')?[80000000]:[80000000,40000000,20000000,10000000,8000000,4000000];
 }
 applyLimits(line){
  let limits;try{limits=JSON.parse(line.slice(7));}catch{throw Error('Invalid receiver limits');}
  const range=(r,max)=>Array.isArray(r)&&r.length===3&&r.every(Number.isInteger)&&r[0]>=0&&r[1]>=r[0]&&r[1]<=max&&r[2]>0&&r[2]<=Math.max(1,r[1]-r[0])&&(r[1]-r[0])%r[2]===0;
  const g=limits?.gain,b=limits?.bandwidth,rates=limits?.rates,bits=limits?.bits;
  if(!line.startsWith('LIMITS ')||!range(g,127)||!(b===null||(Array.isArray(b)&&b.length===4&&range(b.slice(0,3),1000)&&b[0]>0&&Number.isInteger(b[3])&&(b[3]===0||(b[3]>=b[0]&&b[3]<=b[1]&&(b[3]-b[0])%b[2]===0))))||!Array.isArray(rates)||!rates.length||rates.some(r=>![80000000,40000000,20000000,10000000,8000000,4000000,16000000].includes(r))||new Set(rates).size!==rates.length||!Array.isArray(bits)||!bits.length||bits.some(b=>![8,10].includes(b))||new Set(bits).size!==bits.length)throw Error('Invalid receiver limits');
  [this.gainMin,this.gainMax,this.gainStep]=g;this.bandwidthRange=b;this.rxRates=rates;this.sampleBits=bits;
 }
 async close(){if(this.writer&&this.reader&&!this.failed&&this.hasFilter){try{await this.command('LPF AUTO');await this.line('OK');}catch(e){/* Disconnect still releases USB after a lost response. */}}if(this.writer&&this.reader&&!this.failed&&this.hasAnalogBandwidth){try{await this.command('ALPF AUTO');await this.line('OK');}catch(e){}}if(this.hasSerialLease&&this.writer&&this.reader&&!this.failed){try{await this.command('RELEASE');await this.line('OK');}catch(e){/* Idle ownership expires if the port disappears. */}}this.hasSerialLease=false;this.hasExtendedTune=false;this.tuneRange=null;await this.closePort();this.transport=null;this.supportsBaudChange=false;}
 validFrequency(f){
  if(!Number.isInteger(f))return false;
  if(this.hasExtendedTune)return !!this.tuneRange&&f>=this.tuneRange[0]&&f<=this.tuneRange[1];
  // Only firmware without TUNEEXT needs the historical family defaults.
  if(this.family==='ESP32')return f>=2412&&f<=2472&&(f-2412)%5===0;
  if(this.family==='S31')return f>=2300&&f<=2800;
  if(this.family==='C61')return f>=2400&&f<=2500;
  if(this.family==='C5')return (f>=2100&&f<=2700)||(f>=4800&&f<=6000);
  return (f>=2412&&f<=2472&&(f-2412)%5===0)||f===2484;
 }
 frequencyWarning(f){
  if(!this.validFrequency(f)||(f>=2400&&f<=2483.5)||(this.family==='C5'&&f>=5150&&f<=5895))return '';
  return this.family==='C5'?'Outside the 2.4 GHz ISM band and the supported 5 GHz Wi-Fi band. The PLL may not lock, and the spectrum may not match the selected center frequency.':'Outside the 2.4 GHz ISM band. The PLL may not lock, and the spectrum may not match the selected center frequency.';
 }
 nearestFrequency(f){
  f=Math.round(f);
  if(this.hasExtendedTune&&this.tuneRange)return Math.max(this.tuneRange[0],Math.min(this.tuneRange[1],f));
  // Compatibility with firmware predating range negotiation.
  if(this.family==='C61')return Math.max(2400,Math.min(2500,f));
  if(this.family==='S31')return Math.max(2300,Math.min(2800,f));
  if(this.family==='C5'){
   const ranges=[[2100,2700],[4800,6000]];
   return ranges.map(([lo,hi])=>Math.max(lo,Math.min(hi,f))).reduce((a,b)=>Math.abs(a-f)<=Math.abs(b-f)?a:b);
  }
  const channels=Array.from({length:13},(_,i)=>2412+i*5);
  if(this.family!=='ESP32')channels.push(2484);
  return channels.reduce((a,b)=>Math.abs(a-f)<=Math.abs(b-f)?a:b);
 }
 frequencyInput(){
  if(this.hasExtendedTune&&this.tuneRange)return {min:this.tuneRange[0],max:this.tuneRange[1],step:1};
  if(this.family==='ESP32')return {min:2412,max:2472,step:5};
  if(this.family==='C61')return {min:2400,max:2500,step:1};
  if(this.family==='S31')return {min:2300,max:2800,step:1};
  return this.family==='C5'?{min:2100,max:6000,step:1}:{min:2412,max:2484,step:1};
 }
 async tune(frequency,bandwidth=0){
  if(!this.validFrequency(frequency))throw Error(this.hasExtendedTune?`Choose a whole-MHz center frequency from ${this.tuneRange[0]} to ${this.tuneRange[1]} MHz.`:this.family==='ESP32'?'Choose a Wi-Fi channel center from 2412 to 2472 MHz in 5 MHz steps.':'This firmware cannot attempt that center frequency. Install updated firmware for extended tuning.');
  if(!this.port)throw Error('Connect the SDR first.');
  const range=this.bandwidthRange;
  if(!Number.isInteger(bandwidth)||bandwidth<0||(bandwidth!==0&&(!range||bandwidth<range[0]||bandwidth>range[1]||(bandwidth-range[0])%range[2]!==0)))throw Error(range?`Choose an analog bandwidth from ${range[0]} to ${range[1]} MHz.`:'Manual analog bandwidth is not characterized for this firmware.');
  if(this.frequency!==frequency){this.frequency=null;await this.command('FREQ '+frequency);await this.line('OK');this.frequency=frequency;}
  if(range&&this.bandwidth!==bandwidth){await this.command('BANDWIDTH '+bandwidth);await this.line('OK');this.bandwidth=bandwidth;}
 }
 async setGain(mode='HARDWARE',code=40){if(!['HARDWARE','MANUAL'].includes(mode)||!Number.isInteger(code)||code<this.gainMin||code>this.gainMax||(code-this.gainMin)%this.gainStep!==0)throw Error(`Choose a gain index from ${this.gainMin} to ${this.gainMax}.`);if(!this.hasGain)throw Error('Update SDR firmware for gain control.');if(mode==='HARDWARE'&&!this.hasHardwareAgc)throw Error('Update SDR firmware for hardware AGC.');const setting=mode==='MANUAL'?'MANUAL '+code:mode;if(setting!==this.gainSetting){await this.command('GAIN '+setting);await this.line('OK');this.gainSetting=setting;}await this.command('GAIN?');const h=(await this.line('GAIN ')).split(' ');if(!['HARDWARE','MANUAL'].includes(h[1])||!Number.isInteger(Number(h[2])))throw Error('Invalid gain response');return {mode:h[1],index:h[1]==='HARDWARE'?null:Number(h[2])};}
 async capturePacket(c,divider){
  let n=Math.max(c.fft,this.captureSamples??this.maxSamples);
  const damaged=message=>Object.assign(Error(message),{code:'CAPTURE_DAMAGED'});
  for(let attempt=0;attempt<6;attempt++){
   await this.command(`CAP${c.bits*2} ${n} ${divider}`);
   try{
    const header=await this.line();
    if(header.startsWith('ERR '))throw Error(header);
    const h=/^DATA (\d+) ([0-9a-fA-F]{1,8}) (\d+)$/.exec(header);
    if(!h||Number(h[1])!==n)throw damaged('Invalid capture length or header');
    // Detect a truncated transfer once data stops arriving, while allowing
    // continuous transfers at slower baud rates up to the overall deadline.
    const bytes=await this.read(Math.ceil(n*c.bits*2/8),performance.now()+5000,500);
    if(crc32(bytes)!==parseInt(h[2],16))throw damaged('Capture CRC mismatch');
    this.captureSamples=n;
    return {bytes,n,captureUs:Number(h[3]),retries:attempt};
   }catch(e){
    if(this.failed||!['SERIAL_TIMEOUT','CAPTURE_DAMAGED'].includes(e.code))throw e;
    this.droppedCaptures++;this.onCaptureError?.();
    // A fresh echoed marker drains late payload bytes and restores framing.
    // Do this even after the final failure so Resume starts from a boundary.
    try{await this.synchronize();}catch(syncError){throw Error(`${e.message}; resynchronization failed: ${syncError.message}`,{cause:syncError});}
    n=Math.max(c.fft,2**Math.ceil(Math.log2(n/2)));
    this.captureSamples=n;
    if(attempt===5)throw Error(`Capture failed after 6 attempts: ${e.message}. Check the serial connection.`);
   }
  }
 }
 async capture(c){return this.run(async()=>{const divider=[80000000,40000000,20000000,10000000,8000000,4000000,16000000].indexOf(c.rate);if(divider<0||!this.rxRates.includes(c.rate)||!this.sampleBits.includes(c.bits)||![512,1024,2048,4096].includes(c.fft))throw Error('Invalid capture settings');const start=performance.now();await this.tune(c.frequency,c.bandwidth??0);const gain=await this.setGain(c.gainMode,c.gain);const {bytes,n,captureUs,retries}=await this.capturePacket(c,divider);const iq=new Float32Array(n*2);let acc=0,bits=0,k=0;for(let j=0;j<n;j++){let i,q;if(c.bits===8){i=bytes[j*2];q=bytes[j*2+1];if(i>=128)i-=256;if(q>=128)q-=256;i*=4;q*=4;}else{while(bits<20){acc|=bytes[k++]<<bits;bits+=8;}const w=acc&0xfffff;acc>>>=20;bits-=20;i=w&1023;q=w>>>10;if(i>=512)i-=1024;if(q>=512)q-=1024;}iq[2*j]=i/512;iq[2*j+1]=-q/512;}
 const ps=spectrum(iq,c.fft);let peak=0;for(let j=1;j<ps.length;j++)if(ps[j]>ps[peak])peak=j;const elapsed=performance.now()-start;this.last={iq,frequency:c.frequency,rate:c.rate,bandwidth:c.bandwidth??0,bits:c.bits,time:Date.now()};return {...c,gain_actual:gain,sequence:++this.sequence,spectrum:ps,peak_hz:c.frequency*1e6+(peak-c.fft/2)*c.rate/c.fft,peak_db:ps[peak],capture_us:captureUs,samples:n,retries,dropped_captures:this.droppedCaptures,elapsed_ms:elapsed,delivered_ksps:n/elapsed,crc_ok:true,iq};});}

}
const radio=new BurstSerialRadio();

// SPEC: continuous on-chip spectra (ESP32-S3 firmware with the SPEC capability).
// Frame: "SPC1", u32 frame, u64 pair index, u32 pairs, u16 ffts, u8 flags, u8 gain,
// u16 drops, u8 log2(n), u8 dB step, n codes (dB*step of |X|^2, FFT order), u32 CRC.
BurstSerialRadio.prototype.spec=function(c,onFrame,shouldStop){return this.run(async()=>{
 if(!this.hasSpec)throw Error('This firmware has no SPEC mode.');
 if(this.transport!=='USB')throw Error('SPEC streams over the native USB port only.');
 await this.tune(c.frequency,c.bandwidth??0);
 const gain=await this.setGain(c.gainMode,c.gain);
 const code={16000000:6,40000000:1,80000000:0}[c.rate];if(code===undefined)throw Error('SPEC supports 16, 40 and 80 MS/s.');
 const n=this.hasSpecN?c.fft:256;
 await this.command(`SPEC 0 ${c.stride||4} ${c.upf||1} ${c.maxHold===false?0:1} ${code}${this.hasSpecN?' '+n:''}${this.hasSpecN&&this.hasSpecStats?' 1':''}`);
 const head=(await this.line('SPEC ')).split(' ');
 const info={nfft:Number(head[1]),fs:Number(head[2]),lo:Number(head[4])*1e6,gain,crcErrors:0};
 if(info.nfft!==n||!(info.fs>0))throw Error('Unexpected SPEC header');
 const isMagic=w=>w[0]===0x53&&w[1]===0x50&&w[2]===0x43&&w[3]===0x31;   // SPC1
 const isEnd=w=>w[0]===0x53&&w[1]===0x50&&w[2]===0x45&&w[3]===0x43;     // SPEC(END)
 const isStat=w=>w[0]===0x53&&w[1]===0x50&&w[2]===0x53&&w[3]===0x31;    // SPS1 chip statistics
 const flen=28+n+4;
 // SPEC is a live stream: if the page cannot keep up, skip old data (lossy)
 // instead of failing, and always leave the device stopped on exit.
 let stopping=false,count=0,ended=false;this.lossy=true;this.hostDropped=0;
 try{
 for(;;){
  if((++count&31)===0)await yieldTask();
  if(!stopping&&shouldStop()){stopping=true;await this.command('');}
  const deadline=performance.now()+5000;
  let w=await this.read(4,deadline);
  while(!isMagic(w)&&!isEnd(w)&&!isStat(w)){const b=await this.read(1,deadline);w=Uint8Array.of(w[1],w[2],w[3],b[0]);}
  if(isStat(w)){const rest=await this.read(36,deadline),body=new Uint8Array(36);body.set(w,0);body.set(rest.subarray(0,32),4);
   const crc=(rest[32]|rest[33]<<8|rest[34]<<16|rest[35]<<24)>>>0;if(crc32(body)!==crc){info.crcErrors++;continue;}
   const dv=new DataView(body.buffer);info.stats={core0:dv.getUint16(4,true)/10,core1:dv.getUint16(6,true)/10,coverage:dv.getUint16(8,true)/10,
    dual:!!(body[10]&1),assist:!!(body[10]&2),heapFree:dv.getUint32(12,true),heapLargest:dv.getUint32(16,true),abandoned:dv.getUint32(20,true),
    drops:dv.getUint32(24,true),lateMax:dv.getUint16(28,true),queue:dv.getUint16(30,true)/10,fftsPerS:dv.getUint32(32,true),t:performance.now()};continue;}
  if(isEnd(w)){info.report='SPEC'+await this.line('');ended=true;return info;}
  const rest=await this.read(flen-4,deadline),body=new Uint8Array(flen-4);
  body.set(w,0);body.set(rest.subarray(0,flen-8),4);
  const crc=(rest[flen-8]|rest[flen-7]<<8|rest[flen-6]<<16|rest[flen-5]<<24)>>>0;
  if(crc32(body)!==crc||(1<<body[26])!==n){info.crcErrors++;continue;}
  const dv=new DataView(body.buffer);
  const h={frame:dv.getUint32(4,true),pairIndex:Number(dv.getBigUint64(8,true)),pairs:dv.getUint32(16,true),
   ffts:dv.getUint16(20,true),flags:body[22],gain:body[23],drops:dv.getUint16(24,true),step:body[27]||2,n,bytes:flen};
  h.t=h.pairIndex/info.fs;info.hostDropped=this.hostDropped;
  onFrame(h,body.subarray(28,28+n),info);
 }
 }finally{
  this.lossy=false;
  if(!ended&&!this.failed&&this.writer){try{await this.command('');const end=performance.now()+1500;let w=new Uint8Array(4);
   for(;;){const b=await this.read(1,end);w=Uint8Array.of(w[1],w[2],w[3],b[0]);if(isEnd(w)){await this.line('');break;}}}catch(e){/* watchdog ends the run */}}
 }
});};
