const crypto = require('crypto');

// Generates a random string for the verifier
function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex');
}

// Hashes the verifier to create the challenge
function generateCodeChallenge(verifier) {
    return crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

module.exports = { generateRandomString, generateCodeChallenge };