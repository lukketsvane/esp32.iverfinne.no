import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const pages=[
  ['iPhone PWA',new URL('../index.html',import.meta.url)],
  ['ESP32 camera',new URL('../device/EntropiCamera/camera_ui.html',import.meta.url)]
];

for(const [name,url] of pages){
  test(name+' never mixes a visible icon with text in a button',async()=>{
    const html=await readFile(url,'utf8');
    for(const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
      const [markup,attributes,body]=match;
      if(!body.includes('<svg'))continue;
      const visible=body
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g,'')
        .replace(/<(span|small)\b[^>]*class="[^"]*\bsr(?:-only)?\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g,'')
        .replace(/<[^>]*>/g,'')
        .trim();
      assert.equal(visible,'','Icon and visible text combined: '+markup.slice(0,120));
      assert.match(attributes,/\baria-label="/,'Icon-only button lacks accessible name: '+markup.slice(0,120));
    }
  });
}

test('camera chrome omits decorative headings and duplicate mode labels',async()=>{
  const camera=await readFile(pages[1][1],'utf8');
  const pwa=await readFile(pages[0][1],'utf8');
  assert.doesNotMatch(camera,/class="(?:rig-title|rig-subtitle|rig-link|rig-frame-label|peer-frame-label|rig-footnote|rig-tool-label|review-label|review-tabs|setup-meta)"/);
  assert.doesNotMatch(pwa,/PHONE CAMERA \/ A1|<strong>ENTROPI<\/strong>/);
});
