import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../radio.js',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const version={status:'known',profile:'esp32c61',revision:'a'.repeat(40),build_date:'2026-10-06',build_timestamp:'2026-10-06T12:00:00Z'};
const manifest=(value={})=>({schema_version:1,variants:{esp32c61:{target:'esp32c61',build_date:'2026-10-06',build_timestamp:'2026-10-06T12:00:00Z',...value}}});
function fixture(){
 const c=vm.createContext({performance,setTimeout,clearTimeout,AbortController});vm.runInContext(source,c);
 const radio=vm.runInContext('radio',c);radio.family='C61';return {c,radio};
}
test('missing VERSION capability or unknown command is outdated without needing a manifest',async()=>{
 const {c,radio:r}=fixture();r.command=async()=>assert.fail('old firmware must not receive an unsupported query');
 await r.negotiateVersion('CAPS GPIO');assert.equal(r.firmwareVersion.status,'missing');
 assert.equal(c.firmwareUpdateStatus(r.firmwareVersion,null).status,'outdated');
 r.command=async()=>{};r.line=async()=> 'ERR command';await r.negotiateVersion('CAPS VERSION');
 assert.equal(r.firmwareVersion.status,'missing');
});
test('version negotiation validates revision, UTC date and device profile without blocking on malformed metadata',async()=>{
 const {radio:r}=fixture(),commands=[];r.command=async s=>commands.push(s);r.line=async()=> 'VERSION '+JSON.stringify(version);
 await r.negotiateVersion('CAPS VERSION');assert.equal(r.firmwareVersion.status,'known');assert.deepEqual(commands,['VERSION?']);
 for(const patch of [{revision:'bad'},{profile:'esp32s31-stream'},{build_timestamp:'2026-02-30T12:00:00Z'},{build_date:'2026-10-05'}]){
  r.line=async()=> 'VERSION '+JSON.stringify({...version,...patch});await r.negotiateVersion('CAPS VERSION');assert.equal(r.firmwareVersion.status,'unknown');
 }
 r.line=async()=> 'VERSION not json';await r.negotiateVersion('CAPS VERSION');assert.equal(r.firmwareVersion.status,'unknown');
});
test('timestamps compare same-day builds, equal/newer builds do not warn, hashes do not determine age',()=>{
 const {c}=fixture();
 for(const [stamp,status] of [['2026-10-06T12:00:01Z','outdated'],['2026-10-06T12:00:00Z','current'],['2026-10-05T23:59:59Z','current']])
  assert.equal(c.firmwareUpdateStatus(version,manifest({build_timestamp:stamp,git_revision:'b'.repeat(40)})).status,status);
 assert.equal(c.firmwareUpdateStatus({...version,revision:'a'.repeat(40)+'-dirty'},manifest()).status,'current');
});
test('legacy date-only manifests compare at date resolution and profiles stay independent',()=>{
 const {c}=fixture();const m=manifest();delete m.variants.esp32c61.build_timestamp;
 assert.equal(c.firmwareUpdateStatus(version,m).status,'current');m.variants.esp32c61.build_date='2026-10-07';
 assert.equal(c.firmwareUpdateStatus(version,m).status,'outdated');
 delete m.variants.esp32c61;m.variants['esp32s31-stream']={target:'esp32s31',build_timestamp:'2030-01-01T00:00:00Z'};
 assert.equal(c.firmwareUpdateStatus(version,m).status,'unknown');
 for(const date of ['2026-02-30','nonsense','2026-10-06T25:00:00Z'])assert.equal(c.firmwareUpdateStatus(version,manifest({build_timestamp:date})).status,'unknown');
});
function uiFixture(){
 const {c,radio}=fixture(),elements=new Map();radio.firmwareVersion={...version};
 Object.assign(c,{radio,connected:true,firmwareCheck:0,firmwareUpdate:null,$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}});
 vm.runInContext(app.slice(app.indexOf('let dismissedFirmwareVersion='),app.indexOf('function updateGpioControls(){')),c);
 return {c,radio,elements};
}
test('UI warns for legacy firmware even offline, and links directly to the firmware installer',async()=>{
 const {c,radio,elements}=uiFixture();radio.firmwareVersion={status:'missing'};c.fetch=()=>assert.fail('unnecessary request');
 await c.checkFirmwareUpdate();assert.equal(elements.get('firmwareWarning').hidden,false);
 assert.match(elements.get('firmwareWarningText').textContent,/does not report its version/);
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/id="firmwareWarning"[^]*?href="flash.html"/);
 c.connected=false;c.firmwareWarning();assert.equal(elements.get('firmwareWarning').hidden,true);
});
test('UI fetch is uncached, handles unavailable catalogs and discards late replies for old connections',async()=>{
 const {c,radio,elements}=uiFixture();let resolve;
 c.fetch=async(url,options)=>{assert.equal(url,'firmware/manifest.json');assert.equal(options.cache,'no-store');return new Promise(r=>{resolve=r;});};
 const first=c.checkFirmwareUpdate();radio.firmwareVersion={...version,build_timestamp:'2026-10-06T13:00:00Z'};
 resolve({ok:true,json:async()=>manifest({build_timestamp:'2026-10-07T00:00:00Z'})});await first;
 assert.equal(c.firmwareUpdate,null);
 c.fetch=async()=>{throw Error('offline');};await c.checkFirmwareUpdate();assert.equal(elements.get('firmwareWarning').hidden,true);
 c.fetch=async()=>({ok:true,json:async()=>manifest({build_timestamp:'2026-10-07T00:00:00Z'})});await c.checkFirmwareUpdate();
 assert.equal(elements.get('firmwareWarning').hidden,false);assert.match(elements.get('deviceModel').title,/aaaaaaaa/);
});

