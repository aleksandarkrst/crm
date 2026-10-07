# Design spec · CRM (Pipeline views, won deal → project)

**Reference file:** `docs/design/CRM.dc.html` (open from `docs/design/`). **Screenshots:** `docs/design/crm/screens/`.

The CRM design was rebuilt from the app (`frontend/src/screens/lead/*`, `Pipeline.tsx`, `calendar/*`, `meeting/*`), so the deal page, products dialog, meetings quick create, More options page, FilterBar and tables already match the app. Only the changes below are new.

## 1. Pipeline: Kanban / Table toggle
- **Filter bar, left to right:**
  - a segmented icon toggle: Kanban (`M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z`) and Table (`M4 6h16M4 12h16M4 18h16`). The active button is ink with white text; the group is 1 px `#E2E8E4`, radius 9, padding 2;
  - a **Funnel select** with a pencil button that opens Settings → Funnel builder. It replaces the funnel chip inside FilterBar;
  - `FilterBar` (Salesperson, Industry, Value, Lost);
  - meta on the right ("5 leads · €70,800 open");
  - the primary **New deal** button at the far right. Import and Export move into the "+" menu or ⋯.
- **Table view:**
  - **Columns:** Deal (company + title), Contact, Stage, Value, Fit, Last contact, Owner, Next step.
  - **Layout:** grouped by stage in bg-soft bands, using the standard `table-head` / `table-row` inside a 12 px bordered wrapper.
  - **Behaviour:** rows open the deal; the same filters apply.
  - **Empty:** "No deals match these filters."
- **Remember the view:** keep the chosen view per user (localStorage is enough).

## 2. Won deal: create or open the project (depends on CD-144)
- **Won deal header:** keeps the **Won** badge as it is today. Add **Create project** (primary, folder icon) when the deal has no project, or **Open project** (outline) once one exists. The Won and Lost buttons stay hidden, as they are now.
- **Create project:** opens "New project from deal" (see `docs/design/projects/README.md` §11).
- **Summary card:** gets a "Project" row linking to the project with its status.
