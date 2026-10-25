import test from 'node:test';
import assert from 'node:assert/strict';
import {attachAdjustmentGestures} from '../vendor/adjustment-gestures.mjs';
import {normalizeAdjustments} from '../vendor/image-adjustments.mjs';

function harness({settings={},enabled=true,onClaim=()=>{}}={}){
  const listeners=new Map(),captures=new Set(),patches=[];let levels=normalizeAdjustments(settings),claims=0,dithers=0,resets=0,gestures=0;
  const root={getBoundingClientRect:()=>({left:0,top:0,width:390,height:844}),closest:()=>null,
    addEventListener(name,fn){listeners.set(name,fn)},removeEventListener(name){listeners.delete(name)},
    setPointerCapture(id){captures.add(id)},hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id)}};
  const controls=attachAdjustmentGestures(root,{enabled:()=>enabled,read:()=>levels,onChange(patch){patches.push(patch);levels=normalizeAdjustments({...levels,...patch})},onClaim(){claims++;onClaim()},onGesture(){gestures++},onDither(){dithers++},onReset(){resets++}});
  function emit(type,id,x,y,extra={}){const event={target:root,pointerType:'touch',pointerId:id,clientX:x,clientY:y,prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...extra};listeners.get(type)?.(event);return event}
  const places=x=>[[x-45,350],[x-15,350],[x+15,350],[x+45,350]];
  function down(count=4,x=195){const positions=places(x);for(let n=0;n<count;n++)emit('pointerdown',n+1,...positions[n]);return positions}
  function move(positions,dx,dy){for(let n=0;n<positions.length;n++)emit('pointermove',n+1,positions[n][0]+dx,positions[n][1]+dy)}
  function up(positions){for(let n=0;n<positions.length;n++)emit('pointerup',n+1,...positions[n])}
  return {emit,down,move,up,root,controls,captures,patches,get levels(){return levels},get claims(){return claims},get dithers(){return dithers},get resets(){return resets},get gestures(){return gestures},set enabled(value){enabled=value},get listenerCount(){return listeners.size}};
}

test('one and two fingers pass through for capture, pinch and twist without changing settings',()=>{
  const app=harness();
  for(const [type,id,x,y]of [['pointerdown',1,100,300],['pointerdown',2,200,300],['pointermove',2,250,350],['pointerup',2,250,350],['pointerup',1,100,300]]){
    const event=app.emit(type,id,x,y);assert.equal(event.prevented,false);assert.equal(event.stopped,false);
  }
  assert.equal(app.claims,0);assert.equal(app.dithers,0);assert.equal(app.resets,0);assert.equal(app.patches.length,0);
});

test('a stationary three-finger tap cycles dither exactly once and leaves child releases intact',()=>{
  const app=harness(),positions=app.down(3).slice(0,3);
  for(let n=0;n<3;n++){const event=app.emit('pointerup',n+1,...positions[n]);assert.equal(event.stopped,false);assert.equal(app.dithers,n===2?1:0)}
  assert.equal(app.resets,0);assert.equal(app.claims,0);assert.ok(app.gestures>=2);
});

test('moving three fingers, cancellation and losing capture cannot become a dither tap',()=>{
  for(const kind of ['move','cancel','lost']){
    const app=harness(),positions=app.down(3).slice(0,3);
    if(kind==='move')app.move(positions,40,0);
    else app.emit(kind==='cancel'?'pointercancel':'lostpointercapture',1,...positions[0]);
    app.up(positions);assert.equal(app.dithers,0,kind);assert.equal(app.patches.length,0,kind);
  }
});

test('four fingers claim the gesture once and consume the remaining fingers until release',()=>{
  const app=harness(),positions=app.down();assert.equal(app.claims,1);assert.equal(app.captures.size,4);
  app.emit('pointermove',1,positions[0][0],450);
  assert.equal(app.emit('pointerup',1,positions[0][0],450).stopped,true);
  const before=app.patches.length;assert.equal(app.emit('pointermove',2,positions[1][0],500).stopped,true);assert.equal(app.patches.length,before);
  for(let id=2;id<=4;id++)app.emit('pointerup',id,positions[id-1][0],500);
  assert.equal(app.captures.size,0);assert.equal(app.dithers,0);assert.equal(app.resets,0);
});

