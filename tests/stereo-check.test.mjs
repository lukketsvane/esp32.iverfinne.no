import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIXED_STEREO_RIG } from '../pointcloud/stereo-rig.mjs';
import { checkFixedPair } from '../local/stereo-check.mjs';

function texture(width,height,seed=123){const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<width*height;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const v=seed>>>24;data.set([v,v,v,255],i*4)}return {data,width,height}}
function pair(cross){
  const width=160,height=120,left=texture(width,height),right=texture(width,height,999);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const ty=y+6,tx=x+cross;if(ty<height&&tx>=0&&tx<width)right.data.set(left.data.subarray((y*width+x)*4,(y*width+x)*4+4),(ty*width+tx)*4)}
  return [left,right];
}
const identity={...FIXED_STEREO_RIG,left:[0,1,0,0,0,1],right:[0,1,0,0,0,1]};

test('the rig check finds how far a remounted camera has drifted from the profile',()=>{
  const aligned=checkFixedPair(...pair(0),{profile:identity,range:8,step:1});
  assert.equal(aligned.best.offset,0);assert.ok(aligned.atProfile>.5);
  for(const [cross,offset] of [[3,-3],[-3,3]]){
    const drifted=checkFixedPair(...pair(cross),{profile:identity,range:8,step:1});
    assert.equal(drifted.atProfile,0,'the profile alone rejects the drifted pair');
    assert.equal(drifted.best.offset,offset);assert.ok(drifted.best.coverage>.5);
    assert.equal(drifted.sweep.length,17);
  }
  const unrelated=checkFixedPair(texture(160,120,5),texture(160,120,77),{profile:identity,range:4,step:2});
  assert.equal(unrelated.best,null,'no shift is reported when nothing matches');assert.equal(unrelated.atProfile,0);
  assert.throws(()=>checkFixedPair(...pair(0),{profile:identity,range:7,step:2}),/søkjeområde/);
});

test('the rig check stays a local tool and the app path still never shifts rows',async()=>{
  const ignore=await readFile(new URL('../.vercelignore',import.meta.url),'utf8'),page=await readFile(new URL('../local/stereo-check.html',import.meta.url),'utf8');
  assert.match(ignore,/^local$/m);
  assert.match(page,/import \{ checkFixedPair \} from '\.\/stereo-check\.mjs'/);
  assert.match(page,/Math\.min\(1, 320 \/ image\.naturalWidth, 240 \/ image\.naturalHeight\)/,'same working size as runStereoDepth');
});
