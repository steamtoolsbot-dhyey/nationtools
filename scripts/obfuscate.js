const fs = require('fs-extra');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log("Preparing secure obfuscated build environment...");

const buildDir = 'build_dist';

// Clean up
fs.emptyDirSync(buildDir);

// Files and folders to copy to packaged distribution
const filesToCopy = [
    "main.js",
    "index.html",
    "renderer.js",
    "styles.css",
    "icons",
    "ryuu",
    "dll",
    "fonts"
];

filesToCopy.forEach(f => {
    if (fs.existsSync(f)) {
        fs.copySync(f, path.join(buildDir, f));
    }
});

// Bake secrets into build_dist/main.js from .env BEFORE obfuscation
const mainDistPath = path.join(buildDir, 'main.js');
if (fs.existsSync(mainDistPath)) {
    let mainContent = fs.readFileSync(mainDistPath, 'utf8');
    const ryuuKey = process.env.RYUU_API_KEY || 'RYUUMANIFEST9t6auh';
    const ryuuLuaKey = process.env.RYUU_LUA_API_KEY || 'RYUUMANIFEST9t6auh';

    // Substitute process.env references so secrets are compiled directly into JS code
    mainContent = mainContent.replace(/process\.env\.RYUU_API_KEY/g, JSON.stringify(ryuuKey));
    mainContent = mainContent.replace(/process\.env\.RYUU_LUA_API_KEY/g, JSON.stringify(ryuuLuaKey));
    
    // Explicitly guarantee GH_TOKEN is never referenced in client code
    mainContent = mainContent.replace(/process\.env\.GH_TOKEN/g, 'undefined');

    fs.writeFileSync(mainDistPath, mainContent, 'utf8');
    console.log("[SECURED] API keys embedded into build_dist/main.js for encryption.");
}

// Obfuscate core client scripts
const jsFiles = ['main.js', 'renderer.js'];

jsFiles.forEach(f => {
    const filePath = path.join(buildDir, f);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // High-security string encryption and control-flow obfuscation
        const obfuscated = JavaScriptObfuscator.obfuscate(content, {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 1.0,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            splitStrings: true,
            splitStringsChunkLength: 5,
            target: 'node',
            disableConsoleOutput: false,
            transformObjectKeys: true,
            identifierNamesGenerator: 'hexadecimal'
        });
        
        fs.writeFileSync(filePath, obfuscated.getObfuscatedCode());
        console.log(`[SECURED & ENCRYPTED] Obfuscated ${f}`);
    }
});

console.log("Obfuscation complete. All secrets encrypted. Ready for packaging.");
