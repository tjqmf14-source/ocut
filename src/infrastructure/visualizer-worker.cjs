'use strict';
const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs');
const {analyzeSource}=require('../core/spectrum-analysis.cjs');
const rate=24000,fps=30,waveCount=64,fd=fs.openSync(workerData.file,'r'),length=fs.fstatSync(fd).size/4;
try{
  const source={length,read(start,into){into.fill(0);const from=Math.max(0,start),n=Math.max(0,Math.min(length, start+into.length)-from);if(!n)return;
    const bytes=Buffer.alloc(n*4);fs.readSync(fd,bytes,0,bytes.length,from*4);for(let i=0;i<n;i++)into[from-start+i]=bytes.readFloatLE(i*4);
  }};
  const analysis=analyzeSource(source,rate,fps,{barCount:128,minFrequency:20,maxFrequency:12000,fftSize:2048,smoothing:0});
  const waves=new Float32Array(analysis.frameCount*waveCount),window=new Float32Array(2048);
  for(let f=0;f<analysis.frameCount;f++){source.read(Math.round(f/fps*rate)-1024,window);for(let i=0;i<waveCount;i++){let peak=0;for(let j=i*32;j<(i+1)*32;j++)if(Math.abs(window[j])>Math.abs(peak))peak=window[j];waves[f*waveCount+i]=peak;}}
  parentPort.postMessage({version:1,fps,duration:length/rate,frameCount:analysis.frameCount,barCount:128,waveCount,
    frames:Buffer.from(analysis.frames.buffer).toString('base64'),waves:Buffer.from(waves.buffer).toString('base64')});
}finally{fs.closeSync(fd);}
