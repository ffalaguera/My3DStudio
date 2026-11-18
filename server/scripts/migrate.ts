import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
const applied = await migrate(db, { local: cfg.LOCAL_AUTH, log: (m) => console.log(m) });
console.log(applied.length ? `${applied.length} migraciones aplicadas` : 'Nada que aplicar');
await db.end();
