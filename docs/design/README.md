# Design handoff (for Claude Code)

Commit this folder to the repo as `docs/design/`. Linear issues reference these paths.

- `projects/README.md`: Projects module spec (prototype v2) · `projects/screens/*.png`
- `shell/README.md`: Workspace switcher and Workspace settings · `shell/screens/*.png`
- `crm/README.md`: CRM changes (Pipeline views, won deal → project) · `crm/screens/*.png`
- `Projects Prototype.dc.html`, `CRM.dc.html`: clickable prototypes. Open them in a browser from this folder; Projects screens open by hash (see the README). They need `support.js`, `hover.css`, `FilterBar.dc.html`, `WorkspaceSwitcher.dc.html` and `_ds/` next to them.

The prototypes are design references, not production code. Rebuild them with the app's components and classes in `frontend/src`.

The switcher (CD-279) is `WorkspaceSwitcher.dc.html` inside the Projects prototype; Settings (CD-280) is `Projects Prototype.dc.html#boards`.

Linear: CD-279 (switcher), CD-280 (settings), CD-254–262 (design sub-issues under CD-229, CD-143–150), CD-263 + CD-265–273 (new Projects screens), CD-264 + CD-274–275 (CRM), CD-276 (M15 time entries).
