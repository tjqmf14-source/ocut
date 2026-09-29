'use strict';
class StudioPlayback {
  constructor(canvas, onTime, onError) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.onTime = onTime; this.onError = onError;
    this.time = 0; this.playing = false; this.nodes = new Map(); this.audioContext = null;
  }
  setProject(project, assets) {
    this.pause();
    if (this.project?.id !== project.id) this.clear();
    this.project = project; this.assets = assets;
    this.duration = Math.max(0, ...project.clips.map(c => c.startTime + c.duration));
    this.canvas.width = project.canvas.width; this.canvas.height = project.canvas.height;
    const ids = new Set(project.clips.map(c => c.id));
    for (const [id, entry] of this.nodes) if (!ids.has(id)) { entry.node.pause?.(); entry.node.removeAttribute('src'); entry.gain?.disconnect(); entry.source?.disconnect(); this.nodes.delete(id); }
    this.seek(Math.min(this.time, this.duration));
  }
  clear() {
    for (const entry of this.nodes.values()) { entry.node.pause?.(); entry.node.removeAttribute('src'); entry.gain?.disconnect(); entry.source?.disconnect(); }
    this.nodes.clear(); this.time = 0;
  }
  node(clip) {
    if (this.nodes.has(clip.id)) return this.nodes.get(clip.id);
    const media = this.project.media.find(m => m.id === clip.source), asset = this.assets[clip.source];
    if (!media || !asset) return null;
    const node = media.type === 'image' ? new Image() : document.createElement(media.type === 'audio' ? 'audio' : 'video');
    node.crossOrigin = 'anonymous';
    if (media.type !== 'image') { node.preload = 'auto'; node.playsInline = true; }
    const entry = { node, media, gain: null, source: null };
    node.addEventListener(media.type === 'image' ? 'load' : 'loadeddata', () => this.draw());
    node.addEventListener('seeked', () => { if (!this.playing) this.draw(); });
    node.addEventListener('error', () => this.onError(`${media.name}: 미리보기에서 재생할 수 없는 미디어입니다.`));
    node.src = asset.url; this.nodes.set(clip.id, entry); return entry;
  }
  async play() {
    if (!this.duration) return;
    if (this.time >= this.duration - 1e-6) this.time = 0;
    if (!this.audioContext) this.audioContext = new AudioContext();
    await this.audioContext.resume();
    this.playing = true; this.anchor = performance.now(); this.start = this.time; this.tick();
  }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); for (const e of this.nodes.values()) e.node.pause?.(); if (this.project) this.onTime(this.time, false); }
  seek(time) { this.time = Math.max(0, Math.min(this.duration || 0, time)); this.anchor = performance.now(); this.start = this.time; this.draw(true); this.onTime(this.time, this.playing); }
  tick() {
    if (!this.playing) return;
    this.time = Math.min(this.duration, this.start + (performance.now() - this.anchor) / 1000);
    this.draw(); this.onTime(this.time, true);
    if (this.time >= this.duration) { this.pause(); return; }
    this.raf = requestAnimationFrame(() => this.tick());
  }
  draw(seek = false) {
    if (!this.project) return;
    const { ctx, project } = this;
    const { width, height } = project.canvas;
    ctx.fillStyle = project.canvas.background; ctx.fillRect(0, 0, width, height);
    const solo = project.tracks.some(t => t.solo);
    // Track order is top-to-bottom in the editor; paint the bottom first.
    for (const track of [...project.tracks].reverse()) {
      for (const clip of project.clips.filter(c => c.trackId === track.id)) {
        const active = this.time >= clip.startTime - 1e-7 && this.time < clip.startTime + clip.duration - 1e-7;
        let entry = this.nodes.get(clip.id);
        if (!active) { entry?.node.pause?.(); continue; }
        if (clip.source && !entry) entry = this.node(clip);
        if (entry && entry.media.type !== 'image') {
          const { node } = entry;
          const wanted = clip.sourceStart + (this.time - clip.startTime) * clip.speed;
          if (node.readyState >= 1 && (seek || !this.playing || Math.abs(node.currentTime - wanted) > 0.15) && Math.abs(node.currentTime - wanted) > 0.015) node.currentTime = wanted;
          node.playbackRate = Math.max(0.25, Math.min(4, clip.speed));
          if (this.audioContext && !entry.source) {
            entry.source = this.audioContext.createMediaElementSource(node); entry.gain = this.audioContext.createGain();
            entry.source.connect(entry.gain).connect(this.audioContext.destination);
          }
          const volume = !track.muted && (!solo || track.solo) ? clip.volume : 0;
          if (entry.gain) { entry.gain.gain.value = volume; node.volume = 1; } else node.volume = Math.min(1, volume);
          if (this.playing && node.paused) node.play().catch(error => { if (error.name !== 'AbortError') this.onError(error.message); });
        }
        if (track.hidden || clip.type === 'audio' || clip.type === 'music') continue;
        ctx.save(); ctx.globalAlpha = clip.opacity;
        ctx.translate(width / 2 + clip.transform.x, height / 2 + clip.transform.y);
        ctx.rotate(clip.transform.rotation * Math.PI / 180);
        ctx.scale(clip.transform.scaleX * (clip.transform.flipX ? -1 : 1), clip.transform.scaleY * (clip.transform.flipY ? -1 : 1));
        if (clip.type === 'text' || clip.type === 'subtitle') {
          OcutText.paint(ctx, clip, height);
        } else if (entry && (entry.media.type === 'image' ? entry.node.complete && entry.node.naturalWidth : entry.node.readyState >= 2)) {
          const w = entry.node.videoWidth || entry.node.naturalWidth, h = entry.node.videoHeight || entry.node.naturalHeight;
          const scale = Math.min(width / w, height / h); ctx.drawImage(entry.node, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
        }
        ctx.restore();
      }
    }
  }
}
window.StudioPlayback = StudioPlayback;
