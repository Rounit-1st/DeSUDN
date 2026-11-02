import * as fs from 'fs/promises';
import * as path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export async function runMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl || process.env.DATABASE_URL || 'postgresql://desudn:desudn_secret@localhost:5432/desudn';
  const pool = new pg.Pool({ connectionString: url });

  console.log(`Connecting to database for migrations: ${url}`);
  try {
    const client = await pool.connect();
    try {
      const migrationsDir = path.resolve(__dirname, 'migrations');
      const files = (await fs.readdir(migrationsDir))
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        console.log(`Executing migration: ${file}`);
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf-8');
        await client.query(sql);
      }
      console.log('All migrations applied successfully.');
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

if (require.main === module || process.argv[1]?.includes('migrate.ts')) {
  runMigrations().catch(() => process.exit(1));
}
