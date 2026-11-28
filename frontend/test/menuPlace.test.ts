// Unit tests of the side a ⋯ menu opens on (settings/parts.tsx FloatMenu): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { menuSide } from '../src/screens/settings/menuPlace.ts';

const view = 900;
/** A 32 px button whose top is at `top`. */
const at = (top: number) => ({ top, bottom: top + 32 });

describe('menuSide, default placement (settings tables)', () => {
  it('opens under the button when there is room under it', () => {
    assert.equal(menuSide(at(300), view), 'below');
  });

  it('opens above near the bottom of the window', () => {
    assert.equal(menuSide(at(700), view), 'above');
  });

  it('stays under the button near the top even when the room under it is short', () => {
    assert.equal(menuSide(at(200), 400), 'below');
  });
});

describe("menuSide, placement 'above' (company page contact rows, CD-534 staging QA case 12)", () => {
  // Two items, as on a contact row: Edit contact, Remove from <company>.
  const twoItems = 80;

  it('opens above the button, as on board C-Company, even with plenty of room under it', () => {
    assert.equal(menuSide(at(300), view, 'above', twoItems), 'above');
  });

  it('opens above as soon as the measured menu fits there', () => {
    assert.equal(menuSide(at(94), view, 'above', twoItems), 'above');
  });

  it('flips under the button when the menu would run past the top of the window (a top row scrolled up)', () => {
    assert.equal(menuSide(at(60), view, 'above', twoItems), 'below');
  });

  it('assumes the max height before the menu is measured', () => {
    assert.equal(menuSide(at(200), view, 'above'), 'below');
    assert.equal(menuSide(at(300), view, 'above'), 'above');
  });

  it('takes the side with more room when it fits on neither', () => {
    assert.equal(menuSide(at(200), 400, 'above', 300), 'above');
    assert.equal(menuSide(at(100), 400, 'above', 300), 'below');
  });
});
