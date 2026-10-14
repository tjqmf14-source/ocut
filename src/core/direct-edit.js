'use strict';
(function(root){
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function rotate(p,degrees){const a=degrees*Math.PI/180;return {x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a)};}
  function world(p,t,canvas){const q=rotate({x:p.x*t.scaleX*(t.flipX?-1:1),y:p.y*t.scaleY*(t.flipY?-1:1)},t.rotation);return {x:canvas.width/2+t.x+q.x,y:canvas.height/2+t.y+q.y};}
  function local(p,t,canvas){const q=rotate({x:p.x-canvas.width/2-t.x,y:p.y-canvas.height/2-t.y},-t.rotation);return {x:q.x/(t.scaleX*(t.flipX?-1:1)),y:q.y/(t.scaleY*(t.flipY?-1:1))};}
  function handles(b){const x=b.x,y=b.y,w=b.width,h=b.height;return {nw:{x,y},n:{x:x+w/2,y},ne:{x:x+w,y},e:{x:x+w,y:y+h/2},se:{x:x+w,y:y+h},s:{x:x+w/2,y:y+h},sw:{x,y:y+h},w:{x,y:y+h/2}};}
  function contains(p,b,t,canvas){const q=local(p,t,canvas);return q.x>=b.x&&q.x<=b.x+b.width&&q.y>=b.y&&q.y<=b.y+b.height;}
  function resize(t,b,handle,p,canvas,uniform=true,limits={min:.001,max:4}){
    const points=handles(b),opposite={nw:'se',n:'s',ne:'sw',e:'w',se:'nw',s:'n',sw:'ne',w:'e'},anchor=points[opposite[handle]],moving=points[handle];if(!anchor)throw Error('Invalid resize handle');
    const fixed=world(anchor,t,canvas),d=rotate({x:p.x-fixed.x,y:p.y-fixed.y},-t.rotation),dx=moving.x-anchor.x,dy=moving.y-anchor.y;
    let sx=dx?d.x/(dx*(t.flipX?-1:1)):t.scaleX,sy=dy?d.y/(dy*(t.flipY?-1:1)):t.scaleY;
    if(uniform&&dx&&dy){const vx=dx*t.scaleX*(t.flipX?-1:1),vy=dy*t.scaleY*(t.flipY?-1:1),ratio=(d.x*vx+d.y*vy)/(vx*vx+vy*vy),min=Math.max(limits.min/t.scaleX,limits.min/t.scaleY),max=Math.min(limits.max/t.scaleX,limits.max/t.scaleY);sx=t.scaleX*clamp(ratio,min,max);sy=t.scaleY*clamp(ratio,min,max);}
    const next={...t,scaleX:clamp(sx,limits.min,limits.max),scaleY:clamp(sy,limits.min,limits.max)},offset=rotate({x:anchor.x*next.scaleX*(t.flipX?-1:1),y:anchor.y*next.scaleY*(t.flipY?-1:1)},t.rotation);
    next.x=fixed.x-canvas.width/2-offset.x;next.y=fixed.y-canvas.height/2-offset.y;return next;
  }
  const api={clamp,rotate,world,local,handles,contains,resize};if(typeof module!=='undefined')module.exports=api;else root.OcutDirectEdit=api;
})(globalThis);
