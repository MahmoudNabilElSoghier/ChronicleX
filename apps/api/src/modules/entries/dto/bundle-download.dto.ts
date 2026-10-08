import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ListEntriesDto } from './list-entries.dto';

/**
 * POST /entries/bundle-download body.
 *
 * Same structural shape as ExportEntriesDto (mode/entryIds/filters with the
 * same "exactly one side" rule enforced in EntriesService.bundleDownload(),
 * where the error messages can name both fields). The hard caps — 1,000
 * entries and 500 MB — are NOT class-validator constraints here: the 1,000
 * cap must cover BOTH the requested ids and the rows the filters actually
 * match, and both produce one exact service-level message.
 */
export class BundleDownloadDto {
  @IsIn(['selected', 'filtered'])
  mode!: 'selected' | 'filtered';

  @ValidateIf((o: { mode?: string }) => o.mode === 'selected')
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  entryIds?: string[];

  @ValidateIf((o: { mode?: string }) => o.mode === 'filtered')
  @ValidateNested()
  @Type(() => ListEntriesDto)
  filters?: ListEntriesDto;
}
