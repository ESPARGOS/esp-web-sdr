import {ESPLoader,Transport} from './vendor/esptool-js-0.7.0.js';
import {loadManifest,checkedImages} from './catalog.mjs';
const $=id=>document.getElementById(id);
const manifestUrl=new URL('../firmware/manifest.json',import.meta.url);
let firmware=null;
let loader=null,transport=null,busy=false,detectedFlashSize=null;
function flashMatches(variant, detected) {
 const actual=/^(\d+)MB$/.exec(detected),required=/^(\d+)MB$/.exec(variant.flash_size);
 if(!actual||!required)return false;
 return variant.flash_size_policy==='minimum'?Number(actual[1])>=Number(required[1]):detected===variant.flash_size;
}

function selectedFirmware(){const variant=firmware.variants[$('revision').value];if(!variant)throw Error('Choose your chip profile first.');if(variant.browser_supported===false)throw Error('This chip is not supported by the bundled browser flasher. Use ESP-IDF/esptool with the firmware artifact.');return variant;}
// esptool-js 0.7.0 inherits C6 SPI_REG_BASE (0x60002000) for C5.
// Espressif esptool targets/esp32c5.py specifies 0x60003000 for C5.
class SDRLoader extends ESPLoader {
 async detectChip(...args){
  await super.detectChip(...args);
  if(!Object.values(firmware.variants).some(v=>v.browser_supported!==false&&v.chip===this.chip.CHIP_NAME))throw Error('Wrong chip: no matching firmware is packaged.');
  if(this.chip.CHIP_NAME==='ESP32-C5')this.chip.SPI_REG_BASE=0x60003000;
 }
}
const log=text=>{$('log').textContent+=text;$('log').scrollTop=$('log').scrollHeight;};
function status(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error);}
function buttons(){const supported=!!navigator.serial&&isSecureContext;$('connect').disabled=!firmware||busy||!!transport||!supported;$('revision').disabled=!firmware||busy;$('install').disabled=busy||!loader||!$('revision').value;$('disconnect').disabled=busy||!transport;}
function beforeUnload(e){if(busy){e.preventDefault();e.returnValue='';}}
window.addEventListener('beforeunload',beforeUnload);
async function disconnect(){loader=null;detectedFlashSize=null;if(transport){const t=transport;transport=null;await t.disconnect();}$('device').textContent='Not connected';}
$('revision').onchange=()=>{buttons();$('version').textContent=firmware.variants[$('revision').value]?.version||firmware.version;status((firmware.variants[$('revision').value]?.label||'No board')+' selected. Install firmware matching your ESP32 chip.');};
$('connect').onclick=async()=>{
 busy=true;buttons();$('log').textContent='';status('Select your ESP32 device.');
 try{
  const port=await navigator.serial.requestPort();
  transport=new Transport(port,false);
  const candidate=new SDRLoader({transport,baudrate:115200,terminal:{clean(){},write:log,writeLine:s=>log(s+'\n')}});
  status('Connecting to the bootloader…');await candidate.main();
  if(!Object.values(firmware.variants).some(v=>v.browser_supported!==false&&v.chip===candidate.chip.CHIP_NAME))throw Error('Wrong chip: no matching firmware is packaged.');
  const size=await candidate.detectFlashSize();if(!Object.values(firmware.variants).some(v=>v.browser_supported!==false&&v.chip===candidate.chip.CHIP_NAME&&flashMatches(v,size)))throw Error(`Detected ${size} flash; no packaged board matches this chip and flash size.`);detectedFlashSize=size;
  loader=candidate;
  $('device').textContent=`${loader.chip.CHIP_NAME} · ${size} · ${await loader.chip.readMac(loader)}`;
  status($('revision').value?'Connected. Select Install ESP-SDR firmware to replace the current firmware.':'Connected. Choose the chip profile before installing.');
 }catch(e){status(`${e.message||e} Close other USB clients; if needed, reconnect while holding BOOT and retry.`,true);try{await disconnect();}catch(_){} }
 finally{busy=false;buttons();}
};
$('install').onclick=async()=>{
 if(!loader||busy)return;busy=true;buttons();$('progress').value=0;
 try{
  const variant=selectedFirmware();
  if(variant.chip!==loader.chip.CHIP_NAME)throw Error(`Selected ${variant.chip} firmware, but connected chip is ${loader.chip.CHIP_NAME}. Choose the matching chip profile.`);
  if(!flashMatches(variant,detectedFlashSize))throw Error(`Selected firmware requires ${variant.flash_size_policy==='minimum'?'at least ':''}${variant.flash_size} flash; detected ${detectedFlashSize}.`);
  status('Downloading and checking firmware…');
  const fileArray=await checkedImages(variant,$('revision').value,manifestUrl),total=fileArray.reduce((s,f)=>s+f.data.length,0);
  status(`Writing ${variant.label} firmware. Keep the device connected.`);log(`Selected profile: ${variant.revision}\n`);
  await loader.writeFlash({fileArray,flashMode:'keep',flashFreq:'keep',flashSize:'keep',eraseAll:false,compress:true,
   reportProgress:(i,written,size)=>{const before=fileArray.slice(0,i).reduce((s,f)=>s+f.data.length,0);$('progress').value=100*(before+fileArray[i].data.length*written/size)/total;}});
  status('Verifying flash contents…');
  for(const part of variant.parts){
   const actual=await loader.flashMd5sum(part.offset,part.size);
   if(actual.toLowerCase()!==part.md5)throw Error(`Flash verification failed for ${part.name}. Reconnect and install again.`);
   log(`Verified ${part.name}: ${actual}\n`);
  }
  $('progress').value=100;
  // C5 watchdog reset is unimplemented in esptool-js 0.7.0. A physical
  // unplug/replug reliably leaves download mode on this board.
  await disconnect();
  status(`Firmware installed and verified for ${variant.label}. Unplug for five seconds, reconnect, then open ESP-WebSDR.`);
 }catch(e){status(`Installation failed: ${e.message||e} Reconnect in BOOT mode and retry.`,true);try{await disconnect();}catch(_){} }
 finally{busy=false;buttons();}
};
$('disconnect').onclick=async()=>{busy=true;buttons();try{await disconnect();status('Disconnected. Unplug and reconnect to boot the installed firmware.');}catch(e){status(e.message,true);}finally{busy=false;buttons();}};
buttons();
async function initialize(){
 try{
  const capabilitiesResponse=await fetch(new URL('./vendor/esptool-js-0.7.0-chips.json',import.meta.url));
  if(!capabilitiesResponse.ok)throw Error('Cannot load browser flashing capabilities.');
  const chips=new Set(await capabilitiesResponse.json());
  firmware=await loadManifest(manifestUrl);
  for(const [id,variant] of Object.entries(firmware.variants)){
   variant.browser_supported=chips.has(variant.chip);
   const option=document.createElement('option');option.value=id;
   option.textContent=variant.label+(variant.browser_supported?'':' · browser flashing unavailable');
   option.disabled=!variant.browser_supported;$('revision').append(option);
  }
  const versions=[...new Set(Object.values(firmware.variants).map(v=>v.version))];
  $('version').textContent=versions.join(', ');
  const unavailable=Object.values(firmware.variants).filter(v=>!v.browser_supported);
  if(unavailable.length){const note=document.createElement('p');note.className='muted';note.textContent=unavailable.map(v=>v.chip).join(', ')+': firmware is available, but the bundled browser flasher does not support this chip yet. Use ESP-IDF/esptool with the firmware artifact.';$('revision').after(note);}
  const requestedBoard=new URLSearchParams(location.search).get('board');
  if(requestedBoard&&firmware.variants[requestedBoard]?.browser_supported)$('revision').value=requestedBoard;
  status(navigator.serial&&isSecureContext?'Ready.':'This browser needs Web Serial support. Serve this page over HTTPS or localhost.',!(navigator.serial&&isSecureContext));
 }catch(e){firmware=null;status(`Cannot load firmware: ${e.message} Check that the firmware folder is deployed alongside this website.`,true);}
 buttons();
}
initialize();
