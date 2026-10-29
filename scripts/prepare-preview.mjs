// Build-only preview identity: never share storage/package identity with the production app.
import fs from 'node:fs';
const cap = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
cap.appId = 'com.familycashbook.preview';
cap.appName = 'Family Cashbook Preview';
fs.writeFileSync('capacitor.config.json', JSON.stringify(cap, null, 2) + '\n');
const desk = JSON.parse(fs.readFileSync('desktop/package.json', 'utf8'));
desk.productName = 'Family Cashbook Preview';
desk.build.productName = 'Family Cashbook Preview';
desk.build.appId = 'com.familycashbook.preview';
fs.writeFileSync('desktop/package.json', JSON.stringify(desk, null, 2) + '\n');
