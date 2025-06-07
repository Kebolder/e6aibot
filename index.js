require('dotenv').config(); // Load .env file at the very top

const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const config = require('./config.js');

const { e6ai } = config;

function formatBytes(bytes, decimals = 2) {
	if (!+bytes) return '0 Bytes'

	const k = 1024
	const dm = decimals < 0 ? 0 : decimals
	const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

	const i = Math.floor(Math.log(bytes) / Math.log(k))

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

function getStatus(flags) {
	if (flags.deleted) return 'Deleted';
	if (flags.pending) return 'Pending';
	return 'Active';
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'modules');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	// Check if commandsPath is a directory before reading it
	if (fs.statSync(commandsPath).isDirectory()) {
		const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
		for (const file of commandFiles) {
			const filePath = path.join(commandsPath, file);
			const command = require(filePath);
			if ('data' in command && 'execute' in command) {
				client.commands.set(command.data.name, command);
				console.log(`[INFO] Loaded command ${command.data.name} from ${folder}/${file}`);
			} else {
				console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
			}
		}
	}
}

client.once(Events.ClientReady, readyClient => {
	console.log(`Ready! Logged in as ${readyClient.user.tag}`);
	// If you need to register commands globally or for specific guilds, do it here.
	// For simplicity, this example assumes commands are already registered or handled by a deploy script.
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
		const [action, currentPostId] = interaction.customId.split(':');

		if (action !== 'view_prev' && action !== 'view_next') return;

		await interaction.deferUpdate();

		const direction = action === 'view_next' ? 'next' : 'prev';
		const order = direction === 'next' ? 'id_asc' : 'id_desc';
		const operator = direction === 'next' ? '>' : '<';

		try {
			const apiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${operator}${currentPostId} order:${order}&limit=1`;
			console.log(`Fetching ${direction} post from: ${apiUrl}`);

			const response = await axios.get(apiUrl, {
				headers: {
					'User-Agent': e6ai.userAgent,
				},
			});

			if (response.status === 200 && response.data.posts && response.data.posts.length > 0) {
				const newPost = response.data.posts[0];

				const isFirstApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:<${newPost.id} order:id_desc&limit=1`;
				const isLastApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:>${newPost.id} order:id_asc&limit=1`;

				const [isFirstResponse, isLastResponse] = await Promise.all([
					axios.get(isFirstApiUrl, { headers: { 'User-Agent': e6ai.userAgent } }),
					axios.get(isLastApiUrl, { headers: { 'User-Agent': e6ai.userAgent } })
				]);

				const isFirst = !(isFirstResponse.status === 200 && isFirstResponse.data.posts && isFirstResponse.data.posts.length > 0);
				const isLast = !(isLastResponse.status === 200 && isLastResponse.data.posts && isLastResponse.data.posts.length > 0);

				const status = getStatus(newPost.flags);
				let color;
				if (status === 'Deleted') {
					color = '#FF0000';
				} else if (status === 'Pending') {
					color = '#FFFF00';
				} else {
					color = '#33cc33';
				}

				const embed = new EmbedBuilder()
					.setColor(color)
					.setTitle(`Post #${newPost.id}`)
					.setURL(`${e6ai.baseUrl}/posts/${newPost.id}`)
					.setDescription(newPost.description || 'No description provided.')
					.addFields(
						{ name: 'Likes', value: String(newPost.score.total), inline: true },
						{ name: 'Favorites', value: String(newPost.fav_count), inline: true },
						{ name: 'Posted', value: `<t:${Math.floor(new Date(newPost.created_at).getTime() / 1000)}:R>`, inline: true },
						{ name: 'Size', value: `${newPost.file.width}x${newPost.file.height} (${formatBytes(newPost.file.size)})`, inline: true },
						{ name: 'Type', value: newPost.file.ext.toUpperCase(), inline: true },
						{ name: 'Status', value: status, inline: true }
					);
				
				if (newPost.approver_id) {
					embed.addFields({ name: 'Approver', value: `ID: ${newPost.approver_id}`, inline: true });
				}

				const replyOptions = { embeds: [embed], files: [] };
				if (newPost.file && newPost.file.url) {
					const fileName = newPost.file.url.split('/').pop();
					const attachment = new AttachmentBuilder(newPost.file.url, { name: fileName });
					embed.setImage(`attachment://${fileName}`);
					replyOptions.files = [attachment];
				}
				
				const buttons = new ActionRowBuilder()
					.addComponents(
						new ButtonBuilder()
							.setCustomId(`view_prev:${newPost.id}`)
							.setLabel('⬅️ Prev')
							.setStyle(ButtonStyle.Primary)
							.setDisabled(isFirst),
						new ButtonBuilder()
							.setCustomId(`view_next:${newPost.id}`)
							.setLabel('Next ➡️')
							.setStyle(ButtonStyle.Primary)
							.setDisabled(isLast)
					);
				
				replyOptions.components = [buttons];
				await interaction.editReply(replyOptions);
			} else {
				// This part disables the button if there are no more posts.
				const originalMessage = interaction.message;
				const actionRow = originalMessage.components[0];
				const buttonIndex = direction === 'next' ? 1 : 0;
				actionRow.components[buttonIndex].setDisabled(true);
				await interaction.editReply({ components: [actionRow] });
			}
		} catch (error) {
			console.error(`Error fetching ${direction} post:`, error.isAxiosError ? error.toJSON() : error);
			await interaction.followUp({ content: 'An error occurred while fetching the post.', ephemeral: true });
		}
	}
});

// Log in to Discord with your client's token
// Make sure to create a .env file and add your bot token as BOT_TOKEN=YOUR_TOKEN_HERE
client.login(process.env.BOT_TOKEN); 