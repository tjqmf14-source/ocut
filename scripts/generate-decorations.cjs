'use strict';
// Original geometric decorations, no downloaded stock assets or external libraries.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const size=512,dir=path.resolve(__dirname,'../src/assets');fs.mkdirSync(dir,{recursive:true});
function crc(b){let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,b){const t=Buffer.from(type),r=Buffer.alloc(b.length+12);r.writeUInt32BE(b.length);t.copy(r,4);b.copy(r,8);r.writeUInt32BE(crc(Buffer.concat([t,b])),b.length+8);return r;}
const circle=(x,y,cx,cy,r)=>Math.hypot(x-cx,y-cy)<r;
function pixel(id,x,y){
 if(id==='moon')return circle(x,y,248,256,160)&&!circle(x,y,322,194,152)?[239,225,183,255]:[0,0,0,0];
 if(id==='stars'){for(const [cx,cy,r] of [[160,176,77],[350,325,94],[355,125,35],[150,370,27]])if(Math.abs(x-cx)/r+Math.abs(y-cy)/r<1&&Math.abs((x-cx)*(y-cy))<r*r*.1)return [237,230,194,255];return [0,0,0,0];}
 if(id==='vinyl'){const d=Math.hypot(x-256,y-256);if(d>202||d<10)return [0,0,0,0];if(d<60)return [180,207,184,255];const groove=Math.floor(d)%12<2?57:33;return [groove,groove+4,groove+8,255];}
 if(id==='window'){const inside=x>64&&x<448&&y>40&&y<472,border=x<75||x>437||y<51||y>461||Math.abs(x-256)<5||Math.abs(y-256)<5;return inside&&border?[220,228,214,240]:[0,0,0,0];}
}
for(const id of ['moon','stars','vinyl','window']){const raw=Buffer.alloc(size*(size*4+1));for(let y=0;y<size;y++)for(let x=0;x<size;x++)Buffer.from(pixel(id,x+.5,y+.5)).copy(raw,y*(size*4+1)+1+x*4);const h=Buffer.alloc(13);h.writeUInt32BE(size);h.writeUInt32BE(size,4);h[8]=8;h[9]=6;fs.writeFileSync(path.join(dir,id+'.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
console.log('Generated four original transparent PNG decorations');
