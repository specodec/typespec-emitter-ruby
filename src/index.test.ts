import { fileURLToPath } from 'url';
const __dir = dirname(fileURLToPath(import.meta.url));
import { join, dirname } from 'path';
import { existsSync, readdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import { mkScalar, mkArray } from '@specodec/typespec-emitter-core/test-utils';
import { rbsType, readExpr, writeExpr, writeLines, defaultValue } from './index.js';

describe('rbsType', () => {
  it('string → String', () => expect(rbsType(mkScalar('string') as any)).toBe('String'));
  it('boolean → bool', () => expect(rbsType(mkScalar('boolean') as any)).toBe('bool'));
  it('int32 → Integer', () => expect(rbsType(mkScalar('int32') as any)).toBe('Integer'));
  it('int64 → Integer', () => expect(rbsType(mkScalar('int64') as any)).toBe('Integer'));
  it('float32 → Float', () => expect(rbsType(mkScalar('float32') as any)).toBe('Float'));
  it('float64 → Float', () => expect(rbsType(mkScalar('float64') as any)).toBe('Float'));
  it('bytes → String', () => expect(rbsType(mkScalar('bytes') as any)).toBe('String'));
  it('model → model name', () => expect(rbsType({ kind: 'Model', name: 'User' } as any)).toBe('User'));
});

describe('readExpr', () => {
  it('int32', () => expect(readExpr(mkScalar('int32') as any)).toContain('read_int32'));
  it('string', () => expect(readExpr(mkScalar('string') as any)).toContain('read_string'));
  it('bool', () => expect(readExpr(mkScalar('boolean') as any)).toContain('read_bool'));
  it('float32', () => expect(readExpr(mkScalar('float32') as any)).toContain('read_float32'));
  it('bytes', () => expect(readExpr(mkScalar('bytes') as any)).toContain('read_bytes'));
});



describe('generated code compiles', () => {
  const GEN = join(__dir, '..', 'tests', 'generated');
  
  it('syntax check: ruby -c', () => {
    for (const f of readdirSync(GEN).filter(f => f.endsWith('.rb'))) {
      execSync(`ruby -c ${join(GEN, f)}`, { stdio: 'pipe' });
    }
  });
});
