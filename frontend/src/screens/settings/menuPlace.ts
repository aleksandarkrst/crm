// Which side of its button a ⋯ menu opens on (`FloatMenu` in parts.tsx): pure, so it is unit-tested
// (test/menuPlace.test.ts).

/** Under or above its button. */
export type MenuPlacement = 'below' | 'above';

/** The gap between the button and the menu. */
export const MENU_GAP = 6;
/** The menu stays this far inside the window. */
const MARGIN = 8;
/** The room the default placement wants under the button before it opens above (a menu's max height and the gap). */
const ROOM = 280;
/** A menu's max height (`.gs-menu`), used before it has been measured. */
const MAX_HEIGHT = 260;

/**
 * The side a menu opens on. `below` (the default, every settings table): under the button unless there are less than
 * 280 px under it and at least 280 px above. `above` (the company page's contact rows, board C-Company, CD-534 staging
 * QA case 12): above the button when the menu fits there, else under it when it fits there, else where there is more room.
 */
export function menuSide(anchor: { top: number; bottom: number }, viewHeight: number, placement: MenuPlacement = 'below', menuHeight?: number): MenuPlacement {
  const roomBelow = viewHeight - anchor.bottom;
  if (placement === 'below') return roomBelow > ROOM || anchor.top < ROOM ? 'below' : 'above';
  const need = (menuHeight ?? MAX_HEIGHT) + MENU_GAP + MARGIN;
  if (anchor.top >= need) return 'above';
  if (roomBelow >= need) return 'below';
  return anchor.top > roomBelow ? 'above' : 'below';
}
