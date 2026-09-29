'use strict';
window.OcutText = {
  paint(ctx, clip, height) {
    ctx.font = `600 ${Math.round(height * 0.05)}px "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = clip.text.split('\n'), lineHeight = height * 0.065;
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000000'; ctx.lineWidth = Math.max(2, height * 0.003);
    lines.forEach((line, i) => { const y = (i - (lines.length - 1) / 2) * lineHeight; ctx.strokeText(line, 0, y); ctx.fillText(line, 0, y); });
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
