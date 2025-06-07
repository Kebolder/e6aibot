const { SlashCommandBuilder } = require('discord.js');
const FormData = require('form-data');
const axios = require('axios');

const E6AI_USERNAME = process.env.E6AI_USERNAME;
const E6AI_API_KEY = process.env.E6AI_API_KEY;
const E6AI_BASE_URL = 'http://localhost:3000';
const ALLOWED_USER_IDS_REPLACE_CMD = process.env.ALLOWED_USER_IDS_REPLACE_CMD ? process.env.ALLOWED_USER_IDS_REPLACE_CMD.split(',') : [];

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
                .setRequired(true)),
    async execute(interaction) {
        // Permission Check
        if (ALLOWED_USER_IDS_REPLACE_CMD.length > 0 && !ALLOWED_USER_IDS_REPLACE_CMD.includes(interaction.user.id)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
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

        if (!E6AI_USERNAME || !E6AI_API_KEY) {
            await interaction.reply({ content: 'Bot owner has not configured E6AI_USERNAME or E6AI_API_KEY in the .env file.', ephemeral: true });
            console.error('Missing E6AI_USERNAME or E6AI_API_KEY in .env');
            return;
        }

        await interaction.deferReply();

        try {
            const imageResponse = await axios.get(imageAttachment.url, { responseType: 'stream' });

            const formData = new FormData();
            formData.append('post_replacement[replacement_file]', imageResponse.data, { 
                filename: imageAttachment.name, 
                contentType: imageAttachment.contentType 
            });
            formData.append('post_replacement[reason]', reason);

            const apiUrl = `${E6AI_BASE_URL}/post_replacements.json?post_id=${postId}&login=${E6AI_USERNAME}&api_key=${E6AI_API_KEY}`;
            console.log(`Submitting replacement to: ${apiUrl}`);
            console.log(`With Reason: ${reason}, File: ${imageAttachment.name}`);

            const response = await axios.post(
                apiUrl,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'User-Agent': `ReplacmentBot/1.0 (by ${E6AI_USERNAME} on e6AI)`,
                    },
                }
            );

            if (response.status === 200 || response.status === 201 || response.status === 204 ) {
                if (response.data && response.data.location) {
                    await interaction.editReply(`Successfully submitted replacement for post ID ${postId}. New location: ${response.data.location}`);
                } else if (response.data && response.data.success === true) {
                    await interaction.editReply(`Successfully submitted replacement for post ID ${postId}.`);
                } else if (response.data && response.data.id) {
                     await interaction.editReply(`Successfully submitted replacement for post ID ${postId}. Replacement/Post ID: ${response.data.id}`);
                } else {
                    await interaction.editReply(`Successfully submitted replacement for post ID ${postId} (Status: ${response.status}). Check details if available.`);
                    console.log('API Response on success:', response.data);
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