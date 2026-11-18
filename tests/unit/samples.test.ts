import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixture } from '../helpers';

const samplesDir = fileURLToPath(new URL('../../public/samples/', import.meta.url));

describe('bundled samples', () => {
  it.each(readdirSync(samplesDir))('%s matches its test fixture', (name) => {
    expect(readFileSync(samplesDir + name, 'utf8')).toBe(fixture(name));
  });
});
