import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const js=await readFile(new URL('../app.mjs',import.meta.url),'utf8');

test('all directly referenced element IDs exist in the actual HTML',()=>{
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 const refs=[...js.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
 for(const id of refs)if(!['im','imempty','source-label-','api','upload'].some(prefix=>id===prefix))assert.ok(ids.has(id),'Missing element: '+id);
 assert.ok(ids.has('gallery')&&ids.has('stage')&&ids.has('gallery-target'));
});
test('four fixed square gallery columns remain in all breakpoints',async()=>{
 const css=await readFile(new URL('../style.css',import.meta.url),'utf8');
 assert.match(css,/\.gallery\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/\.tile\{[^}]*aspect-ratio:1;/);
 assert.match(css,/\.tile img\{[^}]*object-fit:cover;/);
 assert.match(css, /overflow-y:auto!important/);
});
test('PWA shell includes worker, algorithms, GIF exporter and styles',async()=>{
 const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
 for(const name of ['app.mjs','style.css','dither-core.mjs','dither.worker.mjs','gif-codec.mjs'])assert.ok(sw.includes(name),name);
});
test('depth-pointer handler modifies only depth and never touches mode',()=>{
 const pointerCode=js.split("let pointer=null;")[1].split("const original=")[0];
 assert.ok(pointerCode.includes('S.depth='));
 assert.ok(!pointerCode.includes('S.mode='));
});
test('real firmware adapter uses the verified routes and methods',()=>{
 assert.match(js,/cameraURL\(i,'capture'\)/);
 assert.match(js,/cameraURL\(i,'status'\)/);
 assert.match(js,/control\?var=photo_framesize&val=/);
 assert.ok(js.includes("await response.blob()"),'capture response must be read as JPEG blob');
});
