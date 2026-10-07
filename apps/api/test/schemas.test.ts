import { describe, expect, it } from 'vitest';
import {
  CLASSIFY_SCHEMA,
  DOC_FIELDS,
  EXTRACTABLE_TYPES,
  extractionSchema,
} from '../src/extraction/schemas.js';

/** Walks a JSON schema and reports structured-output limit violations. */
function audit(schema: unknown) {
  let unions = 0;
  const problems: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.type) || n.anyOf || n.oneOf) unions += 1;
    for (const k of [
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'maxItems',
      'oneOf',
      'multipleOf',
    ]) {
      if (k in n) problems.push(`${path}: unsupported "${k}"`);
    }
    if (n.type === 'object') {
      if (n.additionalProperties !== false)
        problems.push(`${path}: additionalProperties must be false`);
      const props = Object.keys((n.properties as object) ?? {});
      const required = (n.required as string[]) ?? [];
      for (const p of props) if (!required.includes(p)) problems.push(`${path}.${p}: optional`);
    }
    for (const [k, v] of Object.entries(n)) {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${k}[${i}]`));
      else if (typeof v === 'object') walk(v, `${path}.${k}`);
    }
  };
  walk(schema, '$');
  return { unions, problems };
}

describe('structured-output schemas', () => {
  it.each(EXTRACTABLE_TYPES)('%s schema respects the API limits', (type) => {
    const { unions, problems } = audit(extractionSchema(type));
    expect(problems).toEqual([]);
    expect(unions).toBe(0); // limit is 16 — we use none
  });

  it('classification schema respects the API limits', () => {
    expect(audit(CLASSIFY_SCHEMA)).toEqual({ unions: 0, problems: [] });
  });

  it('extracts exactly the specified fields per document type', () => {
    expect(DOC_FIELDS.application_form).toHaveLength(18);
    expect(DOC_FIELDS.aadhaar).toEqual([
      'name',
      'dob_or_yob',
      'gender',
      'aadhaar_number',
      'address',
    ]);
    expect(DOC_FIELDS.bank_passbook).toEqual([
      'account_holder_name',
      'account_number',
      'ifsc',
      'bank_name',
      'branch',
    ]);
    expect(DOC_FIELDS.epic).toEqual(['name', 'relative_name', 'epic_number', 'dob_or_age']);
    const schema = extractionSchema('epic') as { properties: { fields: { required: string[] } } };
    expect(schema.properties.fields.required).toEqual([...DOC_FIELDS.epic]);
  });
});
