'use strict';
const MODEL=Object.freeze({id:'MIT/ast-finetuned-audioset-10-10-0.4593',revision:'f826b80d28226b62986cc218e5cec390b1096902',sha256:'ae0c1e2ad4e1381d851fa9bf298ba13ebc9c5a914cdee2dbe427a6583869924d'});
const POLICY='ast-audioset-provisional-v1';
const uuid=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function selection(ids){if(!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)throw Error('검사할 음악을 1–50곡 선택해 주세요.');return ids;}
function starts(duration){if(!Number.isFinite(duration)||duration<=0||duration>1800)throw Error('검사할 음악은 30분 이내여야 합니다.');const end=Math.max(0,duration-10),values=[];for(let at=0;at<end;at+=5)values.push(at);values.push(end);return values;}
function validateResult(value,duration){
  if(!value||value.sampleRate!==16000||!Number.isFinite(value.duration)||Math.abs(value.duration-duration)>.12||!Array.isArray(value.windows))throw Error('음성 검사 응답 형식이 올바르지 않습니다.');
  const expected=starts(value.duration);if(value.windows.length!==expected.length)throw Error('음악 전체 구간을 검사하지 못했습니다.');
  value.windows.forEach((w,i)=>{if(!w||!Number.isFinite(w.start)||!Number.isFinite(w.end)||Math.abs(w.start-expected[i])>.002||Math.abs(w.end-Math.min(value.duration,w.start+10))>.002||['speech','singing','humming'].some(k=>!Number.isFinite(w[k])||w[k]<0||w[k]>1))throw Error('음성 검사 구간 또는 점수가 올바르지 않습니다.');});
  return {duration:value.duration,sampleRate:16000,windows:value.windows.map(({start,end,speech,singing,humming})=>({start,end,speech,singing,humming}))};
}
function classify(windows){
  // AudioSet scores are not calibrated probabilities. This provisional policy is
  // deliberately reviewable and never authorizes deletion by itself.
  let detected=false,review=false;
  for(const key of ['speech','singing','humming']){
    for(let i=0;i<windows.length;i++){
      const w=windows[i],high=key==='speech'?.85:.7,low=key==='speech'?.25:.15;
      if(w[key]>=low)review=true;
      if(w[key]>=.95||(w[key]>=high&&i>0&&windows[i-1][key]>=high&&w.end-windows[i-1].start>=12))detected=true;
    }
  }
  return detected?'detected':review?'review':'not_detected';
}
function validateReport(report,id){
  if(!report||report.version!==1||report.id!==id||!uuid(id)||report.policy!==POLICY||!['detected','review','not_detected'].includes(report.verdict)||!/^[a-f0-9]{64}$/.test(report.audioSha256)||!Array.isArray(report.sourceSignature)||report.sourceSignature.length!==5||report.sourceSignature.some(v=>!Number.isFinite(v))||!Number.isFinite(Date.parse(report.scannedAt))||!report.model||Object.keys(MODEL).some(k=>report.model[k]!==MODEL[k]))throw Error('저장된 음성 검사 기록이 올바르지 않습니다.');
  const result=validateResult(report,report.duration);
  if(classify(result.windows)!==report.verdict||!report.coverage||report.coverage.ratio!==1||report.coverage.windowSeconds!==10||report.coverage.strideSeconds!==5||Math.abs(report.coverage.seconds-report.duration)>.002)throw Error('음성 검사 결과가 전체 구간 기록과 일치하지 않습니다.');
  return report;
}
module.exports={MODEL,POLICY,uuid,selection,starts,validateResult,classify,validateReport};
