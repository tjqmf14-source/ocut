'use strict';
(function(root){
  const fonts=['Malgun Gothic','Segoe UI','Arial','Batang','Gulim'];
  const defaults={font:'Malgun Gothic',fontSize:0,weight:600,tracking:0,lineHeight:1.3,align:'center',fill:'#ffffff',gradient:false,gradientEnd:'#b9edcf',stroke:'#000000',strokeWidth:-1,shadow:'#000000',shadowBlur:0,shadowX:0,shadowY:0,background:'#101215',backgroundOpacity:0,padding:20,radius:8};
  function validate(s){
    if(!s||Object.keys(s).some(k=>!Object.hasOwn(defaults,k)))throw Error('지원하지 않는 텍스트 서식입니다.');
    if(!fonts.includes(s.font)||![400,500,600,700,800,900].includes(s.weight)||!['left','center','right'].includes(s.align)||typeof s.gradient!=='boolean')throw Error('글꼴·굵기·정렬 설정을 확인해 주세요.');
    for(const key of ['fill','gradientEnd','stroke','shadow','background'])if(!/^#[\da-f]{6}$/i.test(s[key]))throw Error('올바른 텍스트 색상을 선택해 주세요.');
    for(const [key,min,max] of [['fontSize',0,500],['tracking',-10,40],['lineHeight',.5,3],['strokeWidth',-1,20],['shadowBlur',0,40],['shadowX',-50,50],['shadowY',-50,50],['backgroundOpacity',0,1],['padding',0,100],['radius',0,80]])if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw Error('텍스트 서식 범위를 확인해 주세요: '+key);
  }
  function get(clip){return {...defaults,...clip.effects.find(e=>e.type==='textStyle'&&e.enabled)?.parameters};}
  const presets={
    title:{...defaults,weight:800,gradient:true,strokeWidth:0,shadowBlur:12},
    subtitle:{...defaults,weight:700,backgroundOpacity:.75,padding:16,radius:8,strokeWidth:0},
    lyrics:{...defaults,weight:500,tracking:1.5,fill:'#b9edcf',strokeWidth:0,shadowBlur:10},
    lowerThird:{...defaults,align:'left',weight:700,fill:'#101215',background:'#b9edcf',backgroundOpacity:1,padding:20,strokeWidth:0,radius:4}
  };
  const api={fonts,defaults,presets,validate,get};if(typeof module!=='undefined')module.exports=api;else root.OcutTextStyle=api;
})(globalThis);
