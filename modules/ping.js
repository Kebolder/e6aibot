const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { version } = require('../package.json');

function getUptime(client) {
    let totalSeconds = (client.uptime / 1000);
    let days = Math.floor(totalSeconds / 86400);
    totalSeconds %= 86400;
    let hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = Math.floor(totalSeconds % 60);
    return `${days}d, ${hours}h, ${minutes}m, ${seconds}s`;
}

const originalEmbed = new EmbedBuilder()
    .setAuthor({
        name: "Info",
    })
    .setDescription("If you need something specific, please use the buttons below!")
    .setColor("#00b7ff");

const aboutButton = new ButtonBuilder()
    .setCustomId('about')
    .setLabel('About')
    .setStyle(ButtonStyle.Secondary);

const profileLinkButton = new ButtonBuilder()
    .setLabel('My Profile')
    .setURL('https://e6ai.net/users/42811')
    .setStyle(ButtonStyle.Link);

const originalRow = new ActionRowBuilder()
    .addComponents(aboutButton, profileLinkButton);

module.exports = {
  init: (client) => {
    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;

      if (message.mentions.has(client.user)) {
        await message.channel.sendTyping();
        await message.reply({
          content: `Howdy <@${message.author.id}>! How can I help you?`,
          embeds: [originalEmbed],
          components: [originalRow]
        });
      }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isButton()) return;

        if (interaction.customId === 'about') {
            const aboutEmbed = new EmbedBuilder()
                .setAuthor({
                    name: "Info!",
                })
                .setDescription("I'm E6AI bot. Created by <@439174124816957450>\n\nI was created to automate some tasks! I offer on-site commands via Dmail. You can use the button below to send me one.")
                .addFields(
                    {
                        name: "`/view`",
                        value: "Allows you to view a post by its #id"
                    },
                    {
                        name: "`/requestreplace`",
                        value: "Request a replacement image for a user (Not yet implemented)"
                    },
                    {
                        name: "Version",
                        value: version,
                        inline: true
                    },
                    {
                        name: "Uptime",
                        value: getUptime(client),
                        inline: true
                    }
                )
                .setColor("#ffea00");

            const backButton = new ButtonBuilder()
                .setCustomId('back_to_ping_main')
                .setLabel('Back')
                .setStyle(ButtonStyle.Danger);
            
            const dmailButton = new ButtonBuilder()
                .setLabel('Dmail Me')
                .setURL('https://e6ai.net/dmails/new?dmail%5Bto_id%5D=42811')
                .setStyle(ButtonStyle.Link);

            const profileButton = new ButtonBuilder()
                .setLabel('My profile')
                .setURL('https://e6ai.net/users/42811')
                .setStyle(ButtonStyle.Link);

            const aboutRow = new ActionRowBuilder().addComponents(backButton, dmailButton, profileButton);

            await interaction.update({ embeds: [aboutEmbed], components: [aboutRow] });
        }

        if (interaction.customId === 'back_to_ping_main') {
            await interaction.update({ embeds: [originalEmbed], components: [originalRow] });
        }
    });
  },
}; 