// The hr-documents module's public API (milestone 16, spec 10). Other modules import only from here.
export { HrDocumentsModule, HrDocumentsWorkerModule } from './hr-documents.module';
export { DocumentDataError, type DocumentRenderer, documentRenderers, HrDocumentsService, type QueueInput } from './hr-documents.service';
export { type PdfDocumentSpec, renderPdf, TEMPLATE_VERSION } from './pdf';
