const fs = require('fs');
const path = require('path');

// Read the file
const filePath = path.join(__dirname, 'src', 'extension.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Fix the phpMatch references in the standard if statement section
content = content.replace(
  /const startPos = document\.positionAt\(phpMatch\.index\);(\s+)const endPos = document\.positionAt\(phpMatch\.index \+ phpMatch\[0\]\.length\);/,
  'const startPos = document.positionAt(match.index);$1const endPos = document.positionAt(match.index + match[0].length);'
);

// Write the fixed content back to the file
fs.writeFileSync(filePath, content, 'utf8');

console.log('Fixed TypeScript errors in extension.ts');
