# Roadmap

A living list — items get added as we go. **Owner** work needs artwork or an
account; **Agent** work is repo and documentation.

## 0.3.x — polish and publish

### Owner

- [ ] **New icon.** Two files, same artwork: a square PNG (used as the add-on
      icon; `info.json` currently points at `lovesMBz.svg`) and a 24×24 SVG for
      the menu (`skin/icon/lovesMBz.svg`, drawn at `viewBox="0 0 24 24"`). Keep
      the filenames so `init.js`, the menu action and `info.json` need no change.
- [ ] **README cover.** A wide banner for the top of `README.md`, plus the square
      image for the addons listing. Suggested path `docs/cover.png`; the README
      gets the image tag once the file exists.
- [ ] **Publish on mediamonkey.com.** Submit at
      <https://www.mediamonkey.com/addons/> → Submit Addon → the MediaMonkey 5
      sub-category. Needs a forum account, the title `Loves MBz` (matching
      `info.json`), a description, screenshots, the square image and the release
      `.mmip`. Each later version is **Add New Version** and needs moderator
      approval again.

### Agent

- [x] Badges in `README.md`: latest release, downloads, MediaMonkey version,
      platform.
- [ ] Screenshots section in the README once the cover exists — the three
      columns, the IDs dialog, the Track Properties tab.
- [ ] Keep `info.json`, the README version line and the changelog in step on every
      release; tag `vX.Y.Z`, push, and attach `LovesMBz.mmip` to the release
      (`gh release create` now that `gh` is installed).
- [ ] Optional: a GitHub Actions workflow that builds the `.mmip` and attaches it
      when a `v*` tag is pushed, replacing the manual zip-and-upload step.

## Backlog

Nothing queued yet — add ideas here as they come up.
