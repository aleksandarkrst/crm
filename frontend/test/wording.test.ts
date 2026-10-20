// Visible wording left over from the Deal → Opportunity rename (CD-356).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importTemplateLink, mergeFieldGroupHeading, mergeFieldReference, opportunityCopy } from '../src/store/wording.ts';

describe('import dialog', () => {
  it('names the opportunities template the same way as the other record types', () => {
    assert.equal(importTemplateLink('companies'), 'Download the companies template');
    assert.equal(importTemplateLink('contacts'), 'Download the contacts template');
    assert.equal(importTemplateLink('deals'), 'Download the opportunities template');
    assert.equal(importTemplateLink('products'), 'Download the products template');
  });
});

describe('document template merge fields', () => {
  it('renames the group heading and the descriptions, and leaves other groups', () => {
    assert.equal(mergeFieldGroupHeading('Deal'), 'Opportunity');
    assert.equal(mergeFieldGroupHeading('Deal lines'), 'Opportunity lines · inside {{#lines}}');
    assert.equal(mergeFieldGroupHeading('Company'), 'Company');
    assert.equal(mergeFieldGroupHeading('Owner'), 'Owner');
  });

  it('renames the descriptions the API still sends', () => {
    assert.equal(opportunityCopy('Deal title'), 'Opportunity title');
    assert.equal(opportunityCopy('Proposal headline (the deal title when empty)'), 'Proposal headline (the opportunity title when empty)');
    assert.equal(opportunityCopy('Deal value without tax, in the deal currency'), 'Opportunity value without tax, in the opportunity currency');
    assert.equal(opportunityCopy('Tax on the deal'), 'Tax on the opportunity');
    assert.equal(opportunityCopy('Deal discount on one-time products'), 'Opportunity discount on one-time products');
    assert.equal(opportunityCopy('Deal owner'), 'Opportunity owner');
    assert.equal(opportunityCopy('Deal lines'), 'Opportunity lines');
    assert.equal(opportunityCopy('Total with tax'), 'Total with tax');
  });

  it('renders the opportunity description beside the unchanged merge token', () => {
    assert.deepEqual(mergeFieldReference('deal.title', 'Deal title'), { token: '{{deal.title}}', description: 'Opportunity title' });
    assert.deepEqual(mergeFieldReference('deal.headline', 'Proposal headline (the deal title when empty)'), {
      token: '{{deal.headline}}',
      description: 'Proposal headline (the opportunity title when empty)',
    });
    assert.deepEqual(mergeFieldReference('deal.amount', 'Deal value without tax, in the deal currency'), {
      token: '{{deal.amount}}',
      description: 'Opportunity value without tax, in the opportunity currency',
    });
    assert.deepEqual(mergeFieldReference('owner.name', 'Deal owner'), { token: '{{owner.name}}', description: 'Opportunity owner' });
  });
});
