#!/usr/bin/env node

/**
 * Database Diagnostic Tool for MMM-TrafficGlance
 *
 * This script diagnoses database issues and provides troubleshooting information.
 *
 * Usage:
 *   node scripts/diagnose-database.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Database path (relative to module root)
const dbPath = path.join(__dirname, '..', 'traffic.db');
const dbDir = path.dirname(dbPath);

console.log('=== MMM-TrafficGlance Database Diagnostic Tool ===\n');

// Check 1: Database file exists
console.log('1. Checking database file...');
const dbExists = fs.existsSync(dbPath);

if (!dbExists) {
    console.log('   ✗ Database file does not exist');
    console.log(`   Expected location: ${dbPath}`);
    console.log('\n   SOLUTION: Database needs to be created.');
    console.log('   The database should be created automatically when MagicMirror starts.');
    console.log('   To manually create it, run: node scripts/reset-database.js\n');
    process.exit(1);
} else {
    const stats = fs.statSync(dbPath);
    console.log('   ✓ Database file exists');
    console.log(`   Location: ${dbPath}`);
    console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`   Last modified: ${stats.mtime.toLocaleString()}`);
}

// Check 2: WAL files
console.log('\n2. Checking WAL mode files...');
const walPath = `${dbPath}-wal`;
const shmPath = `${dbPath}-shm`;

if (fs.existsSync(walPath)) {
    const walStats = fs.statSync(walPath);
    console.log(`   ✓ WAL file exists (${(walStats.size / 1024).toFixed(2)} KB)`);
} else {
    console.log('   ⚠ WAL file not found (may not be created yet)');
}

if (fs.existsSync(shmPath)) {
    console.log('   ✓ Shared memory file exists');
} else {
    console.log('   ⚠ Shared memory file not found (may not be created yet)');
}

// Check 3: sqlite3 module
console.log('\n3. Checking sqlite3 module...');
try {
    const sqlite3Version = require('sqlite3/package.json').version;
    console.log(`   ✓ sqlite3 module installed (version ${sqlite3Version})`);
} catch (err) {
    console.log('   ✗ sqlite3 module not found');
    console.log('\n   SOLUTION: Install sqlite3');
    console.log('   Run: cd MMM-TrafficGlance && npm install\n');
    process.exit(1);
}

// Check 4: Database connection
console.log('\n4. Testing database connection...');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.log('   ✗ Cannot connect to database:', err.message);
        console.log('\n   SOLUTION: Database file may be corrupted');
        console.log('   Run: node scripts/reset-database.js\n');
        process.exit(1);
    }

    console.log('   ✓ Database connection successful');

    // Check 5: Table structure
    console.log('\n5. Verifying table structure...');
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='traffic_history'", (err, row) => {
        if (err) {
            console.log('   ✗ Error querying tables:', err.message);
            db.close();
            process.exit(1);
        }

        if (!row) {
            console.log('   ✗ Table "traffic_history" does not exist');
            console.log('\n   SOLUTION: Recreate database schema');
            console.log('   Run: node scripts/reset-database.js\n');
            db.close();
            process.exit(1);
        }

        console.log('   ✓ Table "traffic_history" exists');

        // Check indexes
        db.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='traffic_history'", (err, indexes) => {
            if (err) {
                console.log('   ⚠ Error querying indexes:', err.message);
            } else {
                console.log(`   ✓ Found ${indexes.length} indexes`);
                indexes.forEach(idx => {
                    console.log(`     - ${idx.name}`);
                });
            }

            // Check 6: Data statistics
            console.log('\n6. Analyzing data...');
            db.get('SELECT COUNT(*) as count FROM traffic_history', (err, row) => {
                if (err) {
                    console.log('   ✗ Error counting records:', err.message);
                } else {
                    console.log(`   ✓ Total records: ${row.count}`);

                    if (row.count === 0) {
                        console.log('   ⚠ Database is empty - no historical data yet');
                        console.log('     This is normal for a new installation.');
                        console.log('     Data will accumulate after MagicMirror runs for a while.');
                    }
                }

                // Get record count by route
                db.all('SELECT route_id, COUNT(*) as count FROM traffic_history GROUP BY route_id ORDER BY count DESC', (err, routes) => {
                    if (err) {
                        console.log('   ⚠ Error counting routes:', err.message);
                    } else if (routes.length > 0) {
                        console.log('\n   Records per route:');
                        routes.forEach(r => {
                            console.log(`     - ${r.route_id}: ${r.count} records`);
                        });
                    }

                    // Get timestamp range
                    db.get('SELECT MIN(timestamp) as first, MAX(timestamp) as last FROM traffic_history', (err, row) => {
                        if (err) {
                            console.log('   ⚠ Error getting timestamp range:', err.message);
                        } else if (row.first && row.last) {
                            const firstDate = new Date(row.first * 1000);
                            const lastDate = new Date(row.last * 1000);
                            const daysDiff = Math.floor((row.last - row.first) / 86400);

                            console.log('\n   Data time range:');
                            console.log(`     First record: ${firstDate.toLocaleString()}`);
                            console.log(`     Last record: ${lastDate.toLocaleString()}`);
                            console.log(`     Span: ${daysDiff} days`);
                        }

                        // Check 7: PRAGMA settings
                        console.log('\n7. Checking database configuration...');
                        db.get('PRAGMA journal_mode', (err, row) => {
                            if (!err && row) {
                                const mode = Object.values(row)[0];
                                if (mode === 'wal') {
                                    console.log('   ✓ WAL mode enabled');
                                } else {
                                    console.log(`   ⚠ Journal mode is ${mode} (expected: wal)`);
                                }
                            }

                            db.get('PRAGMA synchronous', (err, row) => {
                                if (!err && row) {
                                    const sync = Object.values(row)[0];
                                    console.log(`   ✓ Synchronous mode: ${sync}`);
                                }

                                // Final summary
                                console.log('\n=== Diagnostic Complete ===\n');
                                console.log('Database appears to be healthy.');
                                console.log('\nNext steps:');
                                console.log('1. Check MagicMirror logs: pm2 logs MagicMirror --lines 50');
                                console.log('2. Look for "[TrafficGlance]" messages');
                                console.log('3. Verify sparklines are rendering correctly\n');

                                db.close();
                            });
                        });
                    });
                });
            });
        });
    });
});
