const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { execSync } = require('child_process');

if (!process.env.GH_TOKEN) {
    console.error("Error: GH_TOKEN is missing from .env! Cannot publish release.");
    process.exit(1);
}

console.log("Starting electron-builder with secure environment injection...");
try {
    execSync('npx electron-builder --publish always', {
        env: process.env,
        stdio: 'inherit'
    });
} catch (e) {
    process.exit(1);
}
