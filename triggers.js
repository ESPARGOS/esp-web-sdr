'use strict';
// Snapshot selectors, not hardware triggers or packet decoders.
function rxTrigger(iq,rate,c={mode:'free',threshold:-35}){
 if(c.mode==='free')return {matched:true,kind:'free',sample:0};
 if(!['power','wifi','ble'].includes(c.mode))throw Error('Unknown RX trigger.');
 if(!Number.isFinite(c.threshold)||c.threshold < -120||c.threshold>0)throw Error('Trigger level must be −120…0 dBFS.');
 if(c.mode==='wifi'&&![20000000,40000000,80000000].includes(rate))throw Error('802.11 OFDM detection requires 20, 40 or 80 MS/s.');
 const n=iq.length/2,re=new Float64Array(n),im=new Float64Array(n),power=new Float64Array(n+1);
 let mi=0,mq=0;for(let j=0;j<n;j++){mi+=iq[2*j];mq+=iq[2*j+1];}mi/=n;mq/=n;
 for(let j=0;j<n;j++){re[j]=iq[2*j]-mi;im[j]=iq[2*j+1]-mq;power[j+1]=power[j]+re[j]**2+im[j]**2;}
 const threshold=10**(c.threshold/10),window=Math.max(4,Math.round(rate/1e6));
 const avg=(j,w)=>(power[j+w]-power[j])/w;
 let maxPower=0,first=-1;
 for(let j=0;j+window<=n;j++){const p=avg(j,window);maxPower=Math.max(maxPower,p);if(first<0&&p>=threshold)first=j;}
 const result={matched:false,kind:c.mode,peak_dbfs:10*Math.log10(Math.max(1e-14,maxPower))};
 if(first<0)return result;
 if(c.mode==='power')return {...result,matched:true,sample:first};
 if(c.mode==='wifi'){
  const lag=rate/1250000,w=lag*6,shortLag=lag/4;
  function correlations(delay){const cr=new Float64Array(n+1),ci=new Float64Array(n+1);
   for(let j=0;j+delay<n;j++){cr[j+1]=cr[j]+re[j]*re[j+delay]+im[j]*im[j+delay];ci[j+1]=ci[j]+im[j]*re[j+delay]-re[j]*im[j+delay];}
   return (j)=>{const r=cr[j+w]-cr[j],i=ci[j+w]-ci[j],a=power[j+w]-power[j],b=power[j+delay+w]-power[j+delay];return (r*r+i*i)/Math.max(1e-30,a*b);};
  }
  const periodic=correlations(lag),short=correlations(shortLag);
  for(let j=0;j+w+lag<=n;j+=Math.max(1,lag/4)){
   if(avg(j,w)<threshold)continue;
   const score=periodic(j);
   // Reject CW and narrowly periodic interferers: a tone correlates at both lags.
   if(score>=.8&&short(j)<.65)return {...result,matched:true,sample:j,correlation:score};
  }
  return result;
 }
 // LE 1M advertising: 8-bit alternating preamble then 0x8E89BED6, LSB first.
 // Center-channel quadrature discriminator; fit a constant CFO, then correlate.
 const offset=Number(c.offset_hz||0);if(!Number.isFinite(offset)||Math.abs(offset)>=rate/2)throw Error('Invalid BLE frequency offset.');
 const sps=rate/1e6;if(!Number.isInteger(sps)||sps<4)throw Error('BLE LE 1M detection requires an integer rate of at least 4 MS/s.');
 const pattern=Array.from({length:40},(_,j)=>j<8?(j%2?1:-1):((0x8e89bed6>>>(j-8))&1?1:-1));
 const mean=pattern.reduce((a,b)=>a+b,0)/40,variance=pattern.reduce((a,b)=>a+(b-mean)**2,0);
 const phase=new Float64Array(n+1);
 for(let j=1;j<n;j++)phase[j+1]=phase[j]+Math.atan2(im[j]*re[j-1]-re[j]*im[j-1],re[j]*re[j-1]+im[j]*im[j-1])*rate/(2*Math.PI)-offset;
 const values=new Float64Array(40),step=Math.max(1,Math.floor(sps/4));
 for(let start=1;start+40*sps<=n;start+=step){
  if(avg(start,40*sps)<threshold)continue;
  let sum=0;for(let k=0;k<40;k++){const j=start+k*sps;values[k]=(phase[j+sps]-phase[j])/sps;sum+=values[k];}
  const m=sum/40;let cov=0,v=0;for(let k=0;k<40;k++){cov+=(values[k]-m)*(pattern[k]-mean);v+=(values[k]-m)**2;}
  const deviation=cov/variance,cfo=m-deviation*mean,score=cov*cov/Math.max(1e-20,v*variance);
  if(deviation<150000||deviation>350000||Math.abs(cfo)>150000||score<.85)continue;
  let errors=0;for(let k=0;k<40;k++)if((values[k]>=cfo?1:-1)!==pattern[k])errors++;
  if(errors<=1)return {...result,matched:true,sample:start,correlation:score,bit_errors:errors,cfo_hz:cfo};
 }
 return result;
}
