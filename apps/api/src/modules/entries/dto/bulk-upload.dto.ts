import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class BulkUploadDto {
  @IsString()
  @IsNotEmpty()
  companyId!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

/**
 * Pre-flight conflict check for bulk uploads: parses filenames and checks
 * duplicate serials (scoped to company+year) and duplicate hashes (global)
 * WITHOUT staging any file. Lets the UI show real validity instead of a
 * filename-only "valid" guess.
 */
export class PreviewBulkDto {
  @IsString()
  @IsNotEmpty()
  companyId!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  fileNames!: string[];

  // Parallel to fileNames (same index). Optional: hash collisions are a
  // bonus check; without it, duplicates are only caught at processing time.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  fileHashes?: string[];
}
