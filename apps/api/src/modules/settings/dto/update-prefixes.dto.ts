import { IsArray, ArrayNotEmpty, IsString } from 'class-validator';

/**
 * PUT /settings/entry-prefixes body. The `^\d{2}$` format rule lives in
 * SettingsService (service-level contract with its own 400 message).
 */
export class UpdatePrefixesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  prefixes!: string[];
}
