const { SlashCommandBuilder, ActionRowBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const FormData = require('form-data');
const axios = require('axios');
const config = require('../../config.js');
const { generatePostMessage } = require('../postEmbed.js');

const { e6ai, janitorUserIds } = config;

async function setupPostCollector(message, interaction) {
    const collector = message.createMessageComponentCollector({ time: 3_600_000 }); // 1 hour

    collector.on('collect', async i => {
        const [action, currentPostId] = i.customId.split(':');
        
        if (action === 'undelete') {
            if (!janitorUserIds.includes(i.user.id)) {
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
        .setName('replace')
        .setDescription('Replaces an image for a given post ID on e6ai.net.')
        .addStringOption(option =>
            option.setName('post_id')
                .setDescription('The ID of the post to replace.')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('The new image or video to upload.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the replacement (min 5 characters).')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('source')
                .setDescription('The new source URL for the post.')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('undelete')
                .setDescription('Set to true to undelete the post after replacement.')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('as_pending')
                .setDescription('Submit the replacement as pending. (Default: false)')
                .setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    async execute(interaction) {
        if (janitorUserIds.length > 0 && !janitorUserIds.includes(interaction.user.id)) {
            await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
            return;
        }

        const postId = interaction.options.getString('post_id');
        const imageAttachment = interaction.options.getAttachment('image');
        const reason = interaction.options.getString('reason');
        const source = interaction.options.getString('source');
        const undelete = interaction.options.getBoolean('undelete') ?? false;
        const asPending = interaction.options.getBoolean('as_pending') ?? false;

        if (reason.length < 5) {
            await interaction.reply({ content: 'The reason for replacement must be at least 5 characters long.', ephemeral: true });
            return;
        }

        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'].includes(imageAttachment.contentType)) {
            await interaction.reply({ content: 'Please upload a valid file type (PNG, JPG, GIF, WEBP, MP4, WEBM).', ephemeral: true });
            return;
        }

        if (!e6ai.username || !e6ai.apiKey) {
            await interaction.reply({ content: 'Bot owner has not configured E6AI_USERNAME or E6AI_API_KEY in the .env file.', ephemeral: true });
            console.error('Missing E6AI_USERNAME or E6AI_API_KEY in .env');
            return;
        }

        await interaction.deferReply();

        try {
            // Fetch old post data to get the old image URL
            const postInfoUrl = `${e6ai.baseUrl}/posts/${postId}.json`;
            const postInfoResponse = await axios.get(postInfoUrl, {
                headers: { 'User-Agent': e6ai.userAgent },
                params: {
                    login: e6ai.username,
                    api_key: e6ai.apiKey,
                },
            });

            const oldImageUrl = postInfoResponse?.data?.post?.file?.url;

            if (!oldImageUrl) {
                await interaction.editReply({ content: 'Could not fetch the old image. The post might not exist, the API response was not as expected, or the bot may not have permission to view it.', ephemeral: true });
                return;
            }
            
            const imageResponse = await axios.get(imageAttachment.url, { responseType: 'stream' });

            const formData = new FormData();
            formData.append('post_replacement[replacement_file]', imageResponse.data, { 
                filename: imageAttachment.name, 
                contentType: imageAttachment.contentType 
            });
            formData.append('post_replacement[reason]', reason);
            if (source) {
                formData.append('post_replacement[source]', source);
            }
            formData.append('post_replacement[as_pending]', asPending.toString());

            const apiUrl = `${e6ai.baseUrl}/post_replacements.json?post_id=${postId}&login=${e6ai.username}&api_key=${e6ai.apiKey}`;
            console.log(`Submitting replacement to: ${apiUrl}`);
            console.log(`With Reason: ${reason}, File: ${imageAttachment.name}`);

            const response = await axios.post(
                apiUrl,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'User-Agent': e6ai.userAgent,
                    },
                }
            );

            if (response.status === 200 || response.status === 201 || response.status === 204 ) {
                const oldEmbed = new EmbedBuilder()
                    .setColor(0xcc3333)
                    .setTitle('OLD IMAGE')
                    .setURL(`${e6ai.baseUrl}/posts/${postId}`)
                    .setImage(oldImageUrl);

                await interaction.editReply({ embeds: [oldEmbed] });

                if (undelete) {
                    try {
                        const undeleteUrl = `${e6ai.baseUrl}/moderator/post/posts/${postId}/undelete.json`;
                        await axios.post(undeleteUrl, null, {
                            params: {
                                login: e6ai.username,
                                api_key: e6ai.apiKey,
                            },
                            headers: {
                                'User-Agent': e6ai.userAgent,
                            },
                        });
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } catch (undeleteError) {
                        console.error(`Failed to undelete post ${postId}:`, undeleteError);
                        await interaction.followUp({ content: `Replacement was successful, but failed to undelete post ${postId}. You may need to do it manually.`, ephemeral: true });
                    }
                }

                const refetchApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${postId}+status:any&login=${e6ai.username}&api_key=${e6ai.apiKey}`;
                const refetchResponse = await axios.get(refetchApiUrl, {
                    headers: { 'User-Agent': e6ai.userAgent },
                });

                if (refetchResponse.status === 200 && refetchResponse.data.posts.length > 0) {
                    const updatedPost = refetchResponse.data.posts[0];
                    const newReplyOptions = await generatePostMessage(updatedPost);
                    
                    const newMessage = await interaction.followUp(newReplyOptions);
                    await setupPostCollector(newMessage, interaction);
                } else {
                    await interaction.followUp({ content: 'Successfully replaced, but could not refresh the post message.' });
                }
            } else if (response.data && response.data.reason) {
               await interaction.editReply(`Failed to replace post ID ${postId}. API Reason: ${response.data.reason}`);
            } else if (response.data && response.data.message) {
               await interaction.editReply(`Failed to replace post ID ${postId}. API Message: ${response.data.message}`);
            } else if (response.data) { 
                await interaction.editReply(`Failed to replace post ID ${postId}. API Response: ${JSON.stringify(response.data).substring(0, 1500)} (Status: ${response.status})`);
            } else {
               await interaction.editReply(`Failed to replace post ID ${postId}. Status: ${response.status} - ${response.statusText}`);
            }
            
        } catch (error) {
            console.error('Error processing replace command:', error.isAxiosError ? error.toJSON() : error);
            let errorMessage = 'An error occurred while trying to process the replacement.';
            if (error.response) {
                errorMessage += ` API Error: ${error.response.status} - ${error.response.statusText}. `;
                if(error.response.data && (error.response.data.reason || error.response.data.message)) {
                    errorMessage += `Reason: ${error.response.data.reason || error.response.data.message}`;
                } else if (error.response.data) {
                    errorMessage += `Details: ${JSON.stringify(error.response.data).substring(0,500)}`;
                }
            } else if (error.request) {
                errorMessage += ' No response received from the API. Is the local server running and accessible?';
            } else {
                errorMessage += ` ${error.message}`;
            }
            await interaction.editReply({ content: errorMessage, ephemeral: true });
        }
    },
}; 