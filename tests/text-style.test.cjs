'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const style=require('../src/core/text-style.js'),{createProject,validateProject}=require('../src/core/project.cjs'),{ProjectHistory}=require('../src/core/history.cjs'),{applyCommand}=require('../src/core/timeline.cjs');
test('all text presets validate and unknown CSS or nonfinite style values reject',()=>{
  for(const preset of [style.defaults,...Object.values(style.presets)])style.validate(preset);
  for(const change of [{font:'url(bad)'},{fill:'red;bad'},{fontSize:501},{shadowBlur:Infinity},{align:'unknown'},{tracking:-11},{gradient:'yes'},{extra:1}])assert.throws(()=>style.validate({...style.defaults,...change}));
});
test('text style edits are undoable and survive serialization',()=>{
  const h=new ProjectHistory(createProject()),id=applyCommand(h,{type:'text',text:'한글\nTitle'});
  applyCommand(h,{type:'update',id,values:{textStyle:style.presets.title}});assert.equal(style.get(h.state.clips[0]).gradient,true);validateProject(JSON.parse(JSON.stringify(h.state)));h.undo();assert.equal(style.get(h.state.clips[0]).gradient,false);h.redo();assert.equal(style.get(h.state.clips[0]).weight,800);
});
test('styled captions split and merge preserve style and reject mixed styles atomically',()=>{
  const h=new ProjectHistory(createProject()),id=applyCommand(h,{type:'subtitle',text:'두 줄\n자막'});applyCommand(h,{type:'update',id,values:{textStyle:style.presets.subtitle}});
  const right=applyCommand(h,{type:'split',id,time:1});assert.deepEqual(style.get(h.state.clips[0]),style.get(h.state.clips[1]));
  applyCommand(h,{type:'update',id:right,values:{textStyle:style.presets.lyrics}});const before=h.state;assert.throws(()=>applyCommand(h,{type:'mergeCaptions',ids:[id,right]}),/같은 서식/);assert.deepEqual(h.state,before);
  h.undo();applyCommand(h,{type:'mergeCaptions',ids:[id,right]});assert.equal(h.state.clips.length,1);assert.equal(h.state.clips[0].duration,3);assert.deepEqual(style.get(h.state.clips[0]),style.presets.subtitle);
});
test('default text appearance remains available for legacy projects without effects',()=>{assert.deepEqual(style.get({effects:[]}),style.defaults);});
