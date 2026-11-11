/**
 * Copy dashboard static files to dist directory
 */
const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
        const srcPath = path.join(src, entry);
        const destPath = path.join(dest, entry);
        if (fs.statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

const src = path.join(process.cwd(), 'src', 'dashboard', 'static');
const dest = path.join(process.cwd(), 'dist', 'dashboard', 'static');

copyDir(src, dest);
console.log('✓ Copied dashboard static files');
