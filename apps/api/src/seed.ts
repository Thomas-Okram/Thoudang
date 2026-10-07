import { env } from './env.js';
import { openDb } from './db/client.js';
import { seedGazetteer } from './db/seedGazetteer.js';

const { db, close } = openDb();
const n = seedGazetteer(db);
close();
console.log(`Seeded ${n} gazetteer entries into ${env.dbPath}`);
