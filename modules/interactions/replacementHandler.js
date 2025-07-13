const axios = require('axios');
const FormData = require('form-data');
const { e6ai } = require('../../config.js');

async function handleReplacement(interaction, client) {
    const [action, postId, targetUserId] = interaction.customId.split('_');

    if (action === 'accept-replacement') {
        await interaction.reply({ content: `Replacement for post ${postId} accepted. Informing user ${targetUserId}.`, ephemeral: true });

        try {
            const replyUrl = `${e6ai.baseUrl}/dmails.json`;
            const formData = new FormData();
            formData.append('dmail[to_id]', targetUserId);
            formData.append('dmail[title]', 'Replacement Request Approved');
            formData.append('dmail[body]', `Your replacement request for post #${postId} has been approved and will be processed shortly.`);
            
            await axios.post(replyUrl, formData, {
                params: { login: e6ai.username, api_key: e6ai.apiKey },
                headers: { 
                    ...formData.getHeaders(),
                    'User-Agent': e6ai.userAgent 
                }
            });
        } catch (error) {
            console.error(`[DMAIL] Failed to send approval dmail to ${targetUserId}:`, error.message);
        }

    } else if (action === 'decline-replacement') {
        await interaction.reply({ content: `Replacement for post ${postId} declined. Informing user ${targetUserId}.`, ephemeral: true });

        try {
            const replyUrl = `${e6ai.baseUrl}/dmails.json`;
            const formData = new FormData();
            formData.append('dmail[to_id]', targetUserId);
            formData.append('dmail[title]', 'Replacement Request Declined');
            formData.append('dmail[body]', `Your replacement request for post #${postId} has been declined.`);
            
            await axios.post(replyUrl, formData, {
                params: { login: e6ai.username, api_key: e6ai.apiKey },
                headers: { 
                    ...formData.getHeaders(),
                    'User-Agent': e6ai.userAgent 
                }
            });
        } catch (error) {
            console.error(`[DMAIL] Failed to send denial dmail to ${targetUserId}:`, error.message);
        }
    }
    const message = interaction.message;
    const components = message.components[0].components.map(component => {
        return component.toJSON();
    });

    for (const component of components) {
        component.disabled = true;
    }

    await message.edit({
        components: [{ type: 1, components }]
    });
}

module.exports = { handleReplacement }; 