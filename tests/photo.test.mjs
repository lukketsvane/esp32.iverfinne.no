import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudPrintJob } from '../vendor/print/cloud-raster.mjs';
import { buildPrintJob, WIDTH } from '../vendor/print/px10-protocol.mjs';

test('photo printing keeps white paper white and black photo pixels black',()=>{
  const white=new Uint8ClampedArray(WIDTH*2*4).fill(255),black=white.slice();
  for(let i=0;i<black.length;i+=4)black[i]=black[i+1]=black[i+2]=0;
  assert.deepEqual(cloudPrintJob({data:white,width:WIDTH,height:2,photo:true}),buildPrintJob(new Uint8Array(WIDTH*2)));
  assert.deepEqual(cloudPrintJob({data:black,width:WIDTH,height:2,photo:true}),buildPrintJob(new Uint8Array(WIDTH*2).fill(1)));
  assert.throws(()=>cloudPrintJob({data:black,width:WIDTH,height:2}),/ingen synlege punkt/);
});
