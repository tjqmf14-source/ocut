(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OcutMusicStyles=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const genres=[
    ['city-pop','시티팝','Japanese city pop, warm electric piano, funky bass, clean rhythm guitar, nostalgic 1980s production'],
    ['trot','트로트','Korean trot, lively two-beat rhythm, expressive melody, brass accents, accordion'],
    ['ballad','발라드','pop ballad, lyrical piano, sweeping strings, gentle drums, emotional melodic development'],
    ['k-pop','K-pop 댄스','K-pop dance, punchy electronic drums, bright synthesizers, catchy melodic hook, polished pop arrangement'],
    ['rnb','R&B','contemporary R&B, warm electric piano, syncopated bass, laid-back drums, soulful harmonies'],
    ['acoustic','어쿠스틱 포크','acoustic folk, fingerpicked acoustic guitar, soft piano, organic percussion, intimate arrangement'],
    ['synthwave','신스웨이브','synthwave, analog synthesizers, pulsing arpeggios, deep synth bass, retro drum machine'],
    ['rock','록 밴드','melodic rock, electric guitar riffs, live drums, driving bass, dynamic full-band arrangement'],
    ['jazz','재즈 보사노바','bossa nova jazz, nylon-string guitar, mellow piano, brushed drums, warm upright bass'],
    ['kids','동요','children song, simple memorable melody, ukulele, playful bells, light percussion'],
    ['christmas','크리스마스 캐럴','Christmas carol, sleigh bells, warm strings, gentle piano, festive melodic arrangement'],
    ['japanese','일본 시티팝','Japanese city pop, jazzy chords, sparkling keyboards, syncopated guitar, smooth bass groove'],
    ['waltz','발라드 왈츠','romantic ballad waltz, flowing triple meter, lyrical piano, graceful strings'],
    ['lofi','퇴사 로파이','lo-fi hip hop, dusty drum groove, mellow jazz chords, soft piano, relaxed bass'],
    ['drive','퇴근길','chill pop, steady mid-tempo groove, warm keyboards, smooth bass, evening drive atmosphere'],
    ['gugak','힙한 국악','Korean traditional fusion, gayageum, daegeum flute, janggu rhythms, modern hip hop drums']
  ].map(([id,label,prompt])=>Object.freeze({id,label,prompt}));
  const moods={hopeful:'hopeful and uplifting mood',calm:'calm and relaxed atmosphere',emotional:'emotional and wistful mood',bright:'bright and cheerful mood',dreamy:'dreamy and spacious atmosphere',powerful:'energetic and powerful mood'};
  const voices={female:'clear expressive female vocal',male:'warm expressive male vocal',duet:'harmonized male and female duet'};
  function compose({selected=[],mood='hopeful',instrumental=true,voice='female',extra=''}={}){
    if(!Array.isArray(selected)||selected.length>3||selected.some(id=>!genres.some(g=>g.id===id))||new Set(selected).size!==selected.length)throw Error('장르는 최대 3개까지 선택해 주세요.');
    if(!moods[mood]||!voices[voice]||typeof instrumental!=='boolean'||typeof extra!=='string'||extra.length>500)throw Error('스타일 설정을 확인해 주세요.');
    const parts=[...selected.map(id=>genres.find(g=>g.id===id).prompt),moods[mood],instrumental?'instrumental, no vocals':voices[voice],extra.trim()];
    return [...new Set(parts.filter(Boolean).flatMap(p=>p.split(',').map(s=>s.trim()).filter(Boolean)))].join(', ');
  }
  return Object.freeze({genres:Object.freeze(genres),moods:Object.freeze(moods),voices:Object.freeze(voices),compose});
});
