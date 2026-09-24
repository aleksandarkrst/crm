import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { activities, companies, contacts, dealDocuments, dealLines, deals, documentTemplates, funnels, funnelStages, products, tenants, users } from '../../../shared/database/schema';
import { renderTemplate, TemplateFileError } from './docx';
import { documentKey } from './documents.service';
import { buildTemplateData, type DocumentSource, missingFields } from './placeholders';

/**
 * Runs in the worker for `crm.generate-document`: fills the document's template with its deal's
 * data, stores the .docx, marks the document ready and writes a timeline entry on the deal. A
 * failure marks the document failed with a readable reason instead of retrying (a broken template
 * fails the same way every time).
 */
@Injectable()
export class DocumentGenerator {
  private readonly logger = new Logger(DocumentGenerator.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  async run(tenantId: string, documentId: string): Promise<void> {
    const job = await this.database.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .update(dealDocuments)
        .set({ status: 'running', error: null })
        .where(and(eq(dealDocuments.id, documentId), eq(dealDocuments.status, 'queued')))
        .returning();
      if (!doc) return null; // deleted meanwhile, or already handled
      const [template] = doc.templateId ? await tx.select({ key: documentTemplates.storageKey }).from(documentTemplates).where(eq(documentTemplates.id, doc.templateId)) : [];
      return { doc, templateKey: template?.key ?? null };
    });
    if (!job) return;
    const { doc } = job;

    try {
      if (!job.templateKey) throw new TemplateFileError('The template was deleted before the document was generated.');
      const template = await this.storage.getBuffer(tenantId, job.templateKey).catch(() => {
        throw new TemplateFileError('The template file is missing from storage.');
      });
      const source = await this.database.withTenant(tenantId, (tx) => loadSource(tx, tenantId, doc.dealId));
      if (!source) throw new TemplateFileError('The deal no longer exists.');
      const data = buildTemplateData(source);
      const rendered = renderTemplate(template, data);
      const missing = missingFields(rendered.tags, data);
      const key = documentKey(doc.id);
      await this.storage.putBuffer(tenantId, key, rendered.file);

      const saved = await this.database.withTenant(tenantId, async (tx) => {
        const [row] = await tx
          .update(dealDocuments)
          .set({ status: 'ready', storageKey: key, sizeBytes: rendered.file.length, missingFields: missing, completedAt: new Date() })
          .where(eq(dealDocuments.id, doc.id))
          .returning({ id: dealDocuments.id });
        if (!row) return false;
        const by = doc.createdByUserId ? (await tx.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, doc.createdByUserId)))[0] : undefined;
        const detail = [`From the template "${doc.templateName}"${by ? ` by ${by.name || by.email}` : ''}.`, missing.length ? `Left empty: ${missing.join(', ')}.` : ''].filter(Boolean).join(' ');
        await tx.insert(activities).values({ tenantId, dealId: doc.dealId, actorUserId: doc.createdByUserId, channel: 'NT', title: `Document generated · ${doc.name}`, detail });
        return true;
      });
      // Deleted while it was being generated: don't leave the file behind.
      if (!saved) await this.storage.delete(tenantId, key);
    } catch (err) {
      const message = err instanceof TemplateFileError ? err.message : 'Something went wrong while generating the document. Try again.';
      if (!(err instanceof TemplateFileError)) this.logger.error(err, `Generating document ${doc.id} failed`);
      await this.database.withTenant(tenantId, (tx) =>
        tx.update(dealDocuments).set({ status: 'failed', error: message, completedAt: new Date() }).where(eq(dealDocuments.id, doc.id)),
      );
    }
  }
}

/** Everything the merge fields need, read with the tenant set (RLS applies). */
async function loadSource(tx: Tx, tenantId: string, dealId: string): Promise<DocumentSource | null> {
  const [row] = await tx
    .select({ deal: deals, stage: funnelStages.name, funnel: funnels.label })
    .from(deals)
    .leftJoin(funnelStages, and(eq(funnelStages.tenantId, deals.tenantId), eq(funnelStages.id, deals.stageId)))
    .leftJoin(funnels, and(eq(funnels.tenantId, deals.tenantId), eq(funnels.id, deals.funnelId)))
    .where(eq(deals.id, dealId));
  if (!row) return null;
  const { deal } = row;
  const [workspace] = await tx.select({ name: tenants.name, currency: tenants.currency, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  const [company] = deal.companyId ? await tx.select().from(companies).where(eq(companies.id, deal.companyId)) : [];
  const [contact] = deal.primaryContactId ? await tx.select().from(contacts).where(eq(contacts.id, deal.primaryContactId)) : [];
  const [owner] = deal.ownerUserId ? await tx.select().from(users).where(eq(users.id, deal.ownerUserId)) : [];
  const lines = await tx
    .select({ line: dealLines, product: products.name, billingKind: products.billingKind })
    .from(dealLines)
    .leftJoin(products, and(eq(products.tenantId, dealLines.tenantId), eq(products.id, dealLines.productId)))
    .where(eq(dealLines.dealId, dealId))
    .orderBy(asc(dealLines.position), asc(dealLines.createdAt));

  return {
    workspace: workspace ?? { name: '', currency: deal.currency, timezone: 'UTC' },
    deal: {
      title: deal.title,
      headline: deal.headline,
      amount: deal.amount,
      currency: deal.currency,
      closeDate: deal.closeDate,
      source: deal.source,
      stage: row.stage,
      funnel: row.funnel,
      need: deal.need,
      constraint: deal.constraint,
      decisionMaker: deal.decisionMaker,
      discoveryDate: deal.discoveryDate,
    },
    company: company ? { name: company.name, industry: company.industry, hq: company.hq, domain: company.domain } : null,
    contact: contact ? { fullName: contact.fullName, jobTitle: contact.jobTitle, email: contact.email, phone: contact.phone } : null,
    owner: owner ? { name: owner.displayName, email: owner.email, jobTitle: owner.jobTitle, phone: owner.phone } : null,
    lines: lines.map(({ line, product, billingKind }) => ({
      product,
      billingKind,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      schedule: line.schedule,
      startDate: line.startDate,
    })),
    now: new Date(),
  };
}
