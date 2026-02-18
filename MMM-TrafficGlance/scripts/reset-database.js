#!/usr/bin/env node

/**
 * Database Recovery Tool for MMM-TrafficGlance
 *
 * This script resets/recreates the SQLite database file.
 * Use this when:
 * - Database becomes corrupted
 * - Need to clear all historical data
 * - Troubleshooting database initialization issues
 *
 * Usage:
 *   node scripts/reset-database.js
 *
 * Options:
 *   --backup    Create a backup before resetting (default: true)
 *   --no-backup Skip backup creation
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
const createBackup = !args.includes('--no-backup');

// Database path (relative to module root)
const dbPath = path.join(__dirname, '..', 'traffic.db');
const dbDir = path.dirname(dbPath);

console.log('=== MMM-TrafficGlance Database Recovery Tool ===\n');
console.log(`Database path: ${dbPath}`);
console.log(`Backup enabled: ${createBackup}\n`);

// Check if database exists
const dbExists = fs.existsSync(dbPath);

if (!dbExists) {
    console.log('⚠️  Database file does not exist - will create new database');
} else {
    console.log('✓ Found existing database file');

    // Create backup if requested
    if (createBackup) {
        const timestamp = Date.now();
        const backupPath = `${dbPath}.backup.${timestamp}`;

        try {
            fs.copyFileSync(dbPath, backupPath);
            console.log(`✓ Backup created: ${backupPath}`);

            // Also backup WAL and SHM files if they exist
            const walPath = `${dbPath}-wal`;
            const shmPath = `${dbPath}-shm`;

            if (fs.existsSync(walPath)) {
                fs.copyFileSync(walPath, `${walPath}.backup.${timestamp}`);
                console.log(`✓ WAL file backed up`);
            }

            if (fs.existsSync(shmPath)) {
                fs.copyFileSync(shmPath, `${shmPath}.backup.${timestamp}`);
                console.log(`✓ SHM file backed up`);
            }
        } catch (err) {
            console.error('✗ Backup failed:', err.message);
            console.error('Aborting to prevent data loss');
            process.exit(1);
        }
    }

    // Remove existing database files
    try {
        fs.unlinkSync(dbPath);
        console.log('✓ Removed old database file');

        // Remove WAL and SHM files
        const walPath = `${dbPath}-wal`;
        const shmPath = `${dbPath}-shm`;

        if (fs.existsSync(walPath)) {
            fs.unlinkSync(walPath);
            console.log('✓ Removed WAL file');
        }

        if (fs.existsSync(shmPath)) {
            fs.unlinkSync(shmPath);
            console.log('✓ Removed SHM file');
        }
    } catch (err) {
        console.error('✗ Failed to remove old database:', err.message);
        process.exit(1);
    }
}

console.log('\n--- Creating fresh database ---\n');

// Create fresh database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('✗ Database creation failed:', err.message);
        process.exit(1);
    }

    console.log('✓ Database file created');

    db.serialize(() => {
        // Set PRAGMA settings
        db.run('PRAGMA journal_mode=WAL', (err) => {
            if (err) {
                console.error('✗ Failed to set WAL mode:', err.message);
            } else {
                console.log('✓ WAL mode enabled');
            }
        });

        db.run('PRAGMA synchronous=NORMAL');
        db.run('PRAGMA temp_store=MEMORY');
        db.run('PRAGMA busy_timeout=5000');

        // Create table
        db.run(`CREATE TABLE IF NOT EXISTS traffic_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id TEXT NOT NULL,
            profile TEXT DEFAULT 'default',
            travel_time INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            minute_of_day INTEGER NOT NULL,
            day_of_week INTEGER NOT NULL,
            date_key TEXT
        )`, (err) => {
            if (err) {
                console.error('✗ Table creation failed:', err.message);
                process.exit(1);
            }
            console.log('✓ Table "traffic_history" created');
        });

        // Create indexes
        db.run(`CREATE INDEX IF NOT EXISTS idx_query_optimization
                ON traffic_history (route_id, day_of_week, minute_of_day, timestamp)`, (err) => {
            if (err) {
                console.error('✗ Index creation failed:', err.message);
            } else {
                console.log('✓ Index "idx_query_optimization" created');
            }
        });

        db.run(`CREATE INDEX IF NOT EXISTS idx_sparkline_optimization
                ON traffic_history (route_id, day_of_week, minute_of_day, date_key)`, (err) => {
            if (err) {
                console.error('✗ Index creation failed:', err.message);
            } else {
                console.log('✓ Index "idx_sparkline_optimization" created');
            }
        });

        // Verify table creation
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='traffic_history'", (err, row) => {
            if (err) {
                console.error('✗ Verification failed:', err.message);
                process.exit(1);
            }

            if (!row) {
                console.error('✗ Table verification failed - table does not exist');
                process.exit(1);
            }

            console.log('✓ Database structure verified');

            // Get record count
            db.get('SELECT COUNT(*) as count FROM traffic_history', (err, row) => {
                if (err) {
                    console.error('✗ Count query failed:', err.message);
                } else {
                    console.log(`✓ Current record count: ${row.count}`);
                }

                // Close database
                db.close((err) => {
                    if (err) {
                        console.error('✗ Error closing database:', err.message);
                        process.exit(1);
                    }

                    console.log('\n=== Database reset complete ===');
                    console.log('\nNext steps:');
                    console.log('1. Restart MagicMirror: pm2 restart MagicMirror');
                    console.log('2. Check logs: pm2 logs MagicMirror --lines 50');
                    console.log('3. Wait 10-15 minutes for data to accumulate');
                    console.log('4. Verify sparklines are displaying correctly\n');

                    process.exit(0);
                });
            });
        });
    });
});
