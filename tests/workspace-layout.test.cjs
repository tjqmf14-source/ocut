const {test}=require('node:test'),assert=require('node:assert/strict'),{measure,resize}=require('../src/core/workspace-layout.js');
test('workspace sizes stay inside small/large windows and malformed preferences cannot hide panels',()=>{
  for(const mode of ['edit','focus','music'])for(const [w,h] of [[1084,621],[1904,941]])for(const pref of [{},{left:1e9,third:-100,bottom:1e9},{left:NaN,third:Infinity,bottom:'bad'}]){
    const b=measure(mode,w,h,pref);assert.equal(b.columns.reduce((a,b)=>a+b,0),w);assert.ok(b.columns.every(n=>n>=220));assert.ok(b.bottom>=140&&b.bottom<=h-220);
  }
});
test('each splitter changes adjacent panels, preserves the other column, and clamps extreme drags',()=>{
  const music=measure('music',1900,900),first=measure('music',1900,900,resize('music',music,'left',80));assert.equal(first.columns[2],music.columns[2]);assert.equal(first.left,music.left+80);
  const second=measure('music',1900,900,resize('music',music,'third',60));assert.equal(second.left,music.left);assert.equal(second.third,music.third+60);
  const edit=measure('edit',1100,650),right=measure('edit',1100,650,resize('edit',edit,'third',40));assert.equal(right.left,edit.left);assert.equal(right.third,edit.third-40);
  assert.equal(resize('edit',edit,'bottom',-1e8).bottom,edit.bottomMax);assert.equal(resize('edit',edit,'bottom',1e8).bottom,140);
});
