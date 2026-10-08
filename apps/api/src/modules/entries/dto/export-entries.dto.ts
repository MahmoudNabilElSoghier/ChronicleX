import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListEntriesDto } from './list-entries.dto';

/**
 * POST /entries/export body.
 *
 * Structural checks live on the fields: mode='selected' → entryIds must be
 * a non-empty array of ≤5000 strings (IsArray fails when missing, so
 * both-empty is rejected here too); mode='filtered' → filters required
 * (nested ListEntriesDto). The "forbids" half of the cross-mode rule
 * (entryIds alongside filtered / filters alongside selected) is checked
 * in EntriesService.export(), where the error message can name both fields.
 *
 * `format` is vestigial ('csv' only — 'pdf' never ships): kept optional so
 * older clients sending format:'csv' keep working, while format:'pdf' now
 * fails validation with a clear 400 (the PDF report was replaced by the
 * ZIP bundle endpoint).
 */
export class ExportEntriesDto {
  @IsIn(['selected', 'filtered'])
  mode!: 'selected' | 'filtered';

  @ValidateIf((o: { mode?: string }) => o.mode === 'selected')
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  entryIds?: string[];

  @ValidateIf((o: { mode?: string }) => o.mode === 'filtered')
  @ValidateNested()
  @Type(() => ListEntriesDto)
  filters?: ListEntriesDto;

  @IsOptional()
  @IsIn(['csv'])
  format?: 'csv';
}
