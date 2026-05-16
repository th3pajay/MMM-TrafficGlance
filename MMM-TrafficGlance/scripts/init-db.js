const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../traffic.db');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("Initializing database schema...");

    db.run(`CREATE TABLE IF NOT EXISTS traffic_history (
        id INTEGER PRIMARY KEY,
        route_id TEXT NOT NULL,
        travel_time INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        minute_of_day INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,
        date_key TEXT
    )`, (err) => {
        if (err) console.error("Schema creation failed:", err.message);
        else console.log("Table 'traffic_history' created/verified.");
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_query_optimization
            ON traffic_history (route_id, day_of_week, minute_of_day, timestamp)`, (err) => {
        if (err) console.error("Index creation failed:", err.message);
        else console.log("Index 'idx_query_optimization' created/verified.");
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_sparkline_optimization
            ON traffic_history (route_id, day_of_week, minute_of_day, date_key)`, (err) => {
        if (err) console.error("Index creation failed:", err.message);
        else console.log("Index 'idx_sparkline_optimization' created/verified.");
    });
});

db.close((err) => {
    if (err) console.error("Database close error:", err.message);
    else console.log("Database initialization complete.");
});
