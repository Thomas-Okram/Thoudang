import { openDb } from './client.js';
import { env } from '../env.js';

const handle = openDb();
handle.close();
console.log(`Migrations applied to ${env.dbPath}`);
