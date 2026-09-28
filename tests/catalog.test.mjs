import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {validateManifest,loadManifest,checkedImages} from '../flasher/catalog.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const data=new TextEncoder().encode('test firmware');
function manifest(){return {schema_version:1,version:'test',variants:{esp32s3:{label:'ESP32-S3',chip:'ESP32-S3',target:'esp32s3',version:'test',flash_size:'2MB',parts:[{name:'app.bin',offset:65536,size:data.length,sha256:createHash('sha256').update(data).digest('hex'),md5:createHash('md5').update(data).digest('hex')}]}}};}

test('accepts supplied profiles without a hard-coded firmware target list',()=>{
 const m=manifest();m.variants.future={...m.variants.esp32s3,chip:'ESP32-C99',target:'esp32c99'};
 assert.equal(Object.keys(validateManifest(m).variants).length,2);
});
test('rejects empty or malformed catalogs',()=>{
 for(const m of [{schema_version:1,variants:{}},{schema_version:2,variants:{}},null])assert.throws(()=>validateManifest(m));
});
test('rejects unsafe filenames, mismatched chips, overlaps and invalid checksums',()=>{
 for(const edit of [v=>v.parts[0].name='../app.bin',v=>v.chip='ESP32-C5',v=>v.parts[0].offset=-1,v=>v.parts[0].size=3000000,v=>v.parts.push({...v.parts[0]}),v=>v.parts[0].sha256='bad']){
  const m=manifest();edit(m.variants.esp32s3);assert.throws(()=>validateManifest(m));
 }
});
test('manifest loads on demand; HTTP failures do not fall back to bundled data',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(manifest())));
 assert.equal((await loadManifest('https://example.test/firmware/manifest.json')).variants.esp32s3.chip,'ESP32-S3');
 globalThis.fetch=async()=>new Response('',{status:404});
 await assert.rejects(loadManifest('https://example.test/firmware/manifest.json'),/404/);
});
test('downloads selected images relative to the manifest and verifies them',async t=>{
 const urls=[];t.mock.method(globalThis,'fetch',async(url)=>{urls.push(String(url));return new Response(data);});
 const files=await checkedImages(manifest().variants.esp32s3,'esp32s3','https://example.test/site/firmware/manifest.json');
 assert.deepEqual(urls,['https://example.test/site/firmware/esp32s3/app.bin']);
 assert.equal(files[0].address,65536);assert.deepEqual(files[0].data,data);
});
test('corrupt or missing images fail before they are handed to the writer',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('corrupt'));
 await assert.rejects(checkedImages(manifest().variants.esp32s3,'esp32s3','https://example.test/firmware/manifest.json'),/integrity/);
 globalThis.fetch=async()=>new Response('',{status:404});
 await assert.rejects(checkedImages(manifest().variants.esp32s3,'esp32s3','https://example.test/firmware/manifest.json'),/404/);
});
test('browser capability metadata matches the vendored loader',async()=>{
 const bundle=await readFile(new URL('../flasher/vendor/esptool-js-0.7.0.js',import.meta.url),'utf8');
 const actual=[...new Set([...bundle.matchAll(/CHIP_NAME\s*=\s*["']([^"']+)/g)].map(m=>m[1]))].sort();
 const declared=JSON.parse(await readFile(new URL('../flasher/vendor/esptool-js-0.7.0-chips.json',import.meta.url),'utf8'));
 assert.deepEqual(declared,actual);
});
