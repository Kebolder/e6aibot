const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const FormData = require('form-data');
const { e6ai, ownerId } = require('../config.js');

const DMAIL_CHECK_INTERVAL_MS = 15000; // 15 seconds

// This set will store the IDs of dmails that have already been processed
// to prevent duplicate notifications during a single run.
const processedDmailIds = new Set();

/**
 * Marks a dmail as read on e6ai.
 * @param {number} dmailId The ID of the dmail to mark as read.
 */
async function markDmailAsRead(dmailId) {
    try {
        const url = `${e6ai.baseUrl}/dmails/${dmailId}`; // No .json extension
        // Per user feedback, visiting the HTML page marks it as read.
        await axios.get(url, {
            params: { login: e6ai.username, api_key: e6ai.apiKey },
            headers: { 
                'User-Agent': e6ai.userAgent,
                // Behave more like a browser visiting the page.
                'Accept': 'text/html'
            }
        });
        console.log(`[DMAIL] Marked dmail ${dmailId} as read by visiting HTML page.`);
    } catch (error) {
        console.error(`[DMAIL] Failed to mark dmail ${dmailId} as read by visiting HTML page:`, error.message);
    }
}

/**
 * Checks for new dmails on e6ai.
 * If the user's profile indicates new mail, it fetches all dmails,
 * processes the unread ones, logs them, and notifies the owner.
 * @param {import('discord.js').Client} client The Discord client instance.
 */
async function checkDmail(client) {
    if (!e6ai.username || !e6ai.apiKey || !e6ai.botE6aiId) {
        console.log('[DMAIL] E6AI credentials or bot user ID not provided in config. Skipping dmail check.');
        return;
    }

    try {
        // Step 1: Directly fetch all dmails.
        const dmailUrl = `${e6ai.baseUrl}/dmails.json`;
        const dmailResponse = await axios.get(dmailUrl, {
            params: { 
                login: e6ai.username, 
                api_key: e6ai.apiKey 
            },
            headers: { 'User-Agent': e6ai.userAgent }
        });

        const dmails = dmailResponse.data;
        if (!Array.isArray(dmails)) {
            // If the response isn't an array, it might be an error object.
            console.log('[DMAIL] Response was not an array of dmails. It may be an error:', dmails);
            return;
        }
        
        // --- Step 2: Process unread dmails ---
        // Assumes dmail objects have `id`, `is_read`, `from_id`, `title`, and `body` properties.
        const unreadDmails = dmails.filter(dmail => !dmail.is_read);

        if (unreadDmails.length > 0) {
            for (const dmail of unreadDmails) {
                if (!processedDmailIds.has(dmail.id)) {
                    // Prevent the bot from replying to its own messages.
                    if (String(dmail.from_id) === e6ai.botE6aiId) {
                        continue;
                    }

                    // If the title is not "Replacement", send a reply, ignoring the expected 406 error.
                    if (dmail.title?.toLowerCase() !== 'replacement') {
                        console.log(`[DMAIL] Invalid title from user ${dmail.from_id}. Sending reply.`);
                        
                        await markDmailAsRead(dmail.id);

                        try {
                            const replyUrl = `${e6ai.baseUrl}/dmails.json`;
                            const formData = new FormData();
                            formData.append('dmail[to_id]', dmail.from_id);
                            formData.append('dmail[title]', `Re: ${dmail.title}`);
                            formData.append('dmail[body]', `This is an automated message. I can only process dmails with the exact title 'Replacement'. Please correct the title and resend your request.`);
                            
                            await axios.post(replyUrl, formData, {
                                params: { login: e6ai.username, api_key: e6ai.apiKey },
                                headers: { 
                                    ...formData.getHeaders(),
                                    'User-Agent': e6ai.userAgent 
                                }
                            });
                        } catch (error) {
                            // The user confirmed the reply is sent despite a 406 error.
                            // We will ignore the 406 error to prevent log spam, but log others.
                            if (error.response && error.response.status === 406) {
                                console.log(`[DMAIL] Successfully sent reply to user ${dmail.from_id} (API returned expected 406).`);
                            } else {
                                console.error(`[DMAIL] Failed to send reply dmail to user ${dmail.from_id}:`, error.message);
                            }
                        }
                        
                        processedDmailIds.add(dmail.id);
                        continue;
                    }

                    console.log('[DMAIL] New replacement request received:', dmail);

                    // Extract the first number from the body and assume it's the Post ID.
                    const postIdMatch = dmail.body?.match(/\d+/);
                    const postId = postIdMatch ? postIdMatch[0] : null;
                    const postLink = postId ? `${e6ai.baseUrl}posts/${postId}` : 'Not provided in body';

                    const embed = new EmbedBuilder()
                        .setTitle('REPLACEMENT REQUEST')
                        .setDescription(dmail.body || '*No content*')
                        .addFields(
                            { name: 'Post ID:', value: postLink, inline: true },
                            { name: '\u200B', value: '\u200B', inline: true }
                        )
                        .setColor('#fbfe4d')
                        .setTimestamp(new Date(dmail.created_at));

                    // Fetch user info for the author field
                    if (dmail.from_id) {
                        try {
                            const userUrl = `${e6ai.baseUrl}/users/${dmail.from_id}.json`;
                            const userResponse = await axios.get(userUrl, {
                                params: { login: e6ai.username, api_key: e6ai.apiKey },
                                headers: { 'User-Agent': e6ai.userAgent }
                            });
                            const sender = userResponse.data;
                            if (sender?.name) {
                                embed.setAuthor({ 
                                    name: `Message from: ${sender.name}`, 
                                    url: `${e6ai.baseUrl}users/${dmail.from_id}`
                                });
                            } else {
                                embed.setAuthor({ name: `Message from: User ID ${dmail.from_id}` });
                            }
                        } catch (error) {
                            console.error(`[DMAIL] Could not fetch user details for ID ${dmail.from_id}:`, error.message);
                            embed.setAuthor({ name: `Message from: User ID ${dmail.from_id} (Error fetching name)` });
                        }
                    } else {
                        embed.setAuthor({ name: 'Message from: Unknown Sender' });
                    }

                    const targetChannelId = '1381330639525249166';
                    const channel = await client.channels.fetch(targetChannelId).catch(() => null);

                    if (channel && channel.isTextBased()) {
                        await channel.send({ embeds: [embed] });
                    } else {
                        console.error(`[DMAIL] Could not find channel with ID ${targetChannelId} or it's not a text channel.`);
                        const owner = await client.users.fetch(ownerId).catch(() => null);
                        if (owner) {
                            await owner.send({ content: `**Error:** Failed to send dmail notification to channel \`${targetChannelId}\`. Please check my permissions.`, embeds: [embed] });
                        }
                    }

                    await markDmailAsRead(dmail.id);
                    processedDmailIds.add(dmail.id);
                }
            }
        } else {
            // If there are no unread dmails, clear the processed set.
            // This is important because the API only shows unread mail,
            // so once all are read, the list will be empty.
            processedDmailIds.clear();
        }

    } catch (error) {
        console.error('[DMAIL] Error checking dmail:', error.isAxiosError ? error.message : error);
    }
}

module.exports = {
    /**
     * Initializes the dmail checker module.
     * @param {import('discord.js').Client} client The Discord client instance.
     */
    init: (client) => {
        // Run the check once on startup, then on the specified interval.
        checkDmail(client);
        setInterval(() => checkDmail(client), DMAIL_CHECK_INTERVAL_MS);
        console.log(`[INFO] Dmail checker initialized. Polling every ${DMAIL_CHECK_INTERVAL_MS / 1000} seconds.`);
    }
};