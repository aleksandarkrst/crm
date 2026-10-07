# Design spec · Projects module (Milestone 14, prototype v2)

**Reference file:** `docs/design/Projects Prototype.dc.html`. Open it in a browser from `docs/design/`, next to `support.js`, `hover.css`, `FilterBar.dc.html`, `WorkspaceSwitcher.dc.html` and `_ds/`. Each screen opens directly by URL hash: `#projects`, `#project-overview`, `#project-plan`, `#project-team`, `#project-comms`, `#project-docs`, `#project-report`, `#tasks`, `#task`, `#orders`, `#order`, `#dispatch`, `#techs`, `#workload`, `#boards`, `#crm`.

**Screenshots:** `docs/design/projects/screens/*.png`, one per hash above. They show only the top of each screen; the prototype has the rest.

**Supersedes:** `design_handoff_projects_m14/` (v1). Where v2 and the CD-143 to CD-150 issues disagree, each issue's "Design" sub-issue lists the difference and says which one wins. Until a sub-issue is resolved, the issue wins on rules and v2 wins on layout and copy.

**Fidelity:** high. Every class used (`deal-header`, `deal-crumb`, `deal-header-top`, `deal-actions`, `stage-bar`, `stage-chev`, `card`, `caps`, `field-row`, `field-label`, `ghost ghost-sm`, `select-wrap`, `box-input`, `table-head`, `table-row`, `badge-*`, `btn-*`, `modal`, `overlay`, `hint-box`) already exists in `frontend/src/styles/global.css`. Reuse `FilterBar` from `components/ui.tsx`, and the pipeline column and card markup from `screens/Pipeline.tsx`.

## App shell (CD-229)
- **Sidebar:** the Pultly mark, then the module switcher showing "Projects", then the nav items **Projects** (board icon), **Tasks** (list icon), **Work orders** (wrench) and **Dispatch** (calendar). Settings sits at the bottom.
- **Header:** `Screen` with the title. Record pages use crumbs in the `deal-crumb` (for example "Projects → Northwind Logistics"). The search pill reads "Search projects, tasks, work orders". "+" opens "Create in Projects": Project, Task, Work order.
- **Ctrl K:** opens the command palette with groups Projects, Tasks and Work orders.

## 1. Projects board · `#projects`
- **Filter bar, left to right:**
  - a segmented Board/List toggle (icon buttons);
  - a **Project type** select with a pencil button that opens Settings → Project types;
  - `FilterBar` (Lead, Health, Open / Completed / Cancelled);
  - meta text on the right, e.g. "6 open projects · 412 h logged".
- **Hint box:** shown when a won deal has no project yet: "1 won deal has no project yet: **Northwind Logistics · Website and CRM rollout**", with a "New project" button.
- **Board:** the CRM pipeline layout. Columns are the stages of the selected project type, with chevron heads that show the stage name and "N · €value". Drag a card to another column to move the project's stage.
- **Card:** name 13.5/600 with the value (11, brand) on the right; "Company · Lead"; a health badge (On track = brand, At risk = warn, Off track = danger) with a progress bar and %; a dashed divider; the next 2 open tasks (status dot, name, due date in red when overdue); "N open tasks · finish 23 Oct". A Completed or Cancelled badge appears when the project is closed.
- **List view:** columns Project (name + company) · Lead (avatar) · Project type · Stage · Health · Progress · Tasks · Finish. Rows are clickable. Empty: "No projects match these filters."

## 2. Project page · `#project-*`
- **Header (`deal-header`):**
  - crumb "Projects → {company}" and the project name;
  - actions **Complete** (primary) and **Cancel project** (outline); a closed project shows only **Reopen**;
  - the stage bar of the project's type, where clicking a chevron moves the stage.
- **Cancel dialog:** "Cancel this project?" with the text "Open tasks stay as they are and the project leaves the workload. You can reopen it later." The Reason pills are Client cancelled, Budget cut, Scope moved to another project and Other. Buttons: Keep project, Cancel project.
- **Left column (≤360 px):**
  - **Details card:** Name, Project type, Lead, Health, Start, End, Budget (h), Value, Description. All fields edit inline.
  - **Linked card:** the deal, company and contact.
  - **Team card:** "Team · N" with a "Manage" link to the Team tab.