test('four-finger vertical drags adjust black, midtones or white from the initial horizontal region',()=>{
  for(const [x,key]of [[90,'black'],[195,'gamma'],[300,'white']]){
    const app=harness({settings:{black:30,white:220,gamma:1}}),positions=app.down(4,x),before={...app.levels};
    app.move(positions,0,-80);assert.ok(app.levels[key]>before[key],key);
    for(const name of Object.keys(before))if(name!==key)assert.equal(app.levels[name],before[name],key+' preserves '+name);
    app.move(positions,0,1000);assert.ok(app.levels.black>=0&&app.levels.white>app.levels.black&&app.levels.white<=255&&app.levels.gamma>=.2&&app.levels.gamma<=3);
  }
});

test('four-finger horizontal movement locks contrast and spreading adjusts only dither strength',()=>{
  const app=harness(),positions=app.down();app.move(positions,80,0);assert.ok(app.levels.contrast>1);const contrast=app.levels.contrast;
  app.move(positions,80,-100);assert.equal(app.levels.gamma,1);assert.equal(app.levels.contrast,contrast);
  const spread=harness({settings:{strength:.4}}),p=spread.down();
  spread.emit('pointermove',1,p[0][0]-80,p[0][1]);spread.emit('pointermove',4,p[3][0]+80,p[3][1]);
  assert.ok(spread.levels.strength>.4);assert.equal(spread.levels.contrast,1);assert.equal(spread.levels.gamma,1);
});

test('four-finger taps reset tone without firing dither, and movement never resets on release',()=>{
  const app=harness(),positions=app.down();app.up(positions);assert.equal(app.resets,1);assert.equal(app.dithers,0);assert.equal(app.captures.size,0);
  const moved=harness(),p=moved.down();moved.move(p,0,80);moved.up(p);assert.equal(moved.resets,0);assert.equal(moved.dithers,0);
});

test('holding still cannot become a dither cycle or reset after a long gesture',context=>{
  let now=1000;context.mock.method(performance,'now',()=>now);
  for(const count of [3,4]){const app=harness(),positions=app.down(count).slice(0,count);now+=800;app.up(positions);assert.equal(app.dithers,0);assert.equal(app.resets,0)}
});

test('a fourth finger can release and return without jumping levels; five fingers are ignored',()=>{
  const app=harness(),p=app.down();app.move(p,0,-60);const first=app.levels.gamma;
  app.emit('pointerup',4,p[3][0],p[3][1]-60);app.emit('pointerdown',4,p[3][0],p[3][1]-60);app.emit('pointermove',4,p[3][0],p[3][1]-60);assert.equal(app.levels.gamma,first);
  app.emit('pointerdown',5,200,450);app.emit('pointermove',5,200,100);assert.equal(app.levels.gamma,first);app.controls.cancel();assert.equal(app.captures.size,0);
});

test('disabled, auxiliary and mouse input do not alter tones; disposal releases all captured pointers',()=>{
  for(const extra of [{pointerType:'mouse'},{target:{closest:()=>({})}}]){
    const app=harness();for(let id=1;id<=4;id++)app.emit('pointerdown',id,150+id*20,300,extra);assert.equal(app.claims,0);
  }
  const app=harness();const p=app.down();app.enabled=false;app.move(p,0,80);assert.equal(app.captures.size,0);assert.equal(app.patches.length,0);app.up(p);assert.equal(app.resets,0);
  app.enabled=true;app.down();app.controls.dispose();assert.equal(app.captures.size,0);assert.equal(app.listenerCount,0);app.controls.dispose();
});

test('normal controls never join image gestures while the capture plane remains interactive',()=>{
  for(const selector of ['button','a','input','select','textarea','[contenteditable]','[data-photo-save]','.access-control','.studio-option']){
    const app=harness(),events=[],target={closest:selectors=>selectors.split(',').includes(selector)?target:null};
    for(const [type,y]of [['pointerdown',300],['pointermove',400],['pointerup',400]])for(let id=1;id<=4;id++)events.push(app.emit(type,id,150+id*20,y,{target}));
    assert.equal(events.some(event=>event.stopped||event.prevented),false,selector);
    assert.equal(app.claims,0,selector);assert.equal(app.dithers,0,selector);assert.equal(app.resets,0,selector);assert.equal(app.patches.length,0,selector);
    app.controls.dispose();
  }
  const app=harness(),target={closest:selectors=>selectors.split(',').some(selector=>selector==='button'||selector==='#capture-plane')?target:null};
  for(let id=1;id<=4;id++)app.emit('pointerdown',id,150+id*20,300,{target});
  assert.equal(app.claims,1);assert.equal(app.captures.size,4);
  app.controls.dispose();
});
