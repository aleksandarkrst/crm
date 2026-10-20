// Company ids in the forms (CD-357): `npm test` in frontend. Same numbers as the backend's spec.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkActivityCode, checkMb, checkPib, mbValid, pibProblem, pibValid } from '../src/lib/serbianIds.ts';


describe('Serbian company ids (CD-357)', () => {
  it('PIB check digit', () => {
    assert.equal(pibValid('104052135'), true);
    assert.equal(pibValid('104052136'), false);
    assert.equal(pibValid('10405213'), false);
  });

  it('says what is wrong with a PIB', () => {
    assert.equal(pibProblem(''), 'The PIB is required.');
    assert.equal(pibProblem('10453287'), 'A PIB has 9 digits; this one has 8.');
    assert.equal(pibProblem('1045x2877'), 'A PIB has digits only.');
    assert.match(pibProblem('104052136')!, /check digit/);
    assert.equal(pibProblem('104 052 135'), null);
  });

  it('checkPib drops spaces and never accepts empty', () => {
    assert.deepEqual(checkPib(' 104 052 135 '), { ok: true, value: '104052135' });
    assert.equal(checkPib('').ok, false);
  });

  it('MB and activity code: optional, checked when filled', () => {
    assert.equal(mbValid('20084693'), true);
    assert.deepEqual(checkMb(''), { ok: true, value: '' });
    assert.equal(checkMb('20084694').ok, false);
    assert.deepEqual(checkActivityCode('6201'), { ok: true, value: '6201' });
    assert.equal(checkActivityCode('62011').ok, false);
  });
});
