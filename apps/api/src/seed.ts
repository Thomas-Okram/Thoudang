import { openDb } from './db/client.js';
import { seedGazetteer } from './db/seedGazetteer.js';

const { db, close, location } = await openDb();
const n = await seedGazetteer(db);
await close();
console.log(`Seeded ${n} gazetteer entries into ${location}`);