test('firmware warnings stay dismissed during refreshes and return for a new connection',async()=>{
 const {c,radio,elements}=uiFixture();radio.firmwareVersion={status:'missing'};
 await c.checkFirmwareUpdate();assert.equal(elements.get('firmwareWarning').hidden,false);
 elements.get('dismissFirmwareWarning').onclick();c.firmwareWarning();
 await c.checkFirmwareUpdate();assert.equal(elements.get('firmwareWarning').hidden,true);
 radio.firmwareVersion={status:'missing'};c.firmwareWarning();
 assert.equal(elements.get('firmwareWarning').hidden,false);
 elements.get('dismissFirmwareWarning').onclick();
 c.connected=false;c.firmwareWarning();c.connected=true;c.firmwareWarning();
 assert.equal(elements.get('firmwareWarning').hidden,false);
});

test('a pending catalog response does not reopen a dismissed firmware warning',async()=>{
 const {c,elements}=uiFixture();let reply;
 c.firmwareUpdate={status:'outdated',message:'Update available'};c.firmwareWarning();
 elements.get('dismissFirmwareWarning').onclick();
 c.fetch=()=>new Promise(resolve=>{reply=resolve;});
 const pending=c.checkFirmwareUpdate();
 reply({ok:true,json:async()=>manifest({build_timestamp:'2026-10-07T00:00:00Z'})});
 await pending;assert.equal(elements.get('firmwareWarning').hidden,true);
});

function handoffFixture({blocked=false,fail=false}={}){
 const events=[],elements=new Map();let release,timer;
 const $=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 const tab={opener:{},location:{replace:url=>events.push(['navigate',url])},close:()=>events.push('close tab')};
 const c=vm.createContext({$,connected:true,connectionBusy:false,firmwareHandoff:false,
  radio:{port:{},closePort:async()=>{events.push('force close');c.radio.port=null;release();}},
  window:{open:()=>{events.push('open blank');return blocked?null:tab;},location:{assign:url=>events.push(['navigate same tab',url])}},
  closeConnectMenu(){},state(){},error:e=>events.push(['error',e.message||e]),
  setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;},
  choosePort:async()=>{events.push('choose port');return null;},
  api:async path=>{assert.equal(path,'disconnect');assert.equal(c.connected,false);events.push('disconnect');
   if(fail)throw Error('Cannot release device');
   await new Promise(resolve=>{release=resolve;});c.radio.port=null;events.push('released');
  }
 });
 vm.runInContext(app.slice(app.indexOf('async function disconnectRadio(){'),app.indexOf("$('pause').onclick=")),c);
 vm.runInContext(app.slice(app.indexOf("$('openFlasher').onclick="),app.indexOf("$('connectMenu').onkeydown=")),c);
 const click=()=>({preventDefault(){events.push('prevent navigation');},currentTarget:{href:'https://example.test/espsdr/app/flash.html'}});
 return {c,$,events,tab,click,release:()=>release(),timeout:()=>timer()};
}
for(const link of ['updateFirmware','openFlasher'])test(`${link} releases the port before navigating and prevents automatic reconnect`,async()=>{
 const f=handoffFixture(),pending=f.$(link).onclick(f.click());
 assert.deepEqual(f.events,['prevent navigation','open blank','disconnect']);
 assert.equal(f.tab.opener,null);assert.equal(f.c.connectionBusy,true);
 f.release();await pending;
 assert.deepEqual(f.events.slice(-2),['released',['navigate','https://example.test/espsdr/app/flash.html']]);
 assert.equal(f.c.connectionBusy,false);assert.equal(f.c.radio.port,null);
 await f.$('connect').onclick({auto:true});assert.equal(f.events.includes('choose port'),false);
 await f.$('connect').onclick();assert.equal(f.events.includes('choose port'),true);assert.equal(f.c.firmwareHandoff,false);
});
test('blocked popups fall back to the current tab only after releasing USB',async()=>{
 const f=handoffFixture({blocked:true}),pending=f.$('updateFirmware').onclick(f.click());
 assert.equal(f.events.some(e=>Array.isArray(e)),false);
 f.release();await pending;
 assert.deepEqual(f.events.slice(-2),['released',['navigate same tab','https://example.test/espsdr/app/flash.html']]);
});
test('stalled disconnect forces port closure before opening the installer',async()=>{
 const f=handoffFixture(),pending=f.$('updateFirmware').onclick(f.click());
 f.timeout();await pending;
 assert.deepEqual(f.events.slice(-3),['force close','released',['navigate','https://example.test/espsdr/app/flash.html']]);
});
test('failed or busy device operations do not open the installer against an occupied port',async()=>{
 const f=handoffFixture({fail:true});await f.$('updateFirmware').onclick(f.click());
 assert.equal(f.events.includes('close tab'),true);assert.equal(f.c.connectionBusy,false);assert.equal(f.c.firmwareHandoff,false);
 assert.equal(f.events.some(e=>Array.isArray(e)&&e[0].startsWith('navigate')),false);
 const busy=handoffFixture();busy.c.radio.changingBaud=true;
 await busy.$('updateFirmware').onclick(busy.click());assert.equal(busy.events.includes('open blank'),false);
});
