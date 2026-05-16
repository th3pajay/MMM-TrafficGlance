-- Schema for MMM-TrafficGlance
-- Authoritative definition — matches node_helper.js initDatabase()

CREATE TABLE IF NOT EXISTS traffic_history (
    id INTEGER PRIMARY KEY,
    route_id TEXT NOT NULL,
    travel_time INTEGER NOT NULL,  -- Duration in seconds
    timestamp INTEGER NOT NULL,    -- UTC epoch seconds
    minute_of_day INTEGER NOT NULL, -- 0-1439 for fast matching
    day_of_week INTEGER NOT NULL,   -- 0-6
    date_key TEXT                   -- YYYY-MM-DD, computed at insert
);

-- Hot path: historical average queries
CREATE INDEX IF NOT EXISTS idx_query_optimization
ON traffic_history (route_id, day_of_week, minute_of_day, timestamp);

-- Sparkline queries
CREATE INDEX IF NOT EXISTS idx_sparkline_optimization
ON traffic_history (route_id, day_of_week, minute_of_day, date_key);
