import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPort,
  IsString,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsString()
  NODE_ENV = 'development';

  @IsOptional()
  @IsPort()
  API_PORT = '3001';

  @IsOptional()
  @IsString()
  APP_VERSION = '0.1.0';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_PRIVATE_KEY_PATH!: string;

  @IsString()
  @IsNotEmpty()
  JWT_PUBLIC_KEY_PATH!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL = '15m';

  @IsOptional()
  @IsString()
  JWT_REFRESH_TTL = '7d';

  @IsOptional()
  @IsIn(['true', 'false'])
  COOKIE_SECURE = 'false';

  @IsOptional()
  @IsString()
  COOKIE_DOMAIN = 'localhost';
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }
  return validated;
}
