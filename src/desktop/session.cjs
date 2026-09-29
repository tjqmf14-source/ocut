'use strict';
const path = require('node:path');
const { createProject, createTrack, serialize } = require('../core/project.cjs');
const { ProjectHistory } = require('../core/history.cjs');
const { ProjectStore } = require('../infrastructure/project-store.cjs');

class StudioSession {
  constructor() { this.newProject(); }
  newProject() {
    const project = createProject();
    project.tracks = [createTrack('text', '텍스트'), createTrack('video', '영상'), createTrack('audio', '오디오')];
    this.history = new ProjectHistory(project);
    this.location = null;
    this.etag = null;
    this.saved = serialize(project);
    return this.snapshot();
  }
  snapshot() {
    const project = this.history.state;
    return { project, location: this.location, dirty: serialize(project) !== this.saved,
      canUndo: this.history.canUndo, canRedo: this.history.canRedo };
  }
  settings(values) {
    this.history.apply('프로젝트 설정', project => {
      project.name = values.name;
      project.canvas = { ...project.canvas, width: values.width, height: values.height, fps: values.fps };
      project.exportSettings = { ...project.exportSettings, width: values.width, height: values.height, fps: values.fps };
    });
    return this.snapshot();
  }
  async open(file) {
    const store = new ProjectStore(path.dirname(file));
    const result = await store.open(path.basename(file));
    this.history = new ProjectHistory(result.project);
    this.location = file;
    this.etag = result.etag;
    this.saved = serialize(result.project);
    return this.snapshot();
  }
  async save(file = this.location) {
    if (!file) throw Error('저장 위치를 선택해 주세요.');
    const store = new ProjectStore(path.dirname(file));
    const same = file.toLowerCase() === this.location?.toLowerCase();
    let etag = same ? this.etag : null;
    if (!same) {
      try { etag = (await store.open(path.basename(file))).etag; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const result = await store.save(path.basename(file), this.history.state, { expectedEtag: etag });
    this.location = file;
    this.etag = result.etag;
    this.saved = serialize(result.project);
    return this.snapshot();
  }
}
module.exports = { StudioSession };
