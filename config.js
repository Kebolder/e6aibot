require('dotenv').config();

const botVersion = require('./package.json').version;

module.exports = {
    ownerId: process.env.OWNER_ID,
    e6ai: {
        username: process.env.E6AI_USERNAME,
        apiKey: process.env.E6AI_API_KEY,
        baseUrl: process.env.E6AI_BASE_URL || 'https://e6ai.net/',
        userAgent: `E6aiBot/${botVersion} (by Slop on e6AI)`,
    },
    replaceCommandAllowedUserIds: [
        process.env.OWNER_ID,
        '439174124816957450',
        '252705915365621762',
        '1251068622454128721',
        '1101045525274435635',
        '1354090683912290416',
    ],
    // We can add other configurations here later
}; 