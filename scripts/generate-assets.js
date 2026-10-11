const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 1. Decode PNG (supporting standard Up, Sub, None filters)
function decodePNG(buffer) {
  let offset = 8;
  let width, height;
  const idatChunks = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    } else if (type === 'IDAT') {
      idatChunks.push(buffer.slice(offset + 8, offset + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * 4);
  const stride = 1 + width * 4;

  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    for (let x = 0; x < width * 4; x++) {
      const rawVal = raw[y * stride + 1 + x];
      let prev = 0;
      if (filter === 0) {
        prev = 0;
      } else if (filter === 1) {
        prev = x >= 4 ? pixels[y * width * 4 + x - 4] : 0;
      } else if (filter === 2) {
        prev = y > 0 ? pixels[(y - 1) * width * 4 + x] : 0;
      } else if (filter === 3) {
        const left = x >= 4 ? pixels[y * width * 4 + x - 4] : 0;
        const up = y > 0 ? pixels[(y - 1) * width * 4 + x] : 0;
        prev = Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const a = x >= 4 ? pixels[y * width * 4 + x - 4] : 0;
        const b = y > 0 ? pixels[(y - 1) * width * 4 + x] : 0;
        const c = (y > 0 && x >= 4) ? pixels[(y - 1) * width * 4 + x - 4] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        if (pa <= pb && pa <= pc) prev = a;
        else if (pb <= pc) prev = b;
        else prev = c;
      }
      pixels[y * width * 4 + x] = (rawVal + prev) & 0xFF;
    }
  }
  return { width, height, pixels };
}

// 2. Encode RGBA to PNG
function encodePNG(width, height, rgbaBuffer) {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 4)] = 0; // Filter None
    rgbaBuffer.copy(scanlines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(scanlines, { level: 9 });

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);

    let c = 0xffffffff;
    const bufToCrc = Buffer.concat([typeBuf, data]);
    for (let i = 0; i < bufToCrc.length; i++) {
      c ^= bufToCrc[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    c ^= 0xffffffff;
    crcBuf.writeInt32BE(c);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8-bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 3. Convert RGBA to high-contrast crisp Black & White (Grayscale with preserved alpha & sharp contrast)
function convertToBlackAndWhite(width, height, srcPixels) {
  const bw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < srcPixels.length; i += 4) {
    const r = srcPixels[i];
    const g = srcPixels[i + 1];
    const b = srcPixels[i + 2];
    const a = srcPixels[i + 3];

    if (a === 0) {
      bw[i] = 0;
      bw[i + 1] = 0;
      bw[i + 2] = 0;
      bw[i + 3] = 0;
      continue;
    }

    // Perceived luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Dark parts (eyes, smile, burgundy details): enhance contrast to deep crisp dark gray / black
    // Light parts (character body, glasses frames): keep brilliant crisp white
    let val;
    if (lum < 110) {
      // Burgundy / dark features (lum ~42) -> crisp near-black (#1a1a1a - #242424)
      val = Math.max(15, Math.round(lum * 0.45));
    } else if (lum > 220) {
      // White body / highlights -> pure white (#ffffff)
      val = Math.min(255, Math.round(lum * 1.05));
    } else {
      // Midtones (subtle glow / shading) -> smooth clean silver-gray
      val = Math.round(lum);
    }

    bw[i] = val;
    bw[i + 1] = val;
    bw[i + 2] = val;
    bw[i + 3] = a;
  }
  return bw;
}

// 4. Bilinear downsampling for clean icon generation
function resizeRGBA(srcWidth, srcHeight, srcPixels, targetWidth, targetHeight) {
  const dest = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = srcWidth / targetWidth;
  const yRatio = srcHeight / targetHeight;

  for (let dy = 0; dy < targetHeight; dy++) {
    for (let dx = 0; dx < targetWidth; dx++) {
      const sx = dx * xRatio;
      const sy = dy * yRatio;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);
      const xDiff = sx - x0;
      const yDiff = sy - y0;

      for (let c = 0; c < 4; c++) {
        const p00 = srcPixels[(y0 * srcWidth + x0) * 4 + c];
        const p10 = srcPixels[(y0 * srcWidth + x1) * 4 + c];
        const p01 = srcPixels[(y1 * srcWidth + x0) * 4 + c];
        const p11 = srcPixels[(y1 * srcWidth + x1) * 4 + c];

        const val = (
          p00 * (1 - xDiff) * (1 - yDiff) +
          p10 * xDiff * (1 - yDiff) +
          p01 * (1 - xDiff) * yDiff +
          p11 * xDiff * yDiff
        );
        dest[(dy * targetWidth + dx) * 4 + c] = Math.round(val);
      }
    }
  }
  return dest;
}

// 5. Windows Multi-Size ICO encoder (PNG-in-ICO modern standard)
function createICO(images) {
  // images: array of { width, height, pngBuffer }
  const count = images.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon type
  header.writeUInt16LE(count, 4); // image count

  const entries = [];
  const payloads = [];

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // color palette count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.pngBuffer.length, 8); // image size
    entry.writeUInt32LE(offset, 12); // offset

    entries.push(entry);
    payloads.push(img.pngBuffer);
    offset += img.pngBuffer.length;
  }

  return Buffer.concat([header, ...entries, ...payloads]);
}

// Main generation execution
function main() {
  const rootDir = path.resolve(__dirname, '..');
  const logoPath = path.join(rootDir, 'logo.png');

  if (!fs.existsSync(logoPath)) {
    console.error('logo.png not found at', logoPath);
    process.exit(1);
  }

  console.log('Reading', logoPath);
  const logoRaw = fs.readFileSync(logoPath);
  const { width, height, pixels } = decodePNG(logoRaw);
  console.log(`Decoded source logo: ${width}x${height}`);

  // Create B&W pixels
  const bwPixels = convertToBlackAndWhite(width, height, pixels);
  const bwPng = encodePNG(width, height, bwPixels);

  // Save B&W PNG to root and public
  fs.writeFileSync(path.join(rootDir, 'logo-bw.png'), bwPng);
  console.log('Generated logo-bw.png at project root');

  // Ensure directories exist
  const dirs = [
    path.join(rootDir, 'public'),
    path.join(rootDir, 'build'),
    path.join(rootDir, 'resources'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Copy original and B&W to public
  fs.copyFileSync(logoPath, path.join(rootDir, 'public', 'logo.png'));
  fs.writeFileSync(path.join(rootDir, 'public', 'logo-bw.png'), bwPng);
  fs.copyFileSync(logoPath, path.join(rootDir, 'public', 'icon.png'));
  fs.copyFileSync(logoPath, path.join(rootDir, 'build', 'icon.png'));
  fs.copyFileSync(logoPath, path.join(rootDir, 'resources', 'icon.png'));
  console.log('Saved PNG icons to public/, build/, and resources/');

  // Generate ICO sizes (16, 24, 32, 48, 64, 128, 256)
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const icoImages = sizes.map((size) => {
    const resized = resizeRGBA(width, height, pixels, size, size);
    const pngBuffer = encodePNG(size, size, resized);
    return { width: size, height: size, pngBuffer };
  });

  const icoBuffer = createICO(icoImages);
  fs.writeFileSync(path.join(rootDir, 'public', 'favicon.ico'), icoBuffer);
  fs.writeFileSync(path.join(rootDir, 'build', 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join(rootDir, 'resources', 'icon.ico'), icoBuffer);
  console.log('Generated multi-size Windows icon.ico and favicon.ico with sizes [16, 24, 32, 48, 64, 128, 256]');
  console.log('All branding assets generated successfully!');
}

main();