- **Right column:** `composer-tab` tabs:
  - **Overview:** a "Coming up" list of the next tasks (Stage, Assignee, Due, Estimate h); a file drop zone ("Drop a file here, or Choose file"); History.
  - **Plan · N:** Table / Kanban / Gantt toggle. The table has columns ID, Task, Assignee, Est. h, Logged, Start, Due, Depends on and Status, with tasks grouped by stage in bands. The kanban columns are either Task status or Project stage. The Plan tab also has "New task" and the project's **Work orders** list (ID, Work order, Technician, Scheduled, Type, Status, "New work order").
  - **Team:** the note "People come from the org chart in Planning. Load adds up weekly hours across all open projects." and "Add to project". Columns: Person, Team, Project role, Hours / week, Open, Remaining, Load (all projects).
  - **Communication · N:** email threads, with "New email".
  - **Documents · N:** a folder list and an upload drop zone. Columns: Name, Folder, Linked to, Added by, Date, Size. Empty: "No files in this folder."
  - **Report:** "By stage" (Stage, Tasks, Estimate, Logged, Remaining, Done by estimate, Due) and "By person" (Person, Open, Overdue, Estimate, Logged, Remaining, vs estimate). The note reads: "'vs estimate' compares logged hours with estimates on finished tasks only."

## 3. Tasks · `#tasks`
- **Filter bar:** Kanban/Table toggle, `FilterBar` (project, assignee, due), meta, and a primary "New task" button.
- **Kanban:** columns To do · In progress · On hold · Done. Each column head has a colour dot, name, count and hours; the column body is grey. A card shows "Project · Stage" (link), the task name (link), "Waits for {task}" when it has a dependency, then avatar, hours and due date. Drag a card to change the task's status. The help line reads "Drag a task to change its status. Click a task to open it, or the project name to open the project."
- **Table:** columns ID, Task, Project (+ company), Stage, Assignee (inline select), Est. h, Due, Status (inline select).

## 4. Task page · `#task`
- **Header:**
  - crumb "{back} → {project} → {id}"; the name is an inline ghost input, 24/600;
  - **Mark done**, or the Done badge plus **Reopen**;
  - a stage bar of the statuses To do / In progress / On hold / Done (click to change); then the meta line.
- **On hold:**
  - moving a task to On hold opens a dialog first: "Put {id} on hold", "The task stays with its assignee. Tell the team why the work is paused.";
  - reason presets: Waiting for the client, Waiting for another task, Waiting for access or keys, Assignee unavailable;
  - the "Put on hold" button stays disabled until there is a reason;
  - the page then shows a red "On hold" box with the reason, which can be edited.
- **Left column (≤360 px):**
  - **Details:** Assignee, Stage, Start, Due (red when overdue), Estimate (h), Waits for, Project (link), Company.
  - **Time:** "From Workforce timesheets"; "X h of Y h logged" in 22/600, red when over; a bar; a line with "N h left" or "N h over". Each entry has an avatar, note, "date · person" and hours, plus **Edit** (pencil: hours, date and note inline, Cancel / Save) and **Delete** (×). The add row has hours, a note and "Log time".
  - **Dependencies:** "Waits for" and "Blocks" lists with a status dot, ID, name and status or due. Empty states: "Nothing. This task can start any time." and "No tasks wait for this one."
- **Right column:**
  - **Description:** a textarea.
  - **Checklist:** "N of M" with a 4 px bar; items with a checkbox, inline text and ×; "Add an item" with Add (Enter also adds).
  - **Files:** "New file"; empty: "Files you add here also appear in the project's Documents tab."
  - **Comments:** a list of comments; empty: "No comments yet. Comments are visible to everyone on the project team."; a textarea with "Comment".

## 5. Work orders · `#orders`
- **Filter bar:** Kanban/Table toggle, `FilterBar`, meta, and "New work order".
- **Kanban:** columns Unscheduled · Scheduled · In progress · On hold · Completed. Cards carry an Urgent badge when urgent. The help line reads "Drag a work order to change its status. Scheduling needs a technician and a time; set those on the dispatch board or the work order."
- **Table:** columns ID, Work order, Site, Project, Technician, Scheduled, Type, Status. Empty: "No work orders match these filters."

