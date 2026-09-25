import { BadRequestException, Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { type ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    // Controllers register this pipe at method scope, so Nest invokes it for
    // every argument. Only request payloads belong to the supplied schema;
    // route params, headers, @Req and custom decorators must pass through.
    if (metadata.type !== 'body' && metadata.type !== 'query') return value as T;
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: result.error.flatten(),
      });
    }
    return result.data;
  }
}
