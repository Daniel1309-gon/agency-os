import { describe, expect, it } from 'vitest';
import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const metadata = { type: 'body' } as ArgumentMetadata;

describe('ZodValidationPipe', () => {
  it('returns the parsed value, not the raw one', () => {
    const pipe = new ZodValidationPipe(z.object({ quantity: z.coerce.number().int(), extra: z.string().default('x') }));
    expect(pipe.transform({ quantity: '3' }, metadata)).toEqual({ quantity: 3, extra: 'x' });
  });

  it('strips fields the schema does not declare', () => {
    // El cliente no puede colar campos que el servicio luego pasaria a un
    // `.values()`: mass assignment via body.
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }));
    expect(pipe.transform({ name: 'ok', roleId: 'admin-role' }, metadata)).toEqual({ name: 'ok' });
  });

  it('raises a 400 with the VALIDATION_ERROR envelope', () => {
    const pipe = new ZodValidationPipe(z.object({ email: z.string().email() }));
    try {
      pipe.transform({ email: 'not-an-email' }, metadata);
      expect.unreachable('the pipe should have rejected the payload');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as { code: string; details: { fieldErrors: Record<string, string[]> } };
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details.fieldErrors.email).toBeDefined();
    }
  });

  it('rejects a payload that is not an object at all', () => {
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }));
    expect(() => pipe.transform(undefined, metadata)).toThrow(BadRequestException);
    expect(() => pipe.transform('nope', metadata)).toThrow(BadRequestException);
  });
});