## 6. Work order page · `#order`
- **Header:** crumb "{back} → WO-1044"; the title; the meta line "Company · Project · Stage · Technician · date, time–time"; **Put on hold** and **Mark completed**; a status stage bar.
- **On hold dialog:** "Put {id} on hold", "The work order stays with its technician. Tell the team why the work is paused." Reason presets: Waiting for parts, Waiting for the customer, Site not accessible, Needs a second technician.
- **Left column (≤360 px):**
  - **Details:** Company, Project, Where (At the customer / In the workshop), Type, Priority, Equipment.
  - **Track time:** the same component as the task Time card. An entry edits Start → End and the note inline, then Done. The planned time is the work order's duration.
- **Right column:**
  - **Job:** the job description.
  - **Schedule:** technician, date, start and duration.
  - **Checklist:** the same as the task checklist.
  - **Report and sign-off.**
- **New work order dialog:**
  - fields: Title, Company, Project (or "No project"), Type, Priority (Normal / Urgent), Technician ("Assign later"), Duration;
  - help: "Only people with the Service work type are listed. Leave the technician empty to schedule it later on the dispatch board."

## 7. Dispatch · `#dispatch`
- **Day navigation:** ← Today →. The hint reads "Drag a work order onto a technician's row to schedule it", next to "New work order".
- **Unscheduled lane:** cards with an Urgent badge. Empty: "Everything is scheduled. Drag a work order back here to unschedule it."
- **Timeline:** one row per technician across hour columns. Drag a block to reschedule it, or onto another row to reassign it.

## 8. Technicians · `#techs`
- **Note:** "Work type decides what someone can be given. Office staff get project tasks, service staff get work orders on the dispatch board, and people set to both can get either. It's the same field as on the person's Workforce profile."
- **Columns:** Person, Team, Work type · can be given, Open work.

## 9. Workload report · `#workload`
- A read-only report of remaining task hours per person across open projects, with a link to "Workforce → Planner".
- **Filter:** "Over 40 h".
- **Columns:** Person, then one column per project.

## 10. Settings → Project types · `#boards`
- **Intro:** "A project type is a set of stages for one kind of project, like a funnel in the CRM. Each project is on one board: it shows in that board's columns, and its tasks are grouped by the same stages in the plan. Complete and Cancel are always available and are not stages."
- **Left:** the list of types and "New project type". **Right:** the type name, the Stages list (reorder, rename, delete) with "New stage", and a stage-bar **Preview**.

## 11. Won deal → project · `#crm`
- **Won deal page:**
  - the header shows the "Won · 26 Sep" badge and **New project**, or **Open project** once a project exists;
  - the Project card says "This deal is won. Create a project to plan the work. The company, contact, emails and files are linked to the project.";
  - when linked, the card shows the project name, a status badge, meta, a progress bar and the progress text.
- **"New project from deal" dialog:**
  - text: "The company, contact, emails and files from the deal are linked to the project.";
  - a summary of the won deal;
  - fields: Project name, Project type, Project lead;
  - a Stages preview;
  - the "Add starter tasks from the products" switch;
  - buttons: Cancel, Create project.

## Dialogs
- **New task:**
  - text: "Office work on a project: quotes, calls, admin, follow-ups. It goes into the project plan at its current stage.";
  - fields: Task, Project, Assignee, Due, Estimate (h).

## Interactions
- **Inline editing:** ghost fields look like text until hover (fill) or focus (white with a ring).
- **Toasts:** confirm every action, e.g. "2 h logged on WO-1044.", "Time entry updated · 3 h", "T-12 on hold · Waiting for the client".
- **Recalculation:** every count, bar and total updates immediately (SSE in the app).
- **Hours:** shown as "7.5 h", or as durations "1 h 30 min" on work orders.

## Design tokens
Use the Pultly design system, the same values as v1: Forest `#0D241C`, Green 700 `#14503C`, Green 500 `#2F7A5E`, warn `#B4531B`, danger `#B42318`, border `#E2E8E4`, Onest. Cards are border-led; the only shadow is `--shadow-tile` on kanban cards.
