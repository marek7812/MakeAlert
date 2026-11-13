const { ApplicationCommandOptionType, MessageFlags } = require('discord.js');
const { findPriceSelector } = require('../scraper.js');

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

            await interaction.editReply(`✅ Dodano alert pomyślnie!\n**Produkt:** ${nazwa}\n**Cena:** ${cena} zł`); // add alert success

        } else if (subcommand === 'aktualizuj') {
            const url = interaction.options.getString('url');
            const nowaCena = interaction.options.getNumber('nowa_cena');

            const alert = db.prepare('SELECT id FROM alerts WHERE user_id = ? AND url = ?').get(interaction.user.id, url);
            if (!alert) return interaction.editReply('❌ Nie znaleziono podanego alertu.'); // alert not found

            const selector = await findPriceSelector(url, nowaCena);
            if (!selector) return interaction.editReply('❌ Nie udało się odnaleźć nowej ceny. Sprawdź poprawność kwoty. Jeśli błąd będzie się powtarzał skontaktuj się z naszym zespołem.'); // update price error

            db.prepare('UPDATE alerts SET selector = ?, last_price = ? WHERE id = ?').run(selector, nowaCena, alert.id);
            db.prepare('INSERT INTO price_history (alert_id, price) VALUES (?, ?)').run(alert.id, nowaCena);

            await interaction.editReply(`✅ System naprawiony pomyślnie. Nowa cena ustawiona na: ${nowaCena}`); // update price success
        } else if (subcommand === 'usun') {
            const url = interaction.options.getString('url');
            const result = db.prepare('DELETE FROM alerts WHERE user_id = ? AND url = ?').run(interaction.user.id, url);

            if (result.changes > 0) await interaction.editReply('✅ Alert pomyślnie usunięty.'); // delete alert success
            else await interaction.editReply('❌ Nie znaleziono podanego alertu w systemie.'); // delete alert not found
        } else if (subcommand === 'lista') {
            const alerts = db.prepare('SELECT name, url, last_price FROM alerts WHERE user_id = ?').all(interaction.user.id);
            if (alerts.length === 0) return interaction.editReply('Brak ustawionych alertów...');

            const { EmbedBuilder } = require('discord.js');
            const embeds = [];

            for (let i = 0; i < alerts.length; i += 25) {
                const currentBatch = alerts.slice(i, i + 25);
                const embed = new EmbedBuilder()
                    .setTitle(`📋 Twoje aktywne alerty (Strona ${i+1})`)
                    .setColor('#f9ffff')

                currentBatch.forEach((a, index) => {
                    embed.addFields({
                        name: `${i + index + 1}. ${a.name}`,
                        value: `Cena: **${a.last_price} zł**\n[Kliknij, aby przejść do oferty](${a.url})`,
                        inline: false
                    });
                });
                embeds.push(embed);
            }
            await interaction.editReply({ content: '', embeds: embeds.slice(0, 10) });

        } else if (subcommand === 'statystyki') {
            await interaction.editReply('W.I.P'); // Work in Progress
        }
    }
};
