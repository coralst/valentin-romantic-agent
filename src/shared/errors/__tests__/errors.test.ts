import { describe, it, expect } from 'vitest';
import {
  AppError,
  ConnectionError,
  LlmError,
  ExtractionError,
  ValidationError,
  SessionError,
  StorageError,
  ContextError,
} from '../index';

const errorSpecs = [
  { Class: ConnectionError, code: 'CONNECTION_ERROR', statusCode: 503 },
  { Class: LlmError, code: 'LLM_ERROR', statusCode: 502 },
  { Class: ExtractionError, code: 'EXTRACTION_ERROR', statusCode: 500 },
  { Class: ValidationError, code: 'VALIDATION_ERROR', statusCode: 400 },
  { Class: SessionError, code: 'SESSION_ERROR', statusCode: 404 },
  { Class: StorageError, code: 'STORAGE_ERROR', statusCode: 500 },
  { Class: ContextError, code: 'CONTEXT_ERROR', statusCode: 500 },
] as const;

describe('error classes', () => {
  for (const { Class, code, statusCode } of errorSpecs) {
    describe(Class.name, () => {
      it(`has code "${code}"`, () => {
        const err = new Class('test');
        expect(err.code).toBe(code);
      });

      it(`has statusCode ${statusCode}`, () => {
        const err = new Class('test');
        expect(err.statusCode).toBe(statusCode);
      });

      it('passes context through constructor', () => {
        const ctx = { userId: '123', action: 'save' };
        const err = new Class('test', ctx);
        expect(err.context).toEqual(ctx);
      });

      it('defaults context to empty object', () => {
        const err = new Class('test');
        expect(err.context).toEqual({});
      });

      it('is an instance of AppError', () => {
        const err = new Class('test');
        expect(err).toBeInstanceOf(AppError);
      });

      it('is an instance of Error', () => {
        const err = new Class('test');
        expect(err).toBeInstanceOf(Error);
      });

      it('has the correct message', () => {
        const err = new Class('something went wrong');
        expect(err.message).toBe('something went wrong');
      });
    });
  }
});
