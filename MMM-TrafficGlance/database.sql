-- Initial Schema for MMM-TrafficGlance
-- Optimized for high-frequency time-series lookups

CREATE TABLE IF NOT EXISTS traffic_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id TEXT NOT NULL,
    profile TEXT DEFAULT 'default',
    travel_time INTEGER NOT NULL, -- Duration in seconds
    timestamp INTEGER NOT NULL,   -- UTC Epoch
    minute_of_day INTEGER NOT NULL, -- 0-1439 for fast matching
    day_of_week INTEGER NOT NULL,   -- 0-6
    date_key TEXT                   -- YYYY-MM-DD format, computed at insert
);

-- Indexing for O(1) Snapshot Retrieval
CREATE INDEX IF NOT EXISTS idx_matching
ON traffic_history (route_id, day_of_week, minute_of_day);

-- Indexing for Cleanup Operations
CREATE INDEX IF NOT EXISTS idx_retention
ON traffic_history (timestamp);