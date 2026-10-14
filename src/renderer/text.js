'use strict';
window.OcutText = {
  bounds(ctx,clip,height){
    const s=OcutTextStyle.get(clip),size=s.fontSize||Math.round(height*.05);ctx.save();ctx.font=`${s.weight} ${size}px "${s.font}", sans-serif`;ctx.letterSpacing=`${s.tracking}px`;
    const lines=clip.text.split('\n'),width=Math.max(size*.4,...lines.map(line=>ctx.measureText(line).width)),h=size+(lines.length-1)*size*s.lineHeight,padding=s.backgroundOpacity>0?s.padding:Math.max(4,s.strokeWidth);ctx.restore();
    return {x:(s.align==='left'?0:s.align==='right'?-width:-width/2)-padding,y:-h/2-padding,width:width+padding*2,height:h+padding*2};
  },
  paint(ctx, clip, height) {
    const s=OcutTextStyle.get(clip),size=s.fontSize||Math.round(height*.05);
    ctx.font=`${s.weight} ${size}px "${s.font}", sans-serif`;ctx.textAlign=s.align;ctx.textBaseline='middle';ctx.letterSpacing=`${s.tracking}px`;
    const lines=clip.text.split('\n'),lineHeight=size*s.lineHeight,width=Math.max(0,...lines.map(line=>ctx.measureText(line).width)),blockHeight=size+(lines.length-1)*lineHeight;
    const x=s.align==='left'?0:s.align==='right'?-width:-width/2,y=-blockHeight/2;
    if(s.backgroundOpacity>0){ctx.save();ctx.globalAlpha*=s.backgroundOpacity;ctx.fillStyle=s.background;ctx.beginPath();ctx.roundRect(x-s.padding,y-s.padding,width+s.padding*2,blockHeight+s.padding*2,s.radius);ctx.fill();ctx.restore();}
    if(s.gradient){const gradient=ctx.createLinearGradient(0,y,0,y+blockHeight);gradient.addColorStop(0,s.fill);gradient.addColorStop(1,s.gradientEnd);ctx.fillStyle=gradient;}else ctx.fillStyle=s.fill;
    ctx.strokeStyle=s.stroke;ctx.lineWidth=s.strokeWidth<0?Math.max(2,height*.003):s.strokeWidth;ctx.shadowColor=s.shadow;ctx.shadowBlur=s.shadowBlur;ctx.shadowOffsetX=s.shadowX;ctx.shadowOffsetY=s.shadowY;
    lines.forEach((line,i)=>{const y=(i-(lines.length-1)/2)*lineHeight;if(ctx.lineWidth>0&&s.strokeWidth!==0)ctx.strokeText(line,0,y);ctx.fillText(line,0,y);});
  },
  image(clip, canvas, output) {
    const node = document.createElement('canvas'); node.width = output.width; node.height = output.height;
    const ctx = node.getContext('2d'), t = clip.transform;
    ctx.scale(output.width / canvas.width, output.height / canvas.height);
    ctx.globalAlpha = clip.opacity; ctx.translate(canvas.width / 2 + t.x, canvas.height / 2 + t.y);
    ctx.rotate(t.rotation * Math.PI / 180); ctx.scale(t.scaleX * (t.flipX ? -1 : 1), t.scaleY * (t.flipY ? -1 : 1));
    this.paint(ctx, clip, canvas.height); return node.toDataURL('image/png');
  }
};
