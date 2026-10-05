import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ScopeType } from '../../../generated/prisma/client';

export class AssignRoleDto {
  @IsString()
  @IsNotEmpty()
  roleId!: string;

  @IsEnum(ScopeType)
  scopeType!: ScopeType;

  @IsOptional()
  @IsString()
  scopeId?: string;
}
