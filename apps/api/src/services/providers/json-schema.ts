import { z } from 'zod';

/**
 * Converts the JSON-schema subset Thoudang's wire schemas use (object, string + enum, number,
 * integer, boolean, array, local $defs/$ref) into a zod validator.
 *
 * Needed on providers without structured outputs (Bedrock India): the model is asked for JSON
 * in plain text, so the response must be checked against the same schema the Anthropic API
 * would have enforced. `additionalProperties: false` becomes a strict object, matching the
 * grammar-constrained behaviour; keywords outside the subset are accepted unchecked.
 */
type Schema = Record<string, unknown>;

export function jsonSchemaToZod(schema: Schema): z.ZodType {
  const defs = (schema.$defs ?? {}) as Record<string, Schema>;
  const seen = new Map<string, z.ZodType>();

  const convert = (node: Schema): z.ZodType => {
    if (typeof node.$ref === 'string') {
      const name = node.$ref.replace(/^#\/\$defs\//, '');
      const cached = seen.get(name);
      if (cached) return cached;
      const target = defs[name];
      if (!target) throw new Error(`Unresolvable $ref ${node.$ref}`);
      const out = convert(target);
      seen.set(name, out);
      return out;
    }
    if (Array.isArray(node.enum) && node.enum.every((v) => typeof v === 'string')) {
      const values = node.enum as string[];
      return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.never();
    }
    switch (node.type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'integer':
        return z.number().int();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(node.items ? convert(node.items as Schema) : z.unknown());
      case 'object': {
        const props = (node.properties ?? {}) as Record<string, Schema>;
        const required = new Set((node.required ?? []) as string[]);
        const shape = Object.fromEntries(
          Object.entries(props).map(([key, child]) => {
            const v = convert(child);
            return [key, required.has(key) ? v : v.optional()];
          }),
        );
        const obj = z.object(shape);
        return node.additionalProperties === false ? obj.strict() : obj.passthrough();
      }
      default:
        return z.unknown();
    }
  };

  return convert(schema);
}
