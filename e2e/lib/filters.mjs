// Driving the shared filter row (CD-366) from the browser tests: chips by field id, options by value.
import { click, setValue } from './harness.mjs';

const pop = (id) => `[data-testid="filter-pop-${id}"]`;

/** Opens a chip's popover (does nothing when it is open already). */
export async function openChip(page, id) {
  if (await page.$(pop(id))) return;
  await click(page, `[data-testid="filter-chip-${id}"]`);
  await page.waitForSelector(pop(id));
}

/** Closes whatever popover is open (Escape). */
export async function closePopover(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.fr-pop'));
}

/** Ticks (or unticks) an option of a list, person, date or yes / no chip by its value (an id, a preset). */
export async function pickOption(page, id, value) {
  await openChip(page, id);
  await click(page, `${pop(id)} [data-testid="filter-option"][data-value="${value}"]`);
}

/** The option values ticked in a chip's popover. */
export async function ticked(page, id) {
  await openChip(page, id);
  return page.$$eval(`${pop(id)} [data-testid="filter-option"][aria-pressed="true"]`, (els) => els.map((el) => el.dataset.value));
}

/** "is" / "is not" (lists), "contains" / "is empty" / "is not empty" (texts). */
export async function setOp(page, id, op) {
  await openChip(page, id);
  await click(page, `${pop(id)} [data-testid="filter-op-${op}"]`);
}

/** Types into a text chip's "contains" field. */
export async function typeText(page, id, value) {
  await openChip(page, id);
  await setValue(page, `${pop(id)} input:not([aria-label=Search])`, value);
}

/** Sets a number chip's At least / At most. */
export async function setRange(page, id, { min, max }) {
  await openChip(page, id);
  const inputs = `${pop(id)} input[inputmode=numeric]`;
  await page.waitForSelector(inputs);
  if (min !== undefined) await setNth(page, inputs, 0, min);
  if (max !== undefined) await setNth(page, inputs, 1, max);
}

/** + Filter → the field (its popover opens). */
export async function addFilter(page, id) {
  await click(page, '[data-testid="filter-add"]');
  await click(page, `[data-testid="filter-field-${id}"]`);
  await page.waitForSelector(pop(id));
}

/** Which fields + Filter offers (their ids), then closes it. */
export async function offeredFields(page) {
  await click(page, '[data-testid="filter-add"]');
  await page.waitForSelector('[data-testid="filter-add-pop"]');
  const ids = await page.$$eval('[data-testid^="filter-field-"]', (els) => els.map((el) => el.dataset.testid.slice('filter-field-'.length)));
  await closePopover(page);
  return ids;
}

/** A chip's text: "Status is not Lost", "Salesperson Me". */
export const chipText = (page, id) => page.$eval(`[data-testid="filter-chip-${id}"]`, (el) => el.innerText.replace(/\s+/g, ' ').trim());

/** The ids of the chips on the row, in order. */
export const chips = (page) => page.$$eval('[data-testid^="filter-chip-"]', (els) => els.map((el) => el.dataset.testid.slice('filter-chip-'.length)));

/** The row's Clear filters. */
export async function clearFilters(page) {
  if (await page.$('.fr-pop')) await closePopover(page);
  await click(page, '[data-testid="filter-clear"]');
}

function setNth(page, selector, n, value) {
  return page.$$eval(
    selector,
    (els, n, value) => {
      const el = els[n];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    n,
    value,
  );
}
