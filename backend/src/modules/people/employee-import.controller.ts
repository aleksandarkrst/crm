import { Body, Controller, Get, Header, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { RateLimit } from '../../shared/rate-limit';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { EmployeeImportRequest, EmployeeImportService } from './employee-import.service';

/**
 * Employee import (CD-141, spec 8): the CSV import's three routes for the type "employees", for
 * Administration and Admins (others get 403 from the service, which knows the functional roles).
 * The client sends the file's text as JSON (`{ csv, mapping?, duplicates?, invite? }`); an .xlsx is
 * converted to CSV text in the browser. main.ts gives these routes the import's larger body limit.
 */
@Controller('people/import')
@RequireTenant('member')
export class EmployeeImportController {
  constructor(private readonly imports: EmployeeImportService) {}

  /** A CSV with the column labels the import understands and one example row (the .xlsx template is built from it in the browser). */
  @Get('template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async template(@Tenant() ctx: TenantContext, @Res({ passthrough: true }) res: Response) {
    const csv = await this.imports.template(ctx);
    res.setHeader('Content-Disposition', 'attachment; filename="pultly-employees-template.csv"');
    return csv;
  }

  /** Parses and checks the whole file and writes nothing: mapping, counts, new departments and teams, first rows, errors. */
  @Post('preview')
  @RateLimit('heavy')
  @HttpCode(200)
  preview(@Tenant() ctx: TenantContext, @Body(new ZodPipe(EmployeeImportRequest)) body: EmployeeImportRequest) {
    return this.imports.preview(ctx, body);
  }

  /** Imports: created / updated / skipped / failed (with reasons and cells), new departments and teams, invitations queued. */
  @Post('commit')
  @RateLimit('heavy')
  @HttpCode(200)
  commit(@Tenant() ctx: TenantContext, @Body(new ZodPipe(EmployeeImportRequest)) body: EmployeeImportRequest) {
    return this.imports.commit(ctx, body);
  }
}
