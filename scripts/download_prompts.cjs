const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const CONFIG_PATH = path.join(__dirname, '../src/config/promptConfig.ts');
const OUTPUT_DIR = path.join(__dirname, '../public/prompts');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const fileContent = fs.readFileSync(CONFIG_PATH, 'utf8');
const lines = fileContent.split('\n');

const downloads = [];
let currentId = null;

// Parse line by line
// Prompt ID indentation is 8 spaces: `        id: "..."`
// Prompt Image indentation is 8 spaces: `        previewImage: "..."`
// Category ID indentation is 4 spaces: `    id: "..."`

const idRegex = /^\s{8}id:\s*"([^"]+)",/;
const imgRegex = /^\s{8}previewImage:\s*"([^"]+)",/;

for (const line of lines) {
    const idMatch = line.match(idRegex);
    if (idMatch) {
        currentId = idMatch[1];
        continue;
    }

    const imgMatch = line.match(imgRegex);
    if (imgMatch && currentId) {
        downloads.push({ id: currentId, url: imgMatch[1] });
        // Don't reset currentId here, though usually unique per object.
        // But reset after object closes? No need, next ID will overwrite.
    }
}

console.log(`Found ${downloads.length} images to download.`);

async function downloadImage(id, url) {
    return new Promise((resolve, reject) => {
        // Determine extension
        let ext = '.jpg';
        const pathname = new URL(url).pathname;
        if (pathname.endsWith('.png')) ext = '.png';
        if (pathname.endsWith('.jpeg')) ext = '.jpeg';
        if (pathname.endsWith('.webp')) ext = '.webp';

        const filename = `${id}${ext}`;
        const filePath = path.join(OUTPUT_DIR, filename);

        const file = fs.createWriteStream(filePath);

        const request = https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(() => {
                        console.log(`Downloaded: ${filename}`);
                        resolve({ id, filename, originalUrl: url });
                    });
                });
            } else if (response.statusCode === 301 || response.statusCode === 302) {
                // Handle redirect
                const newUrl = response.headers.location;
                downloadImage(id, newUrl).then(resolve).catch(reject);
            } else {
                file.close();
                fs.unlink(filePath, () => { });
                reject(`Failed to download ${url}: Status Code ${response.statusCode}`);
            }
        });

        request.on('error', (err) => {
            fs.unlink(filePath, () => { });
            reject(err.message);
        });
    });
}

async function run() {
    const results = [];
    for (const item of downloads) {
        try {
            const result = await downloadImage(item.id, item.url);
            results.push(result);
        } catch (e) {
            console.error(`Error downloading ${item.id}:`, e);
            // We push a failure result so we know not to replace it?
            // Or just skip replacement.
        }
    }

    console.log('--- MAPPING START ---');
    console.log(JSON.stringify(results, null, 2));
    console.log('--- MAPPING END ---');
}

run();
