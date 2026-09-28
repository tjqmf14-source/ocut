'use strict'
// Phase 0 safety adaptation: the upstream updater must never install over O-CUT.
// Original implementation is preserved in original/source/electron/app-update.js.
const unavailable = async () => ({ ok: false, error: 'O-CUT baseline에서는 원본 프로그램 업데이트를 실행하지 않습니다.' })
module.exports = { init () {}, check: async () => null, download: unavailable, run: unavailable, openInBrowser: unavailable }
