import test from 'node:test';
import assert from 'node:assert/strict';
import {lockPageZoom} from '../vendor/page-gestures.mjs';
test('page zoom is prevented without stopping artwork pointers or ordinary touches',()=>{
  const handlers=new Map(),settings=new Map(),target={addEventListener(name,fn,options){handlers.set(name,fn);settings.set(name,options)},removeEventListener(name){handlers.delete(name)}};
  const dispose=lockPageZoom(target);
  const event=touches=>({cancelable:true,touches:Array(touches),prevented:false,preventDefault(){this.prevented=true},stopPropagation(){throw new Error('Artwork gesture was blocked')}});
  for(const name of ['gesturestart','gesturechange','gestureend','dblclick']){
    const value=event(2);handlers.get(name)(value);assert.equal(value.prevented,true);assert.equal(settings.get(name).passive,false);
  }
  const one=event(1),two=event(2);handlers.get('touchmove')(one);handlers.get('touchmove')(two);
  assert.equal(one.prevented,false);assert.equal(two.prevented,true);assert.equal(handlers.has('pointermove'),false);
  dispose();assert.equal(handlers.size,0);
});
