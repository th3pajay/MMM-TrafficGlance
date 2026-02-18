const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../traffic.db');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("Initializing database schema...");

    // Match database.sql schema exactly
    db.run(`CREATE TABLE IF NOT EXISTS traffic_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id TEXT NOT NULL,
        profile TEXT DEFAULT 'default',
        travel_time INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        minute_of_day INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL
    )`, (err) => {
        if (err) {
            console.error("Schema creation failed:", err.message);
        } else {
            console.log("Table 'traffic_history' created/verified.");
        }
    });

    // Match index names from database.sql
    db.run(`CREATE INDEX IF NOT EXISTS idx_matching
            ON traffic_history (route_id, day_of_week, minute_of_day)`, (err) => {
        if (err) {
            console.error("Index creation failed:", err.message);
        } else {
            console.log("Index 'idx_matching' created/verified.");
        }
    });

    // Add retention index
    db.run(`CREATE INDEX IF NOT EXISTS idx_retention
            ON traffic_history (timestamp)`, (err) => {
        if (err) {
            console.error("Retention index creation failed:", err.message);
        } else {
            console.log("Index 'idx_retention' created/verified.");
        }
    });
});

db.close((err) => {
    if (err) {
        console.error("Database close error:", err.message);
    } else {
        console.log("Database initialization complete.");
    }
});