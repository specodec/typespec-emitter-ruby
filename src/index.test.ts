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

describe('generation + compile', () => {
  const ROOT = join(__dir, '..');
  const TSP = join(ROOT, 'node_modules', '.bin', 'tsp');
  const TDIR = join(ROOT, 'tests');
  const GEN = join(TDIR, 'generated');

  it('tsp generates ~200 codec files', () => {
    if (existsSync(GEN)) rmSync(GEN, { recursive: true });
    execSync(`${TSP} compile alltypes.tsp --emit=@specodec/typespec-emitter-ruby --option @specodec/typespec-emitter-ruby.emitter-output-dir=generated`, { cwd: TDIR, stdio: 'pipe' });
    expect(readdirSync(GEN).length).toBeGreaterThanOrEqual(10);
  });
});
