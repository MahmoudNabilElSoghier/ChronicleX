import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateEntryDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
