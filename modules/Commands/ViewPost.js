const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionContextType } = require('discord.js');
const axios = require('axios');
const config = require('../../config.js');

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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('view')
        .setDescription('Views a post from e6ai.net by its ID.')
        .addStringOption(option =>
            option.setName('post_id')
                .setDescription('The ID of the post to view.')
                .setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    async execute(interaction) {
        const postId = interaction.options.getString('post_id');

        if (!/^\d+$/.test(postId)) {
            await interaction.reply({ content: 'Post ID must be a number.', ephemeral: true });
            return;
        }

        if (!e6ai.username) {
            await interaction.reply({ content: 'Bot owner has not configured E6AI_USERNAME in the .env file.', ephemeral: true });
            console.error('Missing E6AI_USERNAME in .env');
            return;
        }

        await interaction.deferReply();

        try {
            const apiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${postId}`;
            console.log(`Fetching post from: ${apiUrl}`);

            const response = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': e6ai.userAgent,
                },
            });

            if (response.status === 200 && response.data.posts && response.data.posts.length > 0) {
                const post = response.data.posts[0];

                const status = getStatus(post.flags);
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
                    .setTitle(`Post #${post.id}`)
                    .setURL(`${e6ai.baseUrl}/posts/${post.id}`)
                    .setDescription(post.description || 'No description provided.')
                    .addFields(
                        { name: 'Likes', value: String(post.score.total), inline: true },
                        { name: 'Favorites', value: String(post.fav_count), inline: true },
                        { name: 'Posted', value: `<t:${Math.floor(new Date(post.created_at).getTime() / 1000)}:R>`, inline: true },
                        { name: 'Size', value: `${post.file.width}x${post.file.height} (${formatBytes(post.file.size)})`, inline: true },
                        { name: 'Type', value: post.file.ext.toUpperCase(), inline: true },
                        { name: 'Status', value: status, inline: true }
                    );
                
                if (post.approver_id) {
                    embed.addFields({ name: 'Approver', value: `ID: ${post.approver_id}`, inline: true });
                }

                const replyOptions = { embeds: [embed] };
                if (post.file && post.file.url) {
                    const fileName = post.file.url.split('/').pop();
                    const attachment = new AttachmentBuilder(post.file.url, { name: fileName });
                    embed.setImage(`attachment://${fileName}`);
                    replyOptions.files = [attachment];
                }

                const isFirstApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:<${post.id} order:id_desc&limit=1`;
                const isLastApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:>${post.id} order:id_asc&limit=1`;

                const [isFirstResponse, isLastResponse] = await Promise.all([
                    axios.get(isFirstApiUrl, { headers: { 'User-Agent': e6ai.userAgent } }),
                    axios.get(isLastApiUrl, { headers: { 'User-Agent': e6ai.userAgent } })
                ]);

                const isFirst = !(isFirstResponse.status === 200 && isFirstResponse.data.posts && isFirstResponse.data.posts.length > 0);
                const isLast = !(isLastResponse.status === 200 && isLastResponse.data.posts && isLastResponse.data.posts.length > 0);
                
                const buttons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`view_prev:${post.id}`)
                            .setLabel('⬅️ Prev')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(isFirst),
                        new ButtonBuilder()
                            .setCustomId(`view_next:${post.id}`)
                            .setLabel('Next ➡️')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(isLast)
                    );
                
                replyOptions.components = [buttons];
                replyOptions.fetchReply = true;
                
                await interaction.editReply(replyOptions);
            } else if (response.status === 200) {
                 await interaction.editReply(`Post with ID ${postId} not found or no data returned.`);
            }
             else {
                await interaction.editReply(`Failed to fetch post. Status: ${response.status} - ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error fetching post from e6ai:', error.isAxiosError ? error.toJSON() : error);
            let errorMessage = 'An error occurred while trying to fetch the post.';
            if (error.response) {
                errorMessage += ` API Error: ${error.response.status} - ${error.response.statusText}.`;
                if(error.response.data && (error.response.data.reason || error.response.data.message)) {
                    errorMessage += ` Reason: ${error.response.data.reason || error.response.data.message}`;
                } else if (error.response.data) {
                    errorMessage += ` Details: ${JSON.stringify(error.response.data).substring(0,500)}`;
                }
            } else if (error.request) {
                errorMessage += ' No response received from the API.';
            } else {
                errorMessage += ` ${error.message}`;
            }
            await interaction.editReply({ content: errorMessage, ephemeral: true });
        }
    },
}; 