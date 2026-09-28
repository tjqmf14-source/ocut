'use strict';
const {randomUUID}=require('node:crypto');
const VERSION=1;
const TRACK_TYPES=['video','image','audio','music','subtitle','text','overlay','effect'];
const MEDIA_TYPES=['video','image','audio'];
const FPS=[24,25,30,50,60];
const fail=message=>{throw new Error(`Invalid O-CUT project: ${message}`);};
const object=(v,label)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail(label+' must be an object');};
const text=(v,label,max=4096)=>{if(typeof v!=='string'||!v.length||v.length>max||v.includes('\0'))fail(label+' must be a nonempty string');};
const number=(v,label,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isFinite(v)||v<min||v>max)fail(label+' is out of range');};
const keys=(v,allowed,label)=>{object(v,label);for(const k of Object.keys(v))if(!allowed.includes(k))fail(label+'.'+k+' is unsupported');};
const array=(v,label,max)=>{if(!Array.isArray(v)||v.length>max)fail(label+' must be a bounded array');};
function jsonValue(v,depth=0){
  if(depth>32)fail('maximum nesting exceeded');
  if(v===null||typeof v==='boolean'||typeof v==='string')return;
  if(typeof v==='number'){if(!Number.isFinite(v))fail('nonfinite JSON number');return;}
  if(Array.isArray(v)){for(const x of v)jsonValue(x,depth+1);return;}
  object(v,'JSON value');
  for(const [k,x] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail('unsafe property');jsonValue(x,depth+1);}
}
function validateProject(p){
  jsonValue(p);
  keys(p,['format','version','id','name','createdAt','modifiedAt','revision','canvas','media','tracks','clips','exportSettings'],'project');
  if(p.format!=='O-CUT'||p.version!==VERSION)fail('unsupported format/version');
  text(p.id,'id',128);text(p.name,'name',200);
  for(const field of ['createdAt','modifiedAt'])if(typeof p[field]!=='string'||!Number.isFinite(Date.parse(p[field])))fail(field);
  number(p.revision,'revision');if(!Number.isSafeInteger(p.revision))fail('revision must be integer');
  keys(p.canvas,['width','height','fps','background'],'canvas');
  for(const k of ['width','height']){number(p.canvas[k],k,2,8192);if(!Number.isInteger(p.canvas[k])||p.canvas[k]%2)fail(k+' must be even');}
  if(!FPS.includes(p.canvas.fps))fail('fps');
  if(!/^#[0-9a-fA-F]{6}$/.test(p.canvas.background))fail('background color');
  array(p.media,'media',10000);array(p.tracks,'tracks',128);array(p.clips,'clips',50000);
  const ids=new Set([p.id]);
  function id(value){text(value,'entity id',128);if(ids.has(value))fail('duplicate id '+value);ids.add(value);}
  const media=new Map();const tracks=new Map();
  for(const m of p.media){
    keys(m,['id','type','path','name','duration','fingerprint'],'media');id(m.id);
    if(!MEDIA_TYPES.includes(m.type))fail('media type');text(m.path,'media path');text(m.name,'media name',500);
    if(m.type==='image'){if(m.duration!==null)fail('image duration must be null');}else number(m.duration,'media duration',Number.EPSILON);
    if(m.fingerprint!==null&&!/^[0-9a-f]{64}$/.test(m.fingerprint))fail('media fingerprint');media.set(m.id,m);
  }
  for(const t of p.tracks){
    keys(t,['id','type','name','locked','hidden','muted','solo'],'track');id(t.id);
    if(!TRACK_TYPES.includes(t.type))fail('track type');text(t.name,'track name',200);
    for(const k of ['locked','hidden','muted','solo'])if(typeof t[k]!=='boolean')fail('track '+k);tracks.set(t.id,t);
  }
  for(const c of p.clips){
    keys(c,['id','trackId','type','source','startTime','duration','sourceStart','sourceEnd','speed','transform','opacity','volume','effects','keyframes','text'],'clip');id(c.id);
    const t=tracks.get(c.trackId);if(!t||t.type!==c.type)fail('clip track/type mismatch');
    number(c.startTime,'clip start');number(c.duration,'clip duration',Number.EPSILON);number(c.sourceStart,'source start');number(c.sourceEnd,'source end');number(c.speed,'speed',0.05,16);
    if(Math.abs(c.sourceEnd-c.sourceStart-c.duration*c.speed)>1e-6)fail('source span must equal duration * speed');
    if(c.source!==null){const m=media.get(c.source);if(!m)fail('missing media reference');
      const accepted={music:['audio'],audio:['audio','video'],video:['video'],image:['image'],overlay:['video','image']}[c.type]||[];
      if(!accepted.includes(m.type))fail('clip media type mismatch');
      if(m.duration!==null&&c.sourceEnd>m.duration+1e-6)fail('clip exceeds source');
    }else if(!['text','subtitle','effect'].includes(c.type))fail('clip requires source');
    keys(c.transform,['x','y','scaleX','scaleY','rotation','flipX','flipY'],'transform');
    for(const k of ['x','y','rotation'])number(c.transform[k],k,-1e6,1e6);
    for(const k of ['scaleX','scaleY'])number(c.transform[k],k,0.001,1000);
    for(const k of ['flipX','flipY'])if(typeof c.transform[k]!=='boolean')fail(k);
    number(c.opacity,'opacity',0,1);number(c.volume,'volume',0,4);
    if(typeof c.text!=='string'||c.text.length>100000)fail('clip text');
    array(c.effects,'effects',100);for(const e of c.effects){keys(e,['id','type','enabled','parameters'],'effect');text(e.id,'effect id');text(e.type,'effect type');if(typeof e.enabled!=='boolean')fail('effect enabled');object(e.parameters,'effect parameters');}
    array(c.keyframes,'keyframes',10000);
    const seen=new Set();
    for(const k of c.keyframes){keys(k,['property','time','value','interpolation'],'keyframe');text(k.property,'keyframe property',128);number(k.time,'keyframe time',0,c.duration);number(k.value,'keyframe value',-1e9,1e9);if(!['linear','hold'].includes(k.interpolation))fail('interpolation');const key=k.property+':'+k.time;if(seen.has(key))fail('duplicate keyframe');seen.add(key);}
  }
  keys(p.exportSettings,['container','videoCodec','audioCodec','width','height','fps'],'exportSettings');
  const s=p.exportSettings;if(s.container!=='mp4'||!['h264','h265'].includes(s.videoCodec)||s.audioCodec!=='aac')fail('export codec');
  if(!FPS.includes(s.fps))fail('export fps');for(const k of ['width','height'])if(!Number.isInteger(s[k])||s[k]<2||s[k]>8192||s[k]%2)fail('export '+k);
  return p;
}
function createProject(name='새 프로젝트'){
  const now=new Date().toISOString();
  return validateProject({format:'O-CUT',version:VERSION,id:randomUUID(),name,createdAt:now,modifiedAt:now,revision:0,canvas:{width:1920,height:1080,fps:30,background:'#101216'},media:[],tracks:[],clips:[],exportSettings:{container:'mp4',videoCodec:'h264',audioCodec:'aac',width:1920,height:1080,fps:30}});
}
function createTrack(type,name=type){return {id:randomUUID(),type,name,locked:false,hidden:false,muted:false,solo:false};}
function createClip({trackId,type,source=null,startTime=0,duration,sourceStart=0,speed=1,text=''}){
  return {id:randomUUID(),trackId,type,source,startTime,duration,sourceStart,sourceEnd:sourceStart+duration*speed,speed,transform:{x:0,y:0,scaleX:1,scaleY:1,rotation:0,flipX:false,flipY:false},opacity:1,volume:1,effects:[],keyframes:[],text};
}
function serialize(p){validateProject(p);return JSON.stringify(p,null,2)+'\n';}
function deserialize(raw){if(typeof raw!=='string'||Buffer.byteLength(raw)>16*1024*1024)fail('project file exceeds 16 MiB');return validateProject(JSON.parse(raw));}
module.exports={VERSION,TRACK_TYPES,createProject,createTrack,createClip,validateProject,serialize,deserialize};
