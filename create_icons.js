const fs = require('fs');
const path = require('path');

// Ensure icons dir exists
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Write SVG Dragon Logo
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="128" height="128">
  <defs>
    <linearGradient id="dragonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ec4899" />
      <stop offset="50%" stop-color="#8b5cf6" />
      <stop offset="100%" stop-color="#3b82f6" />
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="100" height="100" rx="22" fill="#0f172a"/>
  <circle cx="50" cy="50" r="40" fill="url(#dragonGrad)" opacity="0.2"/>
  <path d="M30 68 C35 50, 40 45, 50 35 C60 25, 75 30, 70 45 C65 60, 50 55, 45 65 C40 75, 60 75, 70 70 M50 35 C45 30, 40 25, 45 20 M60 40 C65 35, 70 35, 75 30" 
        stroke="url(#dragonGrad)" stroke-width="6" stroke-linecap="round" fill="none" filter="url(#glow)"/>
  <circle cx="55" cy="30" r="4" fill="#f472b6"/>
</svg>`;

fs.writeFileSync(path.join(iconsDir, 'dragon_logo.svg'), svgContent);

// Function to generate raw minimal valid PNG buffer
function createMinimalPNG(width, height) {
  // Simple PNG header & data chunk generator for colored icon box
  const zlib = require('zlib');
  
  // Header
  const header = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const crcVal = crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const rawPixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    rawPixels[rowOffset] = 0; // Filter type None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      // Dark purple background with glowing dragon pink accent
      const dist = Math.hypot(x - width/2, y - height/2);
      if (dist < width * 0.45) {
        rawPixels[pxOffset] = 236;     // R
        rawPixels[pxOffset + 1] = 72;  // G
        rawPixels[pxOffset + 2] = 153; // B
        rawPixels[pxOffset + 3] = 255; // A
      } else {
        rawPixels[pxOffset] = 15;      // R
        rawPixels[pxOffset + 1] = 23;  // G
        rawPixels[pxOffset + 2] = 42;  // B
        rawPixels[pxOffset + 3] = 255; // A
      }
    }
  }

  const compressed = zlib.deflateSync(rawPixels);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Standard CRC32 calculation
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    for (let j = 0; j < 8; j++) {
      const bit = (crc ^ byte) & 1;
      crc = (crc >>> 1) ^ (bit ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

[16, 48, 128].forEach(size => {
  const pngBuf = createMinimalPNG(size, size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), pngBuf);
  console.log(`Generated icon${size}.png`);
});

console.log('Icon creation completed!');
