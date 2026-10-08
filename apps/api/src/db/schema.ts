/**
 * Runtime-selected tables. App code imports tables from here; DB_DRIVER picks the SQLite (default)
 * or PostgreSQL definitions. Both expose the same columns and JS value types (Date, boolean, JSON),
 * so the app is typed against the SQLite definitions and runs unchanged on either driver.
 */
import * as sqliteSchema from './schema.sqlite.js';
import * as pgSchema from './schema.pg.js';
import { DB_DRIVER } from './driver.js';

export {
  CASE_SOURCES,
  CASE_STATUSES,
  DETECTED_TYPES,
  DOCUMENT_STATES,
  OFFICER_ROLES,
  PROCESSING_STATES,
  type DetectedType,
  type OfficerRole,
} from './schema.sqlite.js';

const pg = DB_DRIVER === 'postgres';
const pick = <K extends keyof typeof sqliteSchema & keyof typeof pgSchema>(k: K) =>
  (pg ? pgSchema[k] : sqliteSchema[k]) as unknown as (typeof sqliteSchema)[K];

export const cases = pick('cases');
export const documents = pick('documents');
export const extractions = pick('extractions');
export const extractionCache = pick('extractionCache');
export const flags = pick('flags');
export const auditLog = pick('auditLog');
export const nameGazetteer = pick('nameGazetteer');
export const uploadSessions = pick('uploadSessions');
export const sessionFiles = pick('sessionFiles');
export const officers = pick('officers');
