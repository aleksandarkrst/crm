// Unit tests of the company page's words and checks (CD-534). `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanValue, contactLine, fieldProblem, metaLine, missingToast, opportunitiesLine, readyLine, statusTagText } from '../src/store/companyPage.ts';

describe('the header', () => {
  it('tags the status with how it was set, and sums the lead up under the name', () => {
    assert.equal(statusTagText('lead', false), 'Lead, automatic');
    assert.equal(statusTagText('not_interested', true), 'Not interested, set by hand');
    assert.equal(metaLine('lead', { ready: 5, total: 7 }, 'Nikola Kostić'), '5 of 7 ready, owner Nikola Kostić');
    assert.equal(metaLine('opportunity', { ready: 7, total: 7 }, 'Nikola Kostić'), 'Ready for the Pipeline, owner Nikola Kostić');
    assert.equal(metaLine('client', { ready: 7, total: 7 }, null), 'Ready for the Pipeline, no owner');
    assert.equal(metaLine('not_interested', { ready: 7, total: 7 }, 'Ana'), 'Owner Ana');
    assert.equal(missingToast(['PIB', 'MB']), 'Complete the company first. Missing: PIB, MB.');
    assert.equal(readyLine({ ready: 3, total: 7 }, ['PIB', 'MB', 'Address', 'Activity code']), '3 of 7 ready. Missing: PIB, MB, Address, Activity code.');
    assert.equal(readyLine({ ready: 7, total: 7 }, []), '7 of 7 ready.');
  });
});

describe('the fields', () => {
  it('checks the digits of PIB, MB, postal code and activity code, in the board’s words', () => {
    assert.equal(fieldProblem('pib', '1045'), 'A PIB has 9 digits.');
    assert.equal(fieldProblem('pib', '104 532 873'), null);
    assert.equal(fieldProblem('pib', '104532878'), 'This PIB fails its check digit. Check it for a typo.');
    assert.equal(fieldProblem('mb', '2008469'), 'An MB has 8 digits.');
    assert.equal(fieldProblem('mb', '20084693'), null);
    assert.equal(fieldProblem('postalCode', '2100'), 'A postal code has 5 digits.');
    assert.equal(fieldProblem('postalCode', '21 000'), null);
    assert.equal(fieldProblem('activityCode', '22a3'), 'An activity code has 4 digits.');
    assert.equal(fieldProblem('activityCode', '2223'), null);
    // Empty is allowed (the banner says what is needed), except the name.
    assert.equal(fieldProblem('mb', ''), null);
    assert.equal(fieldProblem('name', '  '), 'A company needs a name.');
    assert.equal(fieldProblem('city', ''), null);
    assert.equal(cleanValue('pib', '104 532 877'), '104532877');
    assert.equal(cleanValue('address', 'Industrijska 2 '), 'Industrijska 2 ');
  });

  it('writes the contact line and the opportunities line', () => {
    assert.equal(contactLine('Plant manager', 'dragana@tarkett.com'), 'Plant manager, dragana@tarkett.com');
    assert.equal(contactLine('', '—'), 'No title or email yet');
    assert.equal(opportunitiesLine('lead', 0), 'None. Leads cannot have one.');
    assert.equal(opportunitiesLine('lead', 1), '1 opportunity');
    assert.equal(opportunitiesLine('opportunity', 0), 'None yet');
    assert.equal(opportunitiesLine('client', 3), '3 opportunities');
  });
});
