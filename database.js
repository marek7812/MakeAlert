const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

function initDB() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            discord_id TEXT PRIMARY KEY
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            url TEXT NOT NULL,
            name TEXT,
            selector TEXT NOT NULL,
            last_price REAL,
            FOREIGN KEY(user_id) REFERENCES users(discord_id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_id INTEGER NOT NULL,
            price REAL NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(alert_id) REFERENCES alerts(id) ON DELETE CASCADE
        )
    `).run();

    console.log('✅ DB Ready.');
}

module.exports = { db, initDB };
