require('dotenv').config();

const botVersion = require('./package.json').version;

module.exports = {
    ownerId: process.env.OWNER_ID,
    e6ai: {
        username: process.env.E6AI_USERNAME,
        apiKey: process.env.E6AI_API_KEY,
        botE6aiId: process.env.E6AI_BOT_USER_ID,
        baseUrl: (process.env.E6AI_BASE_URL || 'https://e6ai.net/').replace(/\/$/, ""),
        userAgent: `E6aiBot/${botVersion} (by Slop on e6AI)`,
    },
    replaceCommandAllowedUserIds: [
        process.env.OWNER_ID, // Me
        '439174124816957450', // Also Me
        '252705915365621762', // Cut
        '1251068622454128721', // Jello
        '1101045525274435635', // Sawmill
        '1354090683912290416', // Grid
        "118879458957459456", // Mlem
        "174051210846797824", // Hydra
        "90532903322148864", // Draco
        "336999080704081921", // Puppy
        "1098999501475291196", // Cinder Block
        
        
    ],
    // We can add other configurations here later
}; 