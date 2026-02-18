#!/usr/bin/env node

/**
 * Database Query Test Script
 * Tests the fixed SQLite query initialization sequence
 */

const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, '..', 'traffic.db');
let dbInitialized = false;

console.log('[Test] Starting database test...');
console.log(`[Test] Database path: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('[Test] DB connection failed:', err.message);
        process.exit(1);
    } else {
        console.log('[Test] Database connected');

        // CRITICAL: All initialization must be serialized
        db.serialize(() => {
            console.log('[Test] Starting serialized initialization...');

            // Performance optimizations - MUST run inside serialize() with callbacks
            db.run('PRAGMA journal_mode=WAL', (err) => {
                if (err) {
                    console.error('[Test] WAL mode failed:', err.message);
                } else {
                    console.log('[Test] WAL mode enabled');
                }
            });

            db.run('PRAGMA synchronous=NORMAL', (err) => {
                if (err) console.error('[Test] Synchronous pragma failed:', err.message);
            });

            db.run('PRAGMA busy_timeout=5000', (err) => {
                if (err) {
                    console.error('[Test] Busy timeout pragma failed:', err.message);
                } else {
                    console.log('[Test] Busy timeout set to 5000ms');
                }
            });

            // Check WAL status
            db.get('PRAGMA journal_mode', (err, row) => {
                if (err) {
                    console.error('[Test] Failed to check journal mode:', err.message);
                } else {
                    console.log('[Test] Journal mode:', row);
                }
            });

            // Mark as initialized AFTER PRAGMAs complete (within serialize)
            dbInitialized = true;
            console.log('[Test] Database initialization phase complete');
        });

        // Wait for serialization to complete, then test queries
        setTimeout(() => {
            console.log('\n[Test] Running query tests...');

            if (!dbInitialized) {
                console.error('[Test] ERROR: Database not marked as initialized!');
            } else {
                console.log('[Test] Database initialization flag: true');
            }

            // Test 1: Simple count query
            const testQuery1 = `SELECT COUNT(*) as count FROM traffic_history`;
            const startTime1 = Date.now();

            db.get(testQuery1, (err, row) => {
                const duration1 = Date.now() - startTime1;

                if (err) {
                    console.error('[Test] Query 1 FAILED:', err.message);
                } else {
                    console.log(`[Test] Query 1 SUCCESS: ${row.count} records (${duration1}ms)`);
                }

                // Test 2: Historical average query (real workload)
                const now = new Date();
                const currentMinute = now.getHours() * 60 + now.getMinutes();
                const currentDayOfWeek = now.getDay();
                const windowSize = 30;
                const minMinute = Math.max(0, currentMinute - windowSize);
                const maxMinute = Math.min(1439, currentMinute + windowSize);
                const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 86400);

                const testQuery2 = `
                    SELECT AVG(travel_time) as avg_travel_time,
                           COUNT(*) as sample_count
                    FROM traffic_history
                    WHERE route_id = 'morning-commute'
                      AND day_of_week = ?
                      AND minute_of_day BETWEEN ? AND ?
                      AND timestamp >= ?
                `;

                const startTime2 = Date.now();

                db.get(testQuery2, [currentDayOfWeek, minMinute, maxMinute, thirtyDaysAgo], (err, row) => {
                    const duration2 = Date.now() - startTime2;

                    if (err) {
                        console.error('[Test] Query 2 FAILED:', err.message);
                    } else {
                        console.log(`[Test] Query 2 SUCCESS: avg=${row.avg_travel_time}, samples=${row.sample_count} (${duration2}ms)`);
                    }

                    // Test 3: Sparkline query
                    const testQuery3 = `
                        SELECT date_key as date,
                               AVG(travel_time) as avg_time
                        FROM traffic_history
                        WHERE route_id = 'morning-commute'
                          AND day_of_week = ?
                          AND minute_of_day BETWEEN ? AND ?
                          AND timestamp >= ?
                        GROUP BY date_key
                        ORDER BY date_key ASC
                        LIMIT 30
                    `;

                    const startTime3 = Date.now();

                    db.all(testQuery3, [currentDayOfWeek, minMinute, maxMinute, thirtyDaysAgo], (err, rows) => {
                        const duration3 = Date.now() - startTime3;

                        if (err) {
                            console.error('[Test] Query 3 FAILED:', err.message);
                        } else {
                            console.log(`[Test] Query 3 SUCCESS: ${rows.length} days of data (${duration3}ms)`);
                        }

                        // Summary
                        console.log('\n[Test] Summary:');
                        console.log(`  - Query 1: ${duration1}ms`);
                        console.log(`  - Query 2: ${duration2}ms`);
                        console.log(`  - Query 3: ${duration3}ms`);

                        if (duration2 > 1000 || duration3 > 1000) {
                            console.warn('[Test] WARNING: Queries are slow (>1s)');
                        } else {
                            console.log('[Test] All queries completed quickly ✓');
                        }

                        // Close database
                        db.close((err) => {
                            if (err) {
                                console.error('[Test] Error closing database:', err.message);
                            } else {
                                console.log('[Test] Database closed');
                            }
                        });
                    });
                });
            });
        }, 500); // Wait 500ms for serialize() to complete
    }
});
