# Design spec · Workspace switcher and Workspace settings

Both come from `Projects Prototype.dc.html`:
- the switcher is `WorkspaceSwitcher.dc.html`, mounted in the sidebar;
- the settings page is the Settings screen (`Projects Prototype.dc.html#boards`).

Screens: `shell/screens/*.png`.

## Workspace switcher (CD-279)

**Trigger** (sidebar, under the Pultly mark): an 80 px tile, radius 12.
- Border `rgba(255,255,255,.08)` and fill `.04`. Hover and open: fill `.08`, border lime `rgba(198,241,106,.32)`.
- Inside, a 34 px icon tile (radius 9, lime 14% fill, lime icon) with the current module's icon.
- Below it, the module name 11/600 (ellipsis) and a down chevron in `#93A39B`. On Settings pages it shows the gear and "Settings".
- Title: "Modules and workspaces (⌘ J)".

**Popover** (420 px, radius 12, `shadow-pop`, 10 px right of the sidebar, `dcFade` .14s). Two views:

*Modules view*
- With 2+ workspaces, a workspace row on `bg-soft` sits at the top: 30 px brand tile with the initial, "Workspace" 11.5 muted, the name 14/600, and "Switch ›". It opens the workspaces view. With one workspace, its name shows as "{name} ›" next to the "Modules" label instead.
- "MODULES" caps label, then a 2-column grid of module items:
  - each has a 34 px tile with the icon, the name 13.5/500, and a description 12 muted;
  - current: `brand-tint` row, Forest tile with a lime icon;
  - others: `chip` tile in text-2, hover `chip`.
- Items, in order:
  - CRM "Pipeline, deals, contacts"
  - Projects "Tasks, work orders, dispatch"
  - Workforce "People and capacity"
  - Workspace settings "CRM, Projects, Workforce"
  - Planning "Budgets and targets"
  - Finance "Receivables, payables, bank"
  - Reporting "Schedule and utilisation"
- Locked items show 55% opacity, a lock icon and the reason in place of the description, and can't be picked:
  - "Coming soon": modules that aren't built yet;
  - "Not in this workspace": the module is off for the current workspace;
  - "Owners and admins": Workspace settings for other roles.
- Footer (top divider): grid icon, "Jump to a module", `⌘ J` / `Ctrl J` key.

*Workspaces view*
- Head: "‹ Modules" (back) and "WORKSPACES" caps on the right.
- One row per workspace, sorted by name: 30 px tile with the initial, the name 13.5/500 and "N members". The current workspace is on `brand-tint` with a brand tile and a tick; the others have a `segment` tile.
- Picking a workspace switches to it and stays on the same module. If that workspace doesn't have the module, a toast says "{Workspace} has no {Module}. Opening {first available module}…" and opens that module. If it has none, the toast says "{Workspace} has no modules turned on that open here."
- Footer: "+ New workspace" opens an inline form ("Workspace name" input, Cancel / Create workspace, disabled until a name is typed; Enter submits). Creating switches to the new workspace.

**Closing:** ⌘J toggles; Escape, an outside click or a pick closes. Opening always starts on the modules view.

## Workspace settings (CD-280)

Route `/settings`, one section per sub-route or hash. The design shows Project types.

**Shell:**
- Settings keeps the sidebar of the module it was opened from (`rememberModule`). The sidebar switcher shows that module, and no nav item is active.
- The header is the standard `screen-header`: title "Settings", then search, "+", bell and avatar.

**Layout:**
- **Left nav** (200 px): groups with a caps label (`.caps`, padded 0 10 4), then the section items (13 px, padding 7×10, radius 8).
  - The active item is 600 brand on `brand-tint`; the others are 500 text-2.
  - Groups gap 14, items gap 2.
- **Content** (flex 1, min 560): the section title 16/600 (−0.01em), a description 13 text-2 (max 760), then the section. The gap between the nav and content is 28.
- Under ~800 px the nav wraps above the content.

**Groups and sections:**
- Workspace: General, Members
- CRM: Funnels
- Projects: Project types
- Workforce: Cost rates

**Project types** section:
- Description: "A project type is a set of stages for one kind of project, like a funnel in the CRM. Each project is on one board: it shows in that board's columns, and its tasks are grouped by the same stages in the plan. Complete and Cancel are always available and are not stages."
- Left: project type cards (`.choice`, name 13.5/600 and "N stages · N projects"), plus a dashed "New project type" button.
- Right: a card with:
  - "Project type name";
  - "STAGES": rows with the number, an inline-editable name, usage ("N projects · N tasks"), and Move up / Move down / Delete. Delete is disabled while the stage is in use.
  - "New stage" (dashed);
  - "PREVIEW": the stage bar (`stage-bar` / `stage-chev`);
  - "Used by {projects}."
