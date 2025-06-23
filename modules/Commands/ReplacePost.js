const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const FormData = require('form-data');
const axios = require('axios');
const config = require('../../config.js');

const { e6ai, replaceCommandAllowedUserIds } = config;

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
                .setDescription('The new image to upload.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the replacement (min 5 characters).')
                .setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    async execute(interaction) {
        if (replaceCommandAllowedUserIds.length > 0 && !replaceCommandAllowedUserIds.includes(interaction.user.id)) {
            await interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
            return;
        }

        const postId = interaction.options.getString('post_id');
        const imageAttachment = interaction.options.getAttachment('image');
        let reason = interaction.options.getString('reason');

        if (reason.length < 5) {
            await interaction.reply({ content: 'The reason for replacement must be at least 5 characters long.', ephemeral: true });
            return;
        }

        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(imageAttachment.contentType)) {
            await interaction.reply({ content: 'Please upload a valid image type (PNG, JPG, GIF, WEBP).', ephemeral: true });
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
                    .setTitle('OLD')
                    .setURL(`${e6ai.baseUrl}/posts/${postId}`)
                    .setImage(oldImageUrl);

                const newEmbed = new EmbedBuilder()
                    .setColor(0x33cc33)
                    .setTitle('REPLACEMENT')
                    .setURL(`${e6ai.baseUrl}/posts/${postId}`)
                    .setImage(imageAttachment.url);
                
                await interaction.editReply({ embeds: [oldEmbed, newEmbed] });
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