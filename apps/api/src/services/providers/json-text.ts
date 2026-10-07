/**
 * JSON-in-text helpers for providers without structured outputs (Bedrock India profile).
 */

/** Appended to the system prompt: the schema the Anthropic path would enforce natively. */
export function jsonOnlyInstructions(schema: Record<string, unknown>): string {
  return [
    'OUTPUT FORMAT',
    'Reply with ONLY one JSON object that conforms exactly to the JSON Schema below.',
    'No prose before or after it, no markdown code fences, no comments.',
    'Include every required property; do not add properties the schema does not define.',
    'Use only the listed enum values.',
    '',
    JSON.stringify(schema),
  ].join('\n');
}

/**
 * Pulls the JSON object out of a model reply: bare JSON, a ```json fence, or the outermost
 * {...} span inside surrounding prose. Returns null when there is no object at all.
 */
export function extractJsonText(text: string): string | null {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = (fence?.[1] ?? trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/** Second user turn sent once when the first reply was unusable. */
export function repairPrompt(problem: string): string {
  return [
    'Your previous reply could not be used: ' + problem,
    'Reply again with ONLY the corrected JSON object that conforms to the schema in the',
    'system prompt. Re-read the image; do not invent values you cannot see.',
  ].join('\n');
}
