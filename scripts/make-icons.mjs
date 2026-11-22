// Generates the app icons from one original SVG (no vendor logos).
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#0b3d91"/>
  <g transform="translate(${pad ? 76 : 56} ${pad ? 76 : 56}) scale(${pad ? 0.703 : 0.781})" fill="none" stroke="#ffffff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="256" cy="256" r="150"/>
    <path d="M256 40v66M256 406v66M40 256h66M406 256h66"/>
    <path d="M200 300l40-90h40l-30 60h50l-70 100 20-70z" fill="#ffd23f" stroke="#ffd23f" stroke-width="10"/>
  </g>
</svg>`;

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon.svg', svg(false));
await sharp(Buffer.from(svg(false))).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(Buffer.from(svg(false))).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(Buffer.from(svg(true))).resize(512, 512).png().toFile('public/icons/icon-maskable-512.png');
console.log('icons written');
