const { Events, MessageFlags } = require('discord.js');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return;

        const db = client.db;

        const isAuthorized = db.prepare('SELECT 1 FROM users WHERE discord_id = ?').get(interaction.user.id);
        if (!isAuthorized) {
            return interaction.reply({ // non-authorized message for the user
                content: '❌ Brak dostępu! Jeśli uważasz, że powinieneś mieć dostęp, skontaktuj się z naszym zespołem.',
                flags: MessageFlags.Ephemeral
            });
        }

        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, db);
        } catch (error) {
            console.error(error);
            const errorOptions = { // error message for the user
                content: 'Wystąpił błąd, spróbuj ponownie później. Jeśli błąd nadal będzie występował skontaktuj się z naszym zespołem.',
                flags: MessageFlags.Ephemeral
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorOptions);
            } else {
                await interaction.reply(errorOptions);
            }
        }
    }
};
