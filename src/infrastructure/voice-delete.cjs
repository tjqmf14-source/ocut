'use strict';
const path=require('node:path');
const {selection,validateReport}=require('../core/voice-check.cjs');
const {hashFile,readValidReport}=require('./voice-check.cjs');
const {inspectMusic}=require('./music-delete.cjs');
async function prepareVoiceDeletion({directory,cacheDirectory,ids,scanId,scan,media=[],assets=[],projectDirectory=process.cwd()}){
  selection(ids);
  if(!scan||scan.id!==scanId||!Array.isArray(scan.reports))throw Error('선택한 곡을 다시 검사한 뒤 삭제해 주세요.');
  const plans=[];
  for(const id of ids){
    const report=scan.reports.find(r=>r.id===id);validateReport(report,id);
    if(report.verdict!=='detected')throw Error('검출된 곡만 일괄 삭제할 수 있습니다. 확인 필요·미검출·오류 곡은 제외해 주세요.');
    const saved=await readValidReport(directory,id);
    if(!saved||saved.scannedAt!==report.scannedAt||saved.audioSha256!==report.audioSha256)throw Error('음악 또는 검사 기록이 변경됐습니다. 다시 검사해 주세요.');
    const plan=await inspectMusic(directory,cacheDirectory,id);
    if(await hashFile(path.join(plan.target,'audio.wav'))!==report.audioSha256)throw Error('검사 후 음악 파일이 변경됐습니다. 다시 검사해 주세요.');
    const inside=file=>{const relative=path.relative(plan.target,path.resolve(file));return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
    if(media.some(m=>inside(path.resolve(projectDirectory,m.path)))||assets.some(a=>inside(a.path)))throw Error('현재 프로젝트 또는 실행 취소 기록에서 사용하는 곡입니다. 프로젝트를 저장하고 새 프로젝트를 연 뒤 삭제해 주세요.');
    plans.push(plan);
  }
  return plans;
}
module.exports={prepareVoiceDeletion};
