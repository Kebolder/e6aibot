const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const FormData = require('form-data');
const { e6ai, ownerId } = require('../../config.js');
const { generatePostMessage } = require('../postEmbed.js');

module.exports = {
    name: 'replacement',
    async execute(dmail, client, { markDmailAsRead, processedDmailIds }) {
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
            return;
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
                        url: `${e6ai.baseUrl}/users/${dmail.from_id}`
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
                let postApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${postId}`;
                 let postResponse = await axios.get(postApiUrl, {
                    headers: { 'User-Agent': e6ai.userAgent },
                });

                if (postResponse.status === 200 && (!postResponse.data.posts || postResponse.data.posts.length === 0)) {
                    console.log(`[DMAIL] Post ${postId} not found publicly, trying with authentication.`);
                    postApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:${postId}+status:any&login=${e6ai.username}&api_key=${e6ai.apiKey}`;
                    postResponse = await axios.get(postApiUrl, {
                        headers: { 'User-Agent': e6ai.userAgent },
                    });
                }
                

                if (postResponse.status === 200 && postResponse.data.posts && postResponse.data.posts.length > 0) {
                    const post = postResponse.data.posts[0];
                    const postMessage = await generatePostMessage(post, false);
                    await channel.send(postMessage);
                } else {
                    await channel.send(`The post in the replacement request (\`ID: ${postId}\`) could not be found, even with janitor permissions.`);
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
}; 