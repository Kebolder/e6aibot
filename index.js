require('dotenv').config(); // Load .env file at the very top

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { handleReplacement } = require('./modules/interactions/replacementHandler.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageTyping] });

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'modules');
const moduleFilesAndFolders = fs.readdirSync(foldersPath);

for (const name of moduleFilesAndFolders) {
	const modulePath = path.join(foldersPath, name);
	const stat = fs.statSync(modulePath);

	if (name === 'dmail_commands' || name === 'dmail_responses') continue;

	if (stat.isDirectory()) {
		// This is the existing command loading logic for subdirectories
		const commandFiles = fs.readdirSync(modulePath).filter(file => file.endsWith('.js'));
		for (const file of commandFiles) {
			const filePath = path.join(modulePath, file);
			const command = require(filePath);
			if ('data' in command && 'execute' in command) {
				client.commands.set(command.data.name, command);
				console.log(`[INFO] Loaded command ${command.data.name} from ${name}/${file}`);
			} else {
				console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
			}
		}
	} else if (name.endsWith('.js')) {
		// This is the new logic for background modules in the root of /modules
		const module = require(modulePath);
		if ('init' in module) {
			module.init(client);
			console.log(`[INFO] Initialized module from ${name}`);
		}
	}
}

client.once(Events.ClientReady, readyClient => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
	if (interaction.isChatInputCommand()) {
		const command = interaction.client.commands.get(interaction.commandName);

		if (!command) {
			console.error(`No command matching ${interaction.commandName} was found.`);
			await interaction.reply({ content: 'Error: Command not found.', ephemeral: true });
			return;
		}

		try {
			await command.execute(interaction);
		} catch (error) {
			console.error(error);
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
			} else {
				await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
			}
		}
	} else if (interaction.isButton()) {
        if (interaction.customId.startsWith('accept-replacement_') || interaction.customId.startsWith('decline-replacement_')) {
            handleReplacement(interaction, client);
        }
    }
});

client.login(process.env.BOT_TOKEN); 