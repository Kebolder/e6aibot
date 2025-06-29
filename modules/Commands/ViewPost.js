const { SlashCommandBuilder, ActionRowBuilder, InteractionContextType } = require('discord.js');
const axios = require('axios');
const config = require('../../config.js');
const { generatePostMessage } = require('../postEmbed.js');

const { e6ai, replaceCommandAllowedUserIds } = config;

async function setupPostCollector(message, interaction) {
    const collector = message.createMessageComponentCollector({ time: 3_600_000 }); // 1 hour

    collector.on('collect', async i => {
        const [action, currentPostId] = i.customId.split(':');
        
        if (action === 'undelete') {
            if (!replaceCommandAllowedUserIds.includes(i.user.id)) {
                await i.reply({ content: 'You are not authorized to use this button.', ephemeral: true });
                return;
            }

            await i.deferUpdate();
            try {
                const undeleteUrl = `${e6ai.baseUrl}/moderator/post/posts/${currentPostId}/undelete.json`;
                await axios.post(undeleteUrl, null, {
                    params: { login: e6ai.username, api_key: e6ai.apiKey },
                    headers: { 'User-Agent': e6ai.userAgent },
                });

                // Wait for 2 seconds to allow the server to process the undeletion
                await new Promise(resolve => setTimeout(resolve, 2000));

                const refetchApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${currentPostId}`;
                const refetchResponse = await axios.get(refetchApiUrl, {
                    headers: { 'User-Agent': e6ai.userAgent },
                });

                if (refetchResponse.status === 200 && refetchResponse.data.posts.length > 0) {
                    const updatedPost = refetchResponse.data.posts[0];
                    const newReplyOptions = await generatePostMessage(updatedPost);
                    
                    await i.message.delete();
                    const newMessage = await i.channel.send(newReplyOptions);
                    setupPostCollector(newMessage, interaction);
                } else {
                    await i.followUp({ content: 'Successfully undeleted, but could not refresh the post message.', ephemeral: true });
                }
            } catch (error) {
                console.error(`Error undeleting post ${currentPostId}:`, error.isAxiosError ? error.toJSON() : error);
                await i.followUp({ content: 'An error occurred while trying to undelete the post.', ephemeral: true });
            }
            return;
        }
        
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'These buttons are not for you.', ephemeral: true });
            return;
        }

        if (action !== 'view_prev' && action !== 'view_next') return;

        await i.deferUpdate();

        const direction = action === 'view_next' ? 'next' : 'prev';
        const order = direction === 'next' ? 'id_asc' : 'id_desc';
        const operator = direction === 'next' ? '>' : '<';

        try {
            const newPostApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${operator}${currentPostId}+status:any&limit=1&login=${e6ai.username}&api_key=${e6ai.apiKey}`;
            console.log(`Fetching ${direction} post from: ${newPostApiUrl}`);

            const newPostResponse = await axios.get(newPostApiUrl, {
                headers: { 'User-Agent': e6ai.userAgent },
            });

            if (newPostResponse.status === 200 && newPostResponse.data.posts && newPostResponse.data.posts.length > 0) {
                const newPost = newPostResponse.data.posts[0];
                const newReplyOptions = await generatePostMessage(newPost);
                await i.editReply(newReplyOptions);
            } else {
                const originalMessage = i.message;
                const actionRow = ActionRowBuilder.from(originalMessage.components[0]);
                const buttonIndex = direction === 'next' ? 1 : 0;
                actionRow.components[buttonIndex].setDisabled(true);
                await i.editReply({ components: [actionRow] });
            }
        } catch (error) {
            console.error(`Error fetching ${direction} post:`, error.isAxiosError ? error.toJSON() : error);
            await i.followUp({ content: 'An error occurred while fetching the post.', ephemeral: true });
        }
    });

    collector.on('end', async () => {
        try {
            if (message.editable) {
                const finalMessage = await message.fetch();
                if (finalMessage.components.length > 0) {
                    const actionRow = ActionRowBuilder.from(finalMessage.components[0]);
                    actionRow.components.forEach(component => component.setDisabled(true));
                    await message.edit({ components: [actionRow] });
                }
            }
        } catch (error) {
            if (error.code === 10008) { // Unknown Message
                console.log('Message was already deleted, cannot disable buttons.');
            } else {
                console.error('Error disabling buttons after collector timeout:', error);
            }
        }
    });
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

        if (!e6ai.username || !e6ai.apiKey) {
            await interaction.reply({ content: 'Bot owner has not configured E6AI_USERNAME or E6AI_API_KEY in the .env file.', ephemeral: true });
            console.error('Missing E6AI_USERNAME or E6AI_API_KEY in .env');
            return;
        }

        await interaction.deferReply();

        try {
            let apiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${postId}`;
            console.log(`Fetching post from: ${apiUrl}`);

            let response = await axios.get(apiUrl, {
                headers: {
                    'User-Agent': e6ai.userAgent,
                },
            });

            // If post not found, try again with status:any and authentication
            if (response.status === 200 && (!response.data.posts || response.data.posts.length === 0)) {
                console.log(`Post ${postId} not found, trying with status:any and authentication.`);
                apiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${postId}+status:any&login=${e6ai.username}&api_key=${e6ai.apiKey}`;
                console.log(`Fetching deleted post from: ${apiUrl}`);
                response = await axios.get(apiUrl, {
                    headers: {
                        'User-Agent': e6ai.userAgent,
                    },
                });
            }

            if (response.status === 200 && response.data.posts && response.data.posts.length > 0) {
                const post = response.data.posts[0];
                
                const replyOptions = await generatePostMessage(post);
                replyOptions.fetchReply = true;
                
                const message = await interaction.editReply(replyOptions);
                await setupPostCollector(message, interaction);
                
            } else if (response.status === 200) {
                 await interaction.editReply(`Post with ID ${postId} not found or you lack permissions to view it.`);
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