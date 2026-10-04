# O-CUT delivery workflow

The user wants finished changes delivered automatically to the installed app on this PC, without repeated manual installation or commit confirmation.

- When changing shipped app behavior, increment `version.json` and run `npm run build:update`. This runs the Studio, installer and actual update gates before signing and publishing the local update feed. Do not stop at `build:studio` and claim the installed app has updated.
- Publish only a new, verified version. Never overwrite a published version, bypass failed gates, or report stale evidence as current. `evidence/updates/published.json` and the signed feed must match the exact candidate tested in `evidence/updates/qa.json`.
- The installed app checks the local feed at startup and every five minutes, then applies a prepared update after normal exit. Never force-close the user's app or overwrite unsaved work. Report a pending update as pending until actual activation is confirmed.
- Use `scripts/enable-local-updates.cjs` only for the initial bridge or a missing installation. It verifies the current package or installs the fully verified candidate into an absent default app directory. Preserve existing registration, user data, music, models, unknown files and backups.
- The signing key is private in `.runtime/update-keys/private.pem`. Keep its protected ACL limited to the current user, SYSTEM and Administrators. Do not print, commit, archive, package, upload or silently regenerate it. The publisher checks this ACL. The app contains only its pinned public key.
- Keep this delivery channel local to this PC. External publication, paid infrastructure, key rotation and changes to other users' installations are outside this workflow.
- Keep evidence and the current README, BUILD, CHANGELOG, QA_REPORT, RELEASE_REPORT and UPDATE_REPORT consistent with the delivered version. Explicitly distinguish app delivery from unfinished product features and untested environments.
