import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/**
 * Catalog mutations. Codes are write-once: company.code is embedded in
 * MinIO fileKeys and project.code is part of the serial convention, so
 * update DTOs intentionally expose names only — the global
 * forbidNonWhitelisted pipe turns any `code` in a PATCH into a 400.
 */
export class CreateCompanyDto {
  @IsInt()
  @Min(1)
  code!: number;

  @IsString()
  @IsNotEmpty()
  nameAr!: string;

  @IsString()
  @IsNotEmpty()
  nameEn!: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nameAr?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nameEn?: string;
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  nameAr!: string;

  @IsString()
  @IsNotEmpty()
  nameEn!: string;

  @IsString()
  @IsNotEmpty()
  companyId!: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nameAr?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nameEn?: string;
}
