'use strict';
(function (root) {
  function lengths(clip) {
    const effect = clip.effects.find(e => e.type === 'audioFade' && e.enabled);
    return { fadeIn: Math.min(clip.duration, effect?.parameters.fadeIn || 0), fadeOut: Math.min(clip.duration, effect?.parameters.fadeOut || 0) };
  }
  function gain(clip, elapsed) {
    const { fadeIn, fadeOut } = lengths(clip);
    if (elapsed < 0 || elapsed >= clip.duration) return 0;
    return (fadeIn ? Math.min(1, elapsed / fadeIn) : 1) * (fadeOut ? Math.min(1, (clip.duration - elapsed) / fadeOut) : 1);
  }
  const api = { lengths, gain };
  if (typeof module !== 'undefined') module.exports = api; else root.OcutAudioFades = api;
})(globalThis);
