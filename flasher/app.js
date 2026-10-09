import {ESPLoader,Transport} from './vendor/esptool-js-0.7.0.js';
import {loadManifest,checkedImages,firmwareDate,applicationGuidance,flashingBaudRate,checkCrystal,flashMatches,suggestedProfiles} from './catalog.mjs';
import {finishSession} from './reset.mjs';
const $=id=>document.getElementById(id);
const manifestUrl=new URL('../firmware/manifest.json',import.meta.url);
const UART_BAUDRATE=2000000;
const UART_SPEED_WARNING='UART too slow for ESP-WebSDR, choose a different dev kit';
class UartSpeedError extends Error {constructor(){super(UART_SPEED_WARNING);}}
const defaultConnection=SerialConnection.defaultKind();
const alternativeConnection=defaultConnection==='webserial'?'webusb':'webserial';
const connectionLabel=kind=>kind==='webusb'?'WebUSB':'WebSerial';
let firmware=null;
let loader=null,transport=null,busy=false,detectedFlashSize=null,uart=false,lastPort=null;

function selectedFirmware(){const variant=firmware.variants[$('revision').value];if(!variant)throw Error('Choose your chip profile first.');if(variant.browser_supported===false)throw Error('This chip is not supported by the bundled browser flasher. Use ESP-IDF/esptool with the firmware artifact.');return variant;}
class SDRTransport extends Transport {
 getInfo(){return super.getInfo().replace('WebSerial',SerialConnection.kind(this.device)==='webusb'?'WebUSB':'WebSerial');}
}
// esptool-js 0.7.0 inherits C6 SPI_REG_BASE (0x60002000) for C5.
// Espressif esptool targets/esp32c5.py specifies 0x60003000 for C5.
class SDRLoader extends ESPLoader {
 async changeBaud(){
  const requiresUartSpeed=this.baudrate===UART_BAUDRATE;
  try{await super.changeBaud();}
  catch(e){if(requiresUartSpeed)throw new UartSpeedError();throw e;}
 }
 async detectChip(...args){
  await super.detectChip(...args);
  if(this.chip.CHIP_NAME==='ESP32-C2')this.detectedCrystal=await this.chip.getCrystalFreq(this);
  if(this.chip.CHIP_NAME==='ESP32-C5')this.chip.SPI_REG_BASE=0x60003000;
 }
}
const log=text=>{$('log').textContent+=text;$('log').scrollTop=$('log').scrollHeight;};
function status(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error);$('statusBanner').hidden=false;}
$('dismissStatus').onclick=()=>{$('statusBanner').hidden=true;};
function buttons(){const variant=firmware?.variants[$('revision').value];$('s3-bridge-hint').hidden=variant?.target!=='esp32s3';const soapy=variant?.application==='soapysdr';$('open-application').href=soapy?'https://github.com/ESPARGOS/SoapyESPSDR':'index.html';$('open-application').textContent=soapy?'Set up SoapyESPSDR ↗':'Open ESP-WebSDR ↗';const supported=SerialConnection.supported()&&isSecureContext;$('connect').disabled=!firmware||busy||!!transport||!supported;$('revision').disabled=!firmware||busy||(!loader&&!lastPort);$('install').disabled=busy||(!loader&&!lastPort)||!$('revision').value;$('disconnect').disabled=busy||!transport;$('chooseConnection').disabled=$('connect').disabled;$('connectAlternative').disabled=$('connect').disabled||!navigator[alternativeConnection==='webusb'?'usb':'serial'];if(busy||transport)closeConnectMenu();}
$('connect').textContent=`Connect via ${connectionLabel(defaultConnection)}`;
$('connectAlternative').textContent=`Choose ${connectionLabel(alternativeConnection)} Device…`;
function closeConnectMenu(focus=false){$('connectMenu').hidden=true;$('chooseConnection').setAttribute('aria-expanded','false');if(focus)$('chooseConnection').focus();}
function openConnectMenu(){if($('chooseConnection').disabled)return;$('connectMenu').hidden=false;$('chooseConnection').setAttribute('aria-expanded','true');if(!$('connectAlternative').disabled)$('connectAlternative').focus();}
$('chooseConnection').onclick=()=>{$('connectMenu').hidden?openConnectMenu():closeConnectMenu(true);};
$('chooseConnection').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();openConnectMenu();}};
$('connectMenu').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();closeConnectMenu(true);}};
document.addEventListener('click',e=>{if(!e.target.closest('.connect-buttons'))closeConnectMenu();});
document.addEventListener('focusin',e=>{if(!e.target.closest('.connect-buttons'))closeConnectMenu();});
function beforeUnload(e){if(busy){e.preventDefault();e.returnValue='';}}
window.addEventListener('beforeunload',beforeUnload);
async function disconnect(){loader=null;detectedFlashSize=null;if(transport){const t=transport;transport=null;await t.disconnect();}$('device').textContent='Not connected';updateProfiles();}
function updateProfiles(selectDefault=false){
 const suggested=loader?suggestedProfiles(firmware.variants,loader.chip.CHIP_NAME,detectedFlashSize,loader.detectedCrystal):[];
 for(const option of $('revision').options){
  const variant=firmware?.variants[option.value];if(!variant)continue;
  option.dataset.suggested=String(suggested.includes(option.value));
  option.textContent=(suggested.includes(option.value)?'✓ ':'')+variant.label+(variant.browser_supported===false?' · browser flashing unavailable':'');
 }
 if(selectDefault&&!suggested.includes($('revision').value))$('revision').value=suggested[0]||'';
 const variant=firmware?.variants[$('revision').value];
 $('version').textContent=variant?firmwareDate(variant):'Choose a firmware profile';
 $('revision').dataset.suggested=String(!!loader&&suggested.includes($('revision').value));
 buttons();
}
$('revision').onchange=()=>{updateProfiles();status((firmware.variants[$('revision').value]?.label||'No firmware')+' selected. '+applicationGuidance(firmware.variants[$('revision').value]));};
async function connectDevice(previousPort=null,kind=defaultConnection){
 busy=true;buttons();$('log').textContent='';status('Select your ESP32 device.');
 try{
  const port=previousPort?await SerialConnection.reconnect(previousPort):await SerialConnection.requestPort(kind);
  uart=port.getInfo().usbVendorId!==0x303a;
  transport=new SDRTransport(port,false);
  const candidate=new SDRLoader({transport,baudrate:115200,terminal:{clean(){},write:log,writeLine:s=>log(s+'\n')}});
  status('Connecting to the bootloader…');await candidate.main();
  const size=await candidate.detectFlashSize();detectedFlashSize=size;
  loader=candidate;
  $('device').textContent=`${loader.chip.CHIP_NAME} · ${size} · ${await loader.chip.readMac(loader)}`;
  lastPort=port;
  updateProfiles(!previousPort);
  status('Connected. Review the suggested firmware or choose another profile, then select Install ESP-SDR firmware.');
 }catch(e){status(e instanceof UartSpeedError||e.code==='USB_INTERFACE_UNAVAILABLE'?e.message:`${e.message||e} Close other serial clients; if needed, reconnect while holding BOOT and retry.`,true);try{await disconnect();}catch(_){} }
 finally{busy=false;buttons();}
}
async function connectWith(kind){if(busy||transport)return;closeConnectMenu();lastPort=null;await connectDevice(null,kind);}
$('connect').onclick=()=>connectWith(defaultConnection);
$('connectAlternative').onclick=()=>{if(!$('connectAlternative').disabled)return connectWith(alternativeConnection);};
$('install').onclick=async()=>{
 if(busy)return;
 if(!loader&&lastPort)await connectDevice(lastPort);
 if(!loader)return;
 let variant;
 try{
  variant=selectedFirmware();
  if(variant.chip!==loader.chip.CHIP_NAME)throw Error(`Selected ${variant.chip} firmware, but connected chip is ${loader.chip.CHIP_NAME}. Choose the matching chip profile.`);
  if(!flashMatches(variant,detectedFlashSize))throw Error(`Selected firmware requires ${variant.flash_size_policy==='minimum'?'at least ':''}${variant.flash_size} flash; detected ${detectedFlashSize}.`);
  checkCrystal(variant,loader.detectedCrystal);
 }catch(e){status(e.message||String(e),true);return;}
 busy=true;buttons();$('progress').value=0;
 try{
  const baud=uart?flashingBaudRate(variant):115200;
  if(transport.baudrate!==baud){
   status('Setting flashing speed…');loader.baudrate=baud;await loader.changeBaud();
  }
  // Reject a loader fallback before downloading or writing any firmware.
  if(transport.baudrate!==baud)throw baud===UART_BAUDRATE?new UartSpeedError():Error('Unable to set the UART flashing speed.');
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
  status('Starting installed firmware…');
  const reset=await finishSession(loader,transport,disconnect,log);
  status(`Firmware installed and verified for ${variant.label}. ${reset?'Reset requested.':'Automatic reset could not be confirmed. Release BOOT, then press RESET or unplug and reconnect.'} ${applicationGuidance(variant)}`);
 }catch(e){status(`Installation failed: ${e.message||e} Reconnect in BOOT mode and retry.`,true);try{await disconnect();}catch(_){} }
 finally{busy=false;buttons();}
};
$('disconnect').onclick=async()=>{lastPort=null;busy=true;buttons();try{const reset=loader?await finishSession(loader,transport,disconnect,log):(await disconnect(),false);status(reset?'Disconnected. Reset requested; the installed firmware can now be used.':'Disconnected. Release BOOT, then press RESET or unplug and reconnect to boot the installed firmware.');}catch(e){status(e.message,true);}finally{busy=false;buttons();}};
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
   $('revision').append(option);
  }
  $('version').textContent='Choose a chip profile';
  const unavailable=Object.values(firmware.variants).filter(v=>!v.browser_supported);
  if(unavailable.length){const note=document.createElement('p');note.className='muted';note.textContent=unavailable.map(v=>v.chip).join(', ')+': firmware is available, but the bundled browser flasher does not support this chip yet. Use ESP-IDF/esptool with the firmware artifact.';$('revision').after(note);}
  const requestedBoard=new URLSearchParams(location.search).get('board');
  if(requestedBoard&&firmware.variants[requestedBoard]?.browser_supported){$('revision').value=requestedBoard;$('version').textContent=firmwareDate(firmware.variants[requestedBoard]);}
  updateProfiles();
  status(SerialConnection.supported()&&isSecureContext?'Connect your device first. Matching firmware profiles will be suggested automatically.':'This browser needs WebSerial or WebUSB support. Serve this page over HTTPS or localhost.',!(SerialConnection.supported()&&isSecureContext));
 }catch(e){firmware=null;status(`Cannot load firmware: ${e.message} Check that the firmware folder is deployed alongside this website.`,true);}
 buttons();
}
initialize();
