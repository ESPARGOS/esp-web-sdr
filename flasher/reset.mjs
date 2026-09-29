// Espressif esptool targets/esp32c3.py, esp32c6.py and esp32c61.py:
// C61 uses the C3 watchdog sequence with the LP_WDT register block.
// Do not use the C3 registers inherited by esptool-js 0.7.0 for C61.
const watchdogs={
 'ESP32-C3':{config:0x60008090,timeout:0x60008094,protect:0x600080a8},
 'ESP32-C61':{config:0x600b1c00,timeout:0x600b1c04,protect:0x600b1c18}
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function resetToFirmware(loader,transport){
 const info=transport.device.getInfo();
 const native=info.usbVendorId===0x303a;
 const watchdog=native&&info.usbProductId===0x1001&&watchdogs[loader.chip.CHIP_NAME];
 if(watchdog){
  await loader.writeReg(watchdog.protect,0x50d83aa1);
  await loader.writeReg(watchdog.timeout,2000);
  await loader.writeReg(watchdog.config,0xd0000102);
  await loader.writeReg(watchdog.protect,0);
  await sleep(500);
 }else{
  // The bundled HardReset only releases RTS; assert it first to pulse reset.
  // Keep DTR deasserted so the chip boots the application, not the downloader.
  await transport.setDTR(false);
  await transport.setRTS(true);
  try{await sleep(native?200:100);}
  finally{await transport.setRTS(false);}
  if(native)await sleep(200);
 }
}

// A reset/USB re-enumeration error must not turn a verified write into a
// reported installation failure. Always release the port for the viewer.
export async function finishSession(loader,transport,disconnect,log){
 let reset=false;
 try{await resetToFirmware(loader,transport);reset=true;}
 catch(e){log(`Automatic reset could not be confirmed: ${e.message||e}\n`);}
 try{await disconnect();}
 catch(e){log(`Port close after reset: ${e.message||e}\n`);reset=false;}
 return reset;
}
