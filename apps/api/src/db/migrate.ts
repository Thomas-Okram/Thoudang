import { openDb } from './client.js';

const handle = await openDb();
await handle.close();
console.log(`Migrations applied to ${handle.location}`);
