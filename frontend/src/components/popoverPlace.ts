// Where the shared Popover (CD-355) puts a panel: pure, so it is unit-tested (test/popoverPlace.test.ts).
const GAP = 4;
const MARGIN = 8;

/**
 * Where a panel goes for its anchor (pure, unit-tested): under it when it fits, above when there's
 * more room there, and always inside the window by `MARGIN`; left-aligned with the anchor unless
 * that would run past the right edge.
 */
export function placePopover(anchor: { top: number; bottom: number; left: number }, panel: { width: number; height: number }, view: { width: number; height: number }): { top: number; left: number } {
  const below = anchor.bottom + GAP;
  const fitsBelow = below + panel.height <= view.height - MARGIN;
  const spaceAbove = anchor.top - GAP - MARGIN;
  const top = fitsBelow || spaceAbove < panel.height ? Math.min(below, Math.max(MARGIN, view.height - MARGIN - panel.height)) : anchor.top - GAP - panel.height;
  const left = Math.max(MARGIN, Math.min(anchor.left, view.width - MARGIN - panel.width));
  return { top: Math.max(MARGIN, top), left };
}
