const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events, REST, Routes, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const { checkPrice } = require('./scraper.js');

process.loadEnvFile();

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
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();
client.db = db;

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

client.once(Events.ClientReady, async () => {
    initDB();
    const adminId = process.env.OWNER_ID;
    if (adminId) {
        db.prepare('INSERT OR IGNORE INTO users (discord_id) VALUES (?)').run(adminId);
    }

    const commandsData = client.commands.map(c => c.data);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commandsData }
        );
    } catch (error) {
        console.error('Error:\n', error);
    }

    console.log(`Logged in as ${client.user.tag}`);
    cron.schedule('0 12 * * *', async () => {
        console.log('[CRON] Rozpoczynam cykliczne sprawdzanie cen...');
        const alerts = db.prepare('SELECT * FROM alerts').all();

        for (const alert of alerts) {
            try {
                const currentPrice = await checkPrice(alert.url, alert.selector);

                if (!currentPrice) {
                    console.log(`\x1b[31m[CRON] Nie udało się odczytać ceny dla: ${alert.name}\x1b[0m`);
                    continue;
                }

                if (currentPrice !== alert.last_price) {
                    const isDrop = currentPrice < alert.last_price;
                    const status = isDrop ? '📉 Spadek ceny!' : '📈 Wzrost ceny!';
                    const color = isDrop ? '#57F287' : '#ED4245';

                    db.prepare('UPDATE alerts SET last_price = ? WHERE id = ?').run(currentPrice, alert.id);
                    db.prepare('INSERT INTO price_history (alert_id, price) VALUES (?, ?)').run(alert.id, currentPrice);
                    const user = await client.users.fetch(alert.user_id).catch(() => null);
                    if (user) {
                        const embed = new EmbedBuilder()
                            .setTitle(status)
                            .setColor(color)
                            .addFields(
                                { name: '🛒 Produkt', value: alert.name, inline: false },
                                { name: 'Poprzednia cena', value: `~~${alert.last_price} zł~~`, inline: true },
                                { name: 'Nowa cena', value: `**${currentPrice} zł**`, inline: true },
                                { name: '🔗', value: `[Link](${alert.url})`, inline: false }
                            )
                            .setTimestamp();

                        await user.send({ embeds: [embed] }).catch(err => console.error(`Błąd DM:`, err));
                    }
                } else {
                }
            } catch (err) {
                console.log(`\x1b[31m[CRON] Błąd przy sprawdzaniu: ${alert.id}:\x1b[0m`, err.message);
            }
        }
        console.log('[CRON] Cykl zakończony.');
    });
});

client.login(process.env.DISCORD_TOKEN);
