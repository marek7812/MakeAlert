const { ApplicationCommandOptionType, MessageFlags, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { findPriceSelector } = require('../scraper.js');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

module.exports = {
    data: {
        name: 'alert',
        description: 'System Monitorowania cen',
        integration_types: [1],
        contexts: [0, 1, 2],
        options: [
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'dodaj', // add
                description: 'Dodaj produkt do śledzenia',
                options: [
                    { name: 'url', description: 'Link do produktu', type: ApplicationCommandOptionType.String, required: true },
                    { name: 'cena', description: 'Obecna cena produktu na stronie (np. 2499.99)', type: ApplicationCommandOptionType.Number, required: true },
                    { name: 'nazwa', description: 'Nazwa własna produktu (opcjonalnie)', type: ApplicationCommandOptionType.String, required: false }
                ]
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'aktualizuj', // update
                description: 'Naprawia zepsutą ścieżkę',
                options: [
                    { name: 'url', description: 'Link do śledzonego produktu', type: ApplicationCommandOptionType.String, required: true },
                    { name: 'nowa_cena', description: 'Obecna cena produktu na stronie (np. 2499.99)', type: ApplicationCommandOptionType.Number, required: true }
                ]
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'usun', // remove
                description: 'Usuń produkt ze śledzenia',
                options: [
                    { name: 'url', description: 'Link do usunięcia', type: ApplicationCommandOptionType.String, required: true }
                ]
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'lista', // list
                description: 'Pokazuje Twoje aktywne alerty'
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'statystyki', // price stats
                description: 'Generuje statystyki dla danego produktu',
                options: [
                    { name: 'url', description: 'Link do produktu', type: ApplicationCommandOptionType.String, required: true }
                ]
            }
        ]
    },
    async execute(interaction, db) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.reply({ content: `⏳ Przetwarzanie, proszę o chwilę cierpliwości ⏳`, flags: MessageFlags.Ephemeral }); // processing... message for the user

        if (subcommand === 'dodaj') {
            const url = interaction.options.getString('url');
            const cena = interaction.options.getNumber('cena');
            const nazwa = interaction.options.getString('nazwa') || 'Brak nazwy własnej';

            const selector = await findPriceSelector(url, cena);

            if (!selector) {
                return interaction.editReply('❌ Wystąpił błąd, sprawdź poprawność kwoty. Jeśli błąd będzie się powtarzał skontaktuj się z naszym zespołem.'); // price error
            }

            db.prepare('INSERT INTO alerts (user_id, url, name, selector, last_price) VALUES (?, ?, ?, ?, ?)').run(interaction.user.id, url, nazwa, selector, cena);
            const alertId = db.prepare('SELECT last_insert_rowid() as id').get().id;
            db.prepare('INSERT INTO price_history (alert_id, price) VALUES (?, ?)').run(alertId, cena);

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle('✅ Dodano alert pomyślnie!')
                .setColor('#57F287')
                .addFields(
                    { name: '🛒 Produkt', value: nazwa, inline: false },
                    { name: '💸 Cena', value: `**${cena} zł**`, inline: true },
                    { name: '🔗', value: `[Link](${url})`, inline: true }
                )
                .setTimestamp();
            await interaction.editReply({ content: '', embeds: [embed] });

        } else if (subcommand === 'aktualizuj') {
            const url = interaction.options.getString('url');
            const nowaCena = interaction.options.getNumber('nowa_cena');

            const alert = db.prepare('SELECT id FROM alerts WHERE user_id = ? AND url = ?').get(interaction.user.id, url);
            if (!alert) return interaction.editReply('❌ Nie znaleziono podanego alertu.'); // alert not found

            const selector = await findPriceSelector(url, nowaCena);
            if (!selector) return interaction.editReply('❌ Nie udało się odnaleźć nowej ceny. Sprawdź poprawność kwoty. Jeśli błąd będzie się powtarzał skontaktuj się z naszym zespołem.'); // update price error

            db.prepare('UPDATE alerts SET selector = ?, last_price = ? WHERE id = ?').run(selector, nowaCena, alert.id);
            db.prepare('INSERT INTO price_history (alert_id, price) VALUES (?, ?)').run(alert.id, nowaCena);

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle('✅ System naprawiony pomyślnie!')
                .setColor('#5865F2')
                .setDescription(`Ścieżka do produktu została zaktualizowana.`)
                .addFields(
                    { name: '💰 Nowa cena ustawiona na:', value: `**${nowaCena} zł**`, inline: false },
                    { name: '🔗', value: `[Link](${url})`, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ content: '', embeds: [embed] });
        } else if (subcommand === 'usun') {
            const url = interaction.options.getString('url');
            const result = db.prepare('DELETE FROM alerts WHERE user_id = ? AND url = ?').run(interaction.user.id, url);

            const { EmbedBuilder } = require('discord.js');

            if (result.changes > 0) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ Alert usunięty')
                    .setColor('#ED4245')
                    .setDescription('Produkt został pomyślnie usunięty ze śledzenia.')
                    .setTimestamp();
                await interaction.editReply({ content: '', embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Błąd usuwania')
                    .setColor('#ED4245')
                    .setDescription('Nie znaleziono podanego alertu w systemie.')
                    .setTimestamp();
                await interaction.editReply({ content: '', embeds: [embed] });
            }
        } else if (subcommand === 'lista') {
            const alerts = db.prepare('SELECT name, url, last_price FROM alerts WHERE user_id = ?').all(interaction.user.id);
            if (alerts.length === 0) return interaction.editReply('Brak ustawionych alertów...');

            const { EmbedBuilder } = require('discord.js');
            const embeds = [];

            for (let i = 0; i < alerts.length; i += 25) {
                const currentBatch = alerts.slice(i, i + 25);
                const embed = new EmbedBuilder()
                    .setTitle(`📋 Twoje aktywne alerty (Strona ${i+1}) 📋`)
                    .setColor('#f9ffff')

                currentBatch.forEach((a, index) => {
                    embed.addFields({
                        name: `${i + index + 1}. ${a.name}`,
                        value: `Cena: **${a.last_price} zł**\n[Link](${a.url})`,
                        inline: false
                    });
                });
                embeds.push(embed);
            }
            await interaction.editReply({ content: '', embeds: embeds.slice(0, 10) });

        } else if (subcommand === 'statystyki') {
            const url = interaction.options.getString('url');
            const alert = db.prepare('SELECT id, name FROM alerts WHERE user_id = ? AND url = ?').get(interaction.user.id, url);

            if (!alert) {
                return interaction.editReply('❌ Podany produkt nie jest śledzony...');
            }

            const history = db.prepare('SELECT * FROM price_history WHERE alert_id = ? ORDER BY id ASC').all(alert.id);
            if (history.length < 2) {
                return interaction.editReply(`❌ Nie mam na podstawie czego wygenerować statystyk (wymagane minimum 2 pomiary, obecnie jest ${history.length} pomiar)`);
            }

            const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
            const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
            const width = 800;
            const height = 400;
            const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#2b2d31' });

            const labels = history.map((row, index) => {
                const timeStr = row.created_at || row.timestamp || row.date;
                if (timeStr) {
                    const d = new Date(timeStr);
                    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
                }
                return `Pomiar ${index + 1}`;
            });

            const dataPoints = history.map(row => row.price);
            const firstPrice = dataPoints[0];
            const lastPrice = dataPoints[dataPoints.length - 1];
            const minPrice = Math.min(...dataPoints);
            const maxPrice = Math.max(...dataPoints);
            const trendColor = lastPrice < firstPrice ? '#57F287' : (lastPrice > firstPrice ? '#ED4245' : '#fa6e06');

            const configuration = {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: `Cena w PLN`,
                        data: dataPoints,
                        borderColor: trendColor,
                        backgroundColor: trendColor + '33', // 20% opacity
                        borderWidth: 3,
                        tension: 0.2,
                        fill: true,
                        pointRadius: 4,
                        pointBackgroundColor: '#ffffff'
                    }]
                },
                options: {
                    color: '#ffffff',
                    scales: {
                        x: {
                            ticks: { color: '#ffffff' },
                            grid: { color: 'rgba(255, 255, 255, 0.1)' }
                        },
                        y: {
                            ticks: { color: '#ffffff' },
                            grid: { color: 'rgba(255, 255, 255, 0.1)' }
                        }
                    },
                    plugins: {
                        legend: { labels: { color: '#ffffff', font: { size: 14 } } },
                        title: {
                            display: true,
                            text: alert.name,
                            color: '#ffffff',
                            font: { size: 18 }
                        }
                    }
                }
            };

            const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'statystyki.png' });

            const embed = new EmbedBuilder()
                .setTitle(`📊 Statystyki Produktu 📊`)
                .setDescription(`[${alert.name}](${url})`)
                .setColor('#f9ffff')
                .addFields(
                    { name: '💸 Obecna cena', value: `**${lastPrice} zł**`, inline: true },
                    { name: '📉 Najniższa cena', value: `**${minPrice} zł**`, inline: true },
                    { name: '📈 Najwyższa cena', value: `**${maxPrice} zł**`, inline: true }
                )
                .setImage('attachment://statystyki.png')
                .setTimestamp();

            await interaction.editReply({ content: '', embeds: [embed], files: [attachment] });
        }
    }
};
