const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const FormData = require('form-data');
const { e6ai, ownerId } = require('../config.js');
const { generatePostMessage, getStatus } = require('./postEmbed.js');

const DMAIL_CHECK_INTERVAL_MS = 15000; // 15 seconds

// This set will store the IDs of dmails that have already been processed
// to prevent duplicate notifications during a single run.
const processedDmailIds = new Set();
let isCheckingDmail = false;

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
    if (isCheckingDmail) {
        console.log('[DMAIL] A dmail check is already in progress. Skipping this interval.');
        return;
    }

    isCheckingDmail = true;
    try {
        if (!e6ai.username || !e6ai.apiKey || !e6ai.botE6aiId) {
            console.log('[DMAIL] E6AI credentials or bot user ID not provided in config. Skipping dmail check.');
            return;
        }

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
                            formData.append('dmail[body]', `h5. Invalid Command

[quote]
[b]Hello![/b] It seems the command in your message's title is not valid.

I am a bot, and my commands are based on the Dmail [b]title[/b]. Please check the "HOW TO USE" section on my [b]"About Me":https://e6ai.net/users/42811[/b] page for a list of valid commands and their required formats.

If you believe this is an error, please feel free to contact my [b]"owner":https://e6ai.net/users/26091[/b].
[/quote]`);
                            
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

                    const body = dmail.body || '';
                    const postLinkRegex = /^Post:\s*(https?:\/\/e6ai\.net\/posts\/(\d+))/im;
                    const newImageRegex = /^New Image:\s*(https?:\/\/[^\s]+)/im;

                    const postLinkMatch = body.match(postLinkRegex);
                    const newImageMatch = body.match(newImageRegex);

                    const postId = postLinkMatch ? postLinkMatch[2] : null;
                    const postLink = postLinkMatch ? postLinkMatch[1] : null;
                    const replacementLink = newImageMatch ? newImageMatch[1] : null;

                    if (!postId || !replacementLink) {
                        console.log(`[DMAIL] Invalid replacement request from ${dmail.from_id}. Missing post or replacement link.`);
                        await markDmailAsRead(dmail.id);

                        try {
                            const replyUrl = `${e6ai.baseUrl}/dmails.json`;
                            const formData = new FormData();
                            formData.append('dmail[to_id]', dmail.from_id);
                            formData.append('dmail[title]', `Re: ${dmail.title}`);
                            formData.append('dmail[body]', `h5. Invalid Replacement Request

[quote]
[b]Oops![/b] It looks like your replacement request wasn't formatted correctly.

To successfully request a replacement, please make sure the body of your message follows this exact format:

[quote]
Post: [i]REPLACE_WITH_E6AI_POST_LINK[/i]
New Image: [i]REPLACE_WITH_DIRECT_IMAGE_LINK[/i]
[/quote]

* The "Post" link [u]must[/u] be a valid link to a post on e6ai.net.
* The "New Image" link [u]must[/u] be a direct link to an image file.

For more detailed instructions and a helpful example, please check out the "HOW TO USE" section on my [b] "About Me":https://e6ai.net/users/42811 [/b] page.

If you continue to have issues, you can reach out to my [b]"owner here":https://e6ai.net/users/26091[/b].
[/quote]`);
                            
                            await axios.post(replyUrl, formData, {
                                params: { login: e6ai.username, api_key: e6ai.apiKey },
                                headers: { 
                                    ...formData.getHeaders(),
                                    'User-Agent': e6ai.userAgent 
                                }
                            });
                        } catch (error) {
                            if (error.response && error.response.status === 406) {
                                console.log(`[DMAIL] Sent invalid replacement reply to ${dmail.from_id} (expected 406).`);
                            } else {
                                console.error(`[DMAIL] Failed to send invalid replacement reply to ${dmail.from_id}:`, error.message);
                            }
                        }
                        
                        processedDmailIds.add(dmail.id);
                        continue;
                    }

                    console.log('[DMAIL] New replacement request received:', dmail);

                    const embed = new EmbedBuilder()
                        .setTitle('REPLACEMENT REQUEST')
                        .setDescription(dmail.body || '*No content*')
                        .addFields(
                            { name: 'Post to Replace', value: `[View Post](${postLink})` },
                            { name: 'New Image Link', value: replacementLink }
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

                        try {
                            const postApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${postId}`;
                            const postResponse = await axios.get(postApiUrl, {
                                headers: { 'User-Agent': e6ai.userAgent },
                            });

                            if (postResponse.status === 200 && postResponse.data.posts && postResponse.data.posts.length > 0) {
                                const post = postResponse.data.posts[0];
                                if (getStatus(post.flags) !== 'Deleted') {
                                    const postMessage = await generatePostMessage(post, false);
                                    await channel.send(postMessage);
                                } else {
                                    await channel.send(`The post in the replacement request (\`ID: ${postId}\`) has been deleted.`);
                                }
                            } else {
                                await channel.send(`The post in the replacement request (\`ID: ${postId}\`) could not be found.`);
                            }
                        } catch (error) {
                            console.error(`[DMAIL] Failed to fetch and display post ${postId}:`, error.message);
                            await channel.send(`There was an error trying to display post \`ID: ${postId}\`.`);
                        }
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
    } finally {
        isCheckingDmail = false;
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