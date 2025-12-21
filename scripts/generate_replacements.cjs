const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../src/config/promptConfig.ts');
const IMAGES_DIR = path.join(__dirname, '../public/prompts');
const OUTPUT_JSON = path.join(__dirname, 'replacements.json');

const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
const lines = fileContent.split('\n');

const availableImages = {};
if (fs.existsSync(IMAGES_DIR)) {
    const files = fs.readdirSync(IMAGES_DIR);
    for (const f of files) {
        const name = path.parse(f).name;
        availableImages[name] = f;
    }
}

const chunks = [];
let currentId = null;

const idRegex = /^\s{8}id:\s*"([^"]+)",/;
const imgRegex = /^(\s{8}previewImage:\s*)"([^"]+)"(.*)/;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const idMatch = line.match(idRegex);
    if (idMatch) {
        currentId = idMatch[1];
        continue;
    }

    const imgMatch = line.match(imgRegex);
    if (imgMatch && currentId) {
        const filename = availableImages[currentId];
        if (filename) {
            const newPath = `/prompts/${filename}`;
            const prefix = imgMatch[1];
            const suffix = imgMatch[3] || '';

            // Reconstruct the line exactly but with new URL
            // Original line was: prefix + "oldUrl" + suffix
            // New line is: prefix + "newPath" + suffix
            // We need to be careful about quotes.
            // regex: `^(\s{8}previewImage:\s*)"([^"]+)"(.*)`
            // group 1: `        previewImage: `
            // group 2: URL
            // group 3: `,`

            // Wait, my regex in `generate_replacements.cjs` attempt 1 was slightly different.
            // Let's stick to the one that worked: `^(\s{8}previewImage:\s*)"([^"]+)"(.*)`
            // `"` are NOT in group 1 or 2? 
            // `^(\s{8}previewImage:\s*)` -> matches up to start of value if value starts with `"`?
            // No, `\s*` matches spaces. Then `"` matches literal quote.
            // So Group 1 ends BEFORE the quote.
            // Group 2 is INSIDE quotes.
            // Group 3 starts AFTER the closing quote.

            const replacementContent = `${prefix}"${newPath}"${suffix}`;

            chunks.push({
                StartLine: lineNum,
                EndLine: lineNum,
                TargetContent: line,
                ReplacementContent: replacementContent,
                AllowMultiple: false
            });
        }
    }
}

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(chunks, null, 2));
console.log(`Generated ${chunks.length} replacements.`);
