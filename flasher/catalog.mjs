// Firmware paths are relative to the manifest, so a CI artifact can be served unchanged.
export function validateManifest(manifest) {
 if(manifest?.schema_version!==1||!manifest.variants||Array.isArray(manifest.variants)||typeof manifest.variants!=='object'||!Object.keys(manifest.variants).length)throw Error('Invalid or empty firmware catalog.');
 for(const [id,v] of Object.entries(manifest.variants)){
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)||!v||typeof v!=='object')throw Error('Invalid firmware profile.');
  if(!['label','chip','target','version'].every(key=>typeof v[key]==='string'&&v[key].length))throw Error('Incomplete firmware profile.');
  if(!/^esp32[a-z0-9]*$/.test(v.target)||v.chip!=='ESP32'+(v.target.slice(5)?'-'+v.target.slice(5).toUpperCase():''))throw Error('Firmware chip and target do not match.');
  const size=/^(\d+)MB$/.exec(v.flash_size);
  if(!size||+size[1]<=0||!['exact','minimum'].includes(v.flash_size_policy??'exact')||!Array.isArray(v.parts)||!v.parts.length)throw Error('Invalid flash layout.');
  const names=new Set();let end=0;
  for(const part of [...v.parts].sort((a,b)=>a.offset-b.offset)){
   if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.bin$/.test(part.name)||names.has(part.name))throw Error('Invalid firmware filename.');
   names.add(part.name);
   if(!Number.isSafeInteger(part.offset)||!Number.isSafeInteger(part.size)||part.size<=0||part.offset<end||part.offset+part.size>+size[1]*1024*1024)throw Error('Overlapping or out-of-flash image.');
   if(!/^[a-f0-9]{64}$/.test(part.sha256)||!/^[a-f0-9]{32}$/.test(part.md5))throw Error('Invalid firmware checksum.');
   end=part.offset+part.size;
  }
 }
 return manifest;
}

export async function loadManifest(url) {
 const response=await fetch(url,{cache:'no-store'});
 if(!response.ok)throw Error(`Firmware catalog request failed (${response.status}).`);
 return validateManifest(await response.json());
}

export async function checkedImages(variant, profile, manifestUrl) {
 const files=[];
 for(const part of variant.parts){
  const url=new URL(`${profile}/${part.name}`,manifestUrl);
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw Error(`Cannot download ${part.name} (${response.status}).`);
  const data=new Uint8Array(await response.arrayBuffer());
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  if(data.length!==part.size||digest!==part.sha256)throw Error(`Firmware integrity check failed for ${part.name}. Reload the page and retry.`);
  files.push({address:part.offset,data});
 }
 return files;
}


// Missing dates on older artifacts must not expose internal release labels.
export function firmwareDate(variant) {
 const value=variant?.build_date;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return 'Unavailable';
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:'Unavailable';
}
