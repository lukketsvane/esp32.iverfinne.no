import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractPalette} from '../palette-extract.mjs';
const app=await readFile(new URL('../app.mjs',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');

test('median-cut palette gives distinct sorted colors without external dependencies',()=>{
 const data=new Uint8ClampedArray(80*40*4);
 const colors=[[230,20,20],[20,230,20],[20,20,230],[245,245,245]];
 for(let y=0;y<40;y++)for(let x=0;x<80;x++){
  const i=(y*80+x)*4;data.set([...colors[Math.floor(x/20)],255],i);
 }
 const first=extractPalette(data,80,40,4);
 assert.equal(first.length,4);
 assert.deepEqual(first,extractPalette(data,80,40,4));
 assert.ok(first.every(c=>/^#[a-f0-9]{6}$/.test(c)));
 assert.ok(first.some(c=>parseInt(c.slice(1,3),16)>180&&parseInt(c.slice(3,5),16)<60));
});
test('palette safely handles transparency, monochrome and invalid dimensions',()=>{
 const transparent=new Uint8ClampedArray(4*4*4);
 assert.deepEqual(extractPalette(transparent,4,4,8),['#111111','#eeeeee']);
 transparent.fill(0);for(let i=0;i<transparent.length;i+=4){transparent[i]=80;transparent[i+1]=80;transparent[i+2]=80;transparent[i+3]=255}
 assert.equal(extractPalette(transparent,4,4,8).length,2);
 assert.throws(()=>extractPalette(transparent,4,5,8));
 assert.throws(()=>extractPalette(transparent,4,4,99));
});
test('diagnostic sweep verifies sensor before capture and restores resolution',()=>{
 const code=app.split('async function runResolutionDiagnostic(i)')[1].split('async function loadRemote')[0];
 assert.ok(code.indexOf('if(!state.camera_ready)')<code.indexOf('for(const size of sizes)'));
 assert.ok(code.includes('if(!state.camera_ready)'));
 assert.ok(code.includes('state.psram?[6,10,15]:[6]'));
 assert.ok(code.includes('photo_framesize&val=${original}'));
 assert.ok(code.includes('JPEG verifisert'));
 assert.ok(code.includes('finally'));
});
test('network failure is not mistaken for physical sensor error',()=>{
 assert.ok(app.includes("c.online=null;c.networkFailed=true"));
 assert.ok(app.includes("'INGEN KONTAKT'")&&app.includes("'SENSORFEIL'"));
 assert.ok(app.includes('Begge kort har same adresse'));
});
test('mobile touch drag distinguishes vertical scrolling from depth adjustment',()=>{
 const gesture=app.split('let pointer=null;')[1].split('const original=')[0];
 assert.ok(gesture.includes('Math.abs(dy)>8'));
 assert.ok(gesture.includes('pointer=null;return'));
 assert.ok(gesture.indexOf('Math.abs(dx)<8')<gesture.indexOf('S.depth='));
 assert.ok(!gesture.includes('S.mode='));
});
test('Safari thumbnail fallback is present and PWA caches all required modules',()=>{
 assert.ok(app.includes("typeof createImageBitmap==='function'"));
 assert.ok(app.includes('img=new Image()'));
 assert.ok(app.includes('URL.revokeObjectURL(objectURL)'));
 assert.ok(sw.includes('palette-extract.mjs'));
 assert.ok(html.includes('data-extract-palette="16"'));
});
