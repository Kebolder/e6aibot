const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { e6ai, ownerId } = require('../config.js');
const { generatePostMessage, getStatus } = require('./postEmbed.js');
const invalidCommandResponse = require('./dmail_responses/invalidCommand.js');

const DMAIL_CHECK_INTERVAL_MS = 15000;

const processedDmailIds = new Set();
let isCheckingDmail = false;

const dmailCommands = new Map();
const commandsPath = path.join(__dirname, 'dmail_commands');

if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        try {
            const command = require(filePath);
            if ('name' in command && 'execute' in command) {
                dmailCommands.set(command.name.toLowerCase(), command);
            } else {
                console.log(`[WARNING] The command at ${filePath} is missing a required "name" or "execute" property.`);
            }
        } catch (error) {
            console.error(`[ERROR] Failed to load command at ${filePath}:`, error);
        }
    }
} else {
    console.log(`[INFO] dmail_commands directory not found at ${commandsPath}. No dmail commands loaded.`);
}

async function markDmailAsRead(dmailId) {
    try {
        const url = `${e6ai.baseUrl}/dmails/${dmailId}`;
        await axios.get(url, {
            params: { login: e6ai.username, api_key: e6ai.apiKey },
            headers: { 
                'User-Agent': e6ai.userAgent,
                'Accept': 'text/html'
            }
        });
        console.log(`[DMAIL] Marked dmail ${dmailId} as read by visiting HTML page.`);
    } catch (error) {
        console.error(`[DMAIL] Failed to mark dmail ${dmailId} as read by visiting HTML page:`, error.message);
    }
}

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
            console.log('[DMAIL] Response was not an array of dmails. It may be an error:', dmails);
            return;
        }
    
        const unreadDmails = dmails.filter(dmail => !dmail.is_read);

        if (unreadDmails.length > 0) {
            for (const dmail of unreadDmails) {
                if (!processedDmailIds.has(dmail.id)) {
                    if (String(dmail.from_id) === e6ai.botE6aiId) {
                        continue;
                    }

                    const commandName = dmail.title?.toLowerCase();
                    const command = dmailCommands.get(commandName);

                    if (command) {
                        try {
                            await command.execute(dmail, client, { markDmailAsRead, processedDmailIds });
                        } catch (error) {
                            console.error(`[DMAIL] Error executing command '${commandName}' for dmail ${dmail.id}:`, error);
                        }
                    } else {
                        console.log(`[DMAIL] Invalid command '${dmail.title}' from user ${dmail.from_id}. Sending reply.`);
                        
                        await markDmailAsRead(dmail.id);

                        try {
                            const replyUrl = `${e6ai.baseUrl}/dmails.json`;
                            const formData = new FormData();
                            formData.append('dmail[to_id]', dmail.from_id);
                            formData.append('dmail[title]', invalidCommandResponse.title(dmail.title));
                            formData.append('dmail[body]', invalidCommandResponse.body);
                            
                            await axios.post(replyUrl, formData, {
                                params: { login: e6ai.username, api_key: e6ai.apiKey },
                                headers: { 
                                    ...formData.getHeaders(),
                                    'User-Agent': e6ai.userAgent 
                                }
                            });
                        } catch (error) {
                            if (error.response && error.response.status === 406) {
                                console.log(`[DMAIL] Successfully sent reply to user ${dmail.from_id} (API returned expected 406).`);
                            } else {
                                console.error(`[DMAIL] Failed to send reply dmail to user ${dmail.from_id}:`, error.message);
                            }
                        }
                        
                        processedDmailIds.add(dmail.id);
                    }
                }
            }
        } else {
            processedDmailIds.clear();
        }

    } catch (error) {
        console.error('[DMAIL] Error checking dmail:', error.isAxiosError ? error.message : error);
    } finally {
        isCheckingDmail = false;
    }
}

module.exports = {
    init: (client) => {
        checkDmail(client);
        setInterval(() => checkDmail(client), DMAIL_CHECK_INTERVAL_MS);
        console.log(`[INFO] Dmail checker initialized. Polling every ${DMAIL_CHECK_INTERVAL_MS / 1000} seconds.`);
    }
};