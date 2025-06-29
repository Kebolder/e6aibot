const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const config = require('../config.js');

const { e6ai } = config;

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getStatus(flags) {
    if (flags.deleted) return 'Deleted';
    if (flags.pending) return 'Pending';
    return 'Active';
}

function formatDescription(text) {
    if (!text) return 'No description provided.';
    const formattedText = text
        .replace(/\[b\]\[i\]([\s\S]*?)\[\/i\]\[\/b\]/gi, '***$1***')
        .replace(/\[i\]\[b\]([\s\S]*?)\[\/b\]\[\/i\]/gi, '***$1***')
        .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '**$1**')
        .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '*$1*')
        .replace(/\[.*?\]/g, '');
    return formattedText;
}

async function generatePostMessage(post, withButtons = true) {
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
        .setDescription(formatDescription(post.description))
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

    const replyOptions = { embeds: [embed], files: [] };
    if (post.file && post.file.url) {
        const url = new URL(post.file.url);
        const fileName = url.pathname.split('/').pop();
        const attachment = new AttachmentBuilder(post.file.url, { name: fileName });
        
        if (['png', 'jpg', 'jpeg', 'gif'].includes(post.file.ext.toLowerCase())) {
            embed.setImage(`attachment://${fileName}`);
        }
        
        replyOptions.files = [attachment];
    }

    if (withButtons) {
        const buttons = new ActionRowBuilder();
        if (status === 'Deleted') {
            buttons.addComponents(
                new ButtonBuilder()
                    .setCustomId(`undelete:${post.id}`)
                    .setLabel('✅ Undelete')
                    .setStyle(ButtonStyle.Success)
            );
        } else {
            const isFirstApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:<${post.id} order:id_desc&limit=1`;
            const isLastApiUrl = `${e6ai.baseUrl}/posts.json?tags=id:>${post.id} order:id_asc&limit=1`;

            const [isFirstResponse, isLastResponse] = await Promise.all([
                axios.get(isFirstApiUrl, { headers: { 'User-Agent': e6ai.userAgent } }),
                axios.get(isLastApiUrl, { headers: { 'User-Agent': e6ai.userAgent } })
            ]);

            const isFirst = !(isFirstResponse.status === 200 && isFirstResponse.data.posts && isFirstResponse.data.posts.length > 0);
            const isLast = !(isLastResponse.status === 200 && isLastResponse.data.posts && isLastResponse.data.posts.length > 0);
            
            buttons.addComponents(
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
        }
        replyOptions.components = [buttons];
    }

    return replyOptions;
}

module.exports = { generatePostMessage, getStatus }; 