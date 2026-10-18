// Unit tests of the shared popover's placement (CD-355): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placePopover } from '../src/components/popoverPlace.ts';

const view = { width: 1280, height: 700 };
const panel = { width: 280, height: 300 };

describe('placePopover (CD-355)', () => {
  it('opens under its anchor when it fits', () => {
    assert.deepEqual(placePopover({ top: 100, bottom: 136, left: 200 }, panel, view), { top: 140, left: 200 });
  });

  it('opens above when there is no room under and more room above', () => {
    assert.deepEqual(placePopover({ top: 600, bottom: 636, left: 200 }, panel, view), { top: 296, left: 200 });
  });

  it('stays inside the window when neither side fits', () => {
    const tall = { width: 280, height: 690 };
    assert.equal(placePopover({ top: 300, bottom: 336, left: 200 }, tall, view).top, 8);
  });

  it('moves left rather than run past the right edge, and never past the left one', () => {
    assert.equal(placePopover({ top: 100, bottom: 136, left: 1200 }, panel, view).left, 1280 - 8 - 280);
    assert.equal(placePopover({ top: 100, bottom: 136, left: -50 }, panel, view).left, 8);
  });
});
