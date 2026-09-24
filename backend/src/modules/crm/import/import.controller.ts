import { Body, Controller, Get, Header, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { IMPORT_TYPES, type ImportType, templateCsv } from './import-fields';
import { ImportRequest, ImportService } from './import.service';

const Type = new ZodPipe(z.enum(IMPORT_TYPES));

/**
 * CSV import (CD-64), owners and admins only. The client sends the file's text as JSON
 * (`{ csv, mapping?, duplicates?, funnelId? }`); main.ts gives these routes a larger body limit.
 */
@Controller('crm/import')
@RequireTenant('admin')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** A CSV with the column headers the import understands and one example row. */
  @Get(':type/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  template(@Param('type', Type) type: ImportType, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', `attachment; filename="cadence-${type}-template.csv"`);
    return templateCsv(type);
  }

  /** Parses and validates the whole file and writes nothing: guessed mapping, first rows, counts. */
  @Post(':type/preview')
  @HttpCode(200)
  preview(@Tenant() ctx: TenantContext, @Param('type', Type) type: ImportType, @Body(new ZodPipe(ImportRequest)) body: ImportRequest) {
    return this.imports.preview(ctx, type, body);
  }

  /** Imports the rows in batches and returns created / updated / skipped / failed, with reasons. */
  @Post(':type/commit')
  @HttpCode(200)
  commit(@Tenant() ctx: TenantContext, @Param('type', Type) type: ImportType, @Body(new ZodPipe(ImportRequest)) body: ImportRequest) {
    return this.imports.commit(ctx, type, body);
  }
}
