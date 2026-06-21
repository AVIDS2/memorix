const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const memcodeRoot = path.join(root, 'packages', 'memcode');
const outRoot = path.join(root, 'dist', 'memcode-runtime');

function copyPath(from, to) {
  fs.cpSync(from, to, { recursive: true, force: true });
}

function copyFileIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

copyFileIfExists(path.join(memcodeRoot, 'package.json'), path.join(outRoot, 'package.json'));
copyFileIfExists(path.join(memcodeRoot, 'README.md'), path.join(outRoot, 'README.md'));
copyFileIfExists(path.join(root, 'CHANGELOG.md'), path.join(outRoot, 'CHANGELOG.md'));

for (const dir of ['docs']) {
  const source = path.join(memcodeRoot, dir);
  if (fs.existsSync(source)) {
    copyPath(source, path.join(outRoot, dir));
  }
}

copyPath(
  path.join(memcodeRoot, 'src', 'modes', 'interactive', 'theme'),
  path.join(outRoot, 'dist', 'modes', 'interactive', 'theme'),
);
fs.mkdirSync(path.join(outRoot, 'dist', 'modes', 'interactive', 'assets'), { recursive: true });

const exportHtmlSource = path.join(memcodeRoot, 'src', 'core', 'export-html');
const exportHtmlOut = path.join(outRoot, 'dist', 'core', 'export-html');
fs.mkdirSync(path.join(exportHtmlOut, 'vendor'), { recursive: true });
for (const file of ['template.html', 'template.css', 'template.js']) {
  copyFileIfExists(path.join(exportHtmlSource, file), path.join(exportHtmlOut, file));
}
copyPath(path.join(exportHtmlSource, 'vendor'), path.join(exportHtmlOut, 'vendor'));

console.log('✓ Copied memcode runtime assets');
