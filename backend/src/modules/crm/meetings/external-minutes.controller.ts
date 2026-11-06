import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { ExternalMinutesService, MinutesEmailRequest, type MinutesPdfFile, SaveExternalMinutes } from './external-minutes.service';

const Id = new ZodPipe(UuidParam);

/** A minutes PDF as a download (`attachment`, never cached). */
function pdfDownload(res: Response, file: MinutesPdfFile): StreamableFile {
  const ascii = file.name.replace(/[^ -~]/g, '_').replace(/"/g, "'");
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(file.content);
}

/**
 * The external minutes of a meeting and their emails to the customer (CD-133). Every member reads
 * the text, the send log and the PDFs (CD-378); writing, previewing, sending and retrying take the meeting's
 * organizer, an internal participant, an admin or the owner (403). Sending needs a held meeting (409).
 */
@Controller('crm/meetings')
@RequireTenant('member')
export class ExternalMinutesController {
  constructor(private readonly minutes: ExternalMinutesService) {}

  /** `{ subject, body, prefilled, updatedAt, updatedByName, language, lastSend, changedSinceLastSend, meetingChanged }`; the first read fills in the template. */
  @Get(':id/minutes/external')
  getExternal(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.minutes.getExternal(ctx, id);
  }

  /** `{ subject?, body? }`; `If-Match: <updatedAt>` (the epoch before the first save) catches conflicting edits. */
  @Put(':id/minutes/external')
  saveExternal(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(SaveExternalMinutes)) body: SaveExternalMinutes, @Headers('if-match') ifMatch?: string) {
    return this.minutes.saveExternal(ctx, id, body, parseVersion(ifMatch));
  }

  /** The template from the internal minutes as they are now: `{ subject, body }`. Nothing is saved; the browser replaces or appends. */
  @Post(':id/minutes/external/copy-internal')
  @HttpCode(200)
  copyInternal(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.minutes.copyInternal(ctx, id);
  }

  /** "Update from meeting" (CD-222): the meeting's date, place and people in the text as they are now. Returns the text. */
  @Post(':id/minutes/external/update-from-meeting')
  @HttpCode(200)
  updateFromMeeting(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.minutes.updateFromMeeting(ctx, id);
  }

  /** "Download PDF" (CD-378): the PDF of the saved text and the current next steps, as a send now would attach it. */
  @Get(':id/minutes/external/pdf')
  async draftPdf(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Res({ passthrough: true }) res: Response) {
    return pdfDownload(res, await this.minutes.draftPdf(ctx, id));
  }

  /** The exact email Send would send: `{ from, replyTo, to, cc, subject, text, html }`. */
  @Post(':id/minutes/preview')
  @HttpCode(200)
  preview(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(MinutesEmailRequest)) body: MinutesEmailRequest) {
    return this.minutes.preview(ctx, id, body);
  }

  /** `{ subject, body, toContactIds, ccUserIds }` → 202 with the send (recipients queued); the worker delivers it. */
  @Post(':id/minutes/send')
  @HttpCode(202)
  send(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(MinutesEmailRequest)) body: MinutesEmailRequest) {
    return this.minutes.send(ctx, id, body);
  }

  /** Every send, newest first, with each recipient's status. */
  @Get(':id/minutes/sends')
  listSends(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.minutes.listSends(ctx, id);
  }

  /** The PDF a send attached (CD-378), the same file every time. */
  @Get(':id/minutes/sends/:sendId/pdf')
  async sendPdf(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('sendId', Id) sendId: string, @Res({ passthrough: true }) res: Response) {
    return pdfDownload(res, await this.minutes.sendPdf(ctx, id, sendId));
  }

  /** Queues the failed recipients of a send again (202). */
  @Post(':id/minutes/sends/:sendId/retry')
  @HttpCode(202)
  retry(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('sendId', Id) sendId: string) {
    return this.minutes.retry(ctx, id, sendId);
  }
}
