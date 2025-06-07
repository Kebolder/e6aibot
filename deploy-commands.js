require('dotenv').config(); // Load .env for BOT_TOKEN and CLIENT_ID
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const commands = [];
// Grab all the command folders from the modules directory you created earlier
const foldersPath = path.join(__dirname, 'modules');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    // Grab all the command files from the commands directory
    const commandsPath = path.join(foldersPath, folder);
    if (fs.statSync(commandsPath).isDirectory()) { // Ensure it's a directory
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        // Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                commands.push(command.data.toJSON());
                console.log(`[INFO] Added command ${command.data.name} for deployment.`);
            } else {
                console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property and was not added for deployment.`);
            }
        }
    }
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(process.env.BOT_TOKEN);

// and deploy your commands!
(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // The put method is used to fully refresh all commands in the guild with the current set
        // You'll need to add your CLIENT_ID and GUILD_ID to your .env file
        // For global commands, use Routes.applicationCommands(process.env.CLIENT_ID)
        // For guild-specific commands (recommended for testing), use Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
        
        if (!process.env.CLIENT_ID) {
            throw new Error('CLIENT_ID is not set in the .env file. Please add it.');
        }

        let route;
        if (process.env.GUILD_ID) {
            console.log('Deploying commands to guild: ' + process.env.GUILD_ID);
            route = Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID);
        } else {
            console.log('Deploying commands globally.');
            route = Routes.applicationCommands(process.env.CLIENT_ID);
        }

        const data = await rest.put(
            route,
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        // And of course, make sure you catch and log any errors!
        console.error(error);
    }
})(); 