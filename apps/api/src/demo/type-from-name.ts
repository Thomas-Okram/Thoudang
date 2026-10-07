import type { ExtractableType } from '../extraction/schemas.js';

/** Best-effort document type from a file name ("aadhar_front.jpg" → aadhaar). null = unknown. */
export function typeFromName(file: string): ExtractableType | null {
  const n = file.toLowerCase();
  if (/form|application/.test(n)) return 'application_form';
  if (/aadhaar|aadhar|uid/.test(n)) return 'aadhaar';
  if (/passbook|bank|cheque/.test(n)) return 'bank_passbook';
  if (/epic|voter/.test(n)) return 'epic';
  return null;
}
