import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationGuidance,flashingBaudRate} from '../flasher/catalog.mjs';
test('S31 streaming installation directs users to Soapy and device web controls',()=>{
 const text=applicationGuidance({target:'esp32s31',application:'soapysdr'});
 assert.match(text,/SoapyESPSDR/);assert.match(text,/device IP/);assert.match(text,/does not connect/);
});
test('S31 burst installation still directs users to the serial viewer',()=>{
 assert.equal(applicationGuidance({target:'esp32s31'}),'Open ESP-WebSDR and connect to the device.');
});

test('streaming recovery UART uses its validated flashing speed',()=>{
 assert.equal(flashingBaudRate({application:'soapysdr'}),115200);
 assert.equal(flashingBaudRate({target:'esp32s31'}),2000000);
});
