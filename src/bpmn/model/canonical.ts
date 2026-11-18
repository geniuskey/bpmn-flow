/**
 * Canonical, order-stable representation of a moddle tree used to *prove* that
 * serialization did not lose information: parse(export(model)) must canonicalize
 * to exactly the same value as the model itself.
 *
 * This is a comparison artifact only — the editor never rebuilds models from it.
 */
import { isModdleElement, type GenericElement, type ModdleElement } from './moddle';

export type Canonical =
  string | number | boolean | null | Canonical[] | { [key: string]: Canonical };

function canonicalValue(value: unknown, isReference: boolean): Canonical | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value
      .map((v) => canonicalValue(v, isReference))
      .filter((v): v is Canonical => v !== undefined);
  }
  if (isModdleElement(value)) {
    return isReference ? { $ref: value.id ?? '<anonymous>' } : canonicalize(value);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function sortedRecord(record: Record<string, unknown> | undefined): { [key: string]: Canonical } {
  const out: { [key: string]: Canonical } = {};
  if (!record) return out;
  for (const key of Object.keys(record).sort()) {
    const v = canonicalValue(record[key], false);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export function canonicalize(el: ModdleElement): { [key: string]: Canonical } {
  const out: { [key: string]: Canonical } = { $type: el.$type };
  const record = el as unknown as Record<string, unknown>;
  const descriptor = el.$descriptor;

  if (descriptor && !descriptor.isGeneric) {
    for (const prop of descriptor.properties) {
      if (prop.isVirtual) continue;
      // Only read own values so that defaults do not appear as data.
      if (!Object.prototype.hasOwnProperty.call(record, prop.name)) continue;
      // A value equal to the schema default is not serialized, and means the same.
      const fallback = (prop as { default?: unknown }).default;
      if (fallback !== undefined && String(record[prop.name]) === String(fallback)) continue;
      const v = canonicalValue(record[prop.name], !!prop.isReference);
      if (v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[prop.name] = v;
    }
  } else {
    for (const key of Object.keys(record).sort()) {
      if (key.startsWith('$')) continue;
      const v = canonicalValue(record[key], false);
      if (v !== undefined) out[key] = v;
    }
    const generic = el as GenericElement;
    if (generic.$body !== undefined) out.$body = generic.$body;
    if (generic.$children?.length) {
      out.$children = generic.$children.map((c) => canonicalize(c));
    }
  }

  // Namespace declarations are XML plumbing: the serializer only emits the ones
  // in use, so an unused declaration can disappear without losing any data.
  // xsi:type is redundant with $type.
  const attrs = sortedRecord(
    Object.fromEntries(
      Object.entries(el.$attrs ?? {}).filter(
        // xsi:type is already captured by $type (the serializer derives it from the type).
        ([k]) => k !== 'xmlns' && !k.startsWith('xmlns:') && k !== 'xsi:type',
      ),
    ),
  );
  if (Object.keys(attrs).length) out.$attrs = attrs;
  return out;
}

export function canonicalString(el: ModdleElement): string {
  return JSON.stringify(canonicalize(el));
}

/** Returns human-readable paths where two canonical values differ (capped). */
export function diffCanonical(a: Canonical, b: Canonical, path = '$', limit = 20): string[] {
  const diffs: string[] = [];
  const walk = (x: Canonical | undefined, y: Canonical | undefined, p: string) => {
    if (diffs.length >= limit) return;
    if (x === y) return;
    if (typeof x !== 'object' || typeof y !== 'object' || x === null || y === null) {
      diffs.push(`${p}: ${JSON.stringify(x)} !== ${JSON.stringify(y)}`);
      return;
    }
    if (Array.isArray(x) !== Array.isArray(y)) {
      diffs.push(`${p}: shape mismatch`);
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) diffs.push(`${p}: length ${x.length} !== ${y.length}`);
      for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], `${p}[${i}]`);
      return;
    }
    const xo = x as Record<string, Canonical>;
    const yo = y as Record<string, Canonical>;
    const keys = new Set([...Object.keys(xo), ...Object.keys(yo)]);
    for (const k of [...keys].sort()) walk(xo[k], yo[k], `${p}.${k}`);
  };
  walk(a, b, path);
  return diffs;
}
