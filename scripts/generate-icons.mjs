#!/usr/bin/env node
/**
 * TeXtra Icon Generator
 *
 * Generates styled SVG, PNG, and ICO icon variants from the master template:
 * resources/icons/textra-logo-template.svg
 *
 * Usage:
 *   node scripts/generate-icons.mjs                      # Generate all standard variants
 *   node scripts/generate-icons.mjs --dark "#293e37" --light "#9bc9bb" --bg "#1c1e20" --name custom
 *   node scripts/generate-icons.mjs --dark "#9bc9bb" --light "#ffffff" --bg none --name light
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const TEMPLATE_PATH = join(ROOT, 'resources', 'icons', 'textra-logo-template.svg');
const OUT_DIR = join(ROOT, 'resources', 'icons');

// Core Brand Colors
export const COLORS = {
  accentGreen: '#293e37', // rgb(41, 62, 55)
  accentTeal: '#9bc9bb', // rgb(155, 201, 187)
  accentDark: '#1c1e20', // rgb(28, 30, 32)
  accentLight: '#e4e5e2', // rgb(228, 229, 226)
  white: '#ffffff',
  black: '#000000',
  lightGrey: '#979c9e', // Contrasting subtle grey for safe-white
  darkGrey: '#404446', // Contrasting subtle grey for safe-dark
};

// Preset Definitions
export const PRESETS = {
  // 1. safe-white: White light-accent, light grey dark-accent, no bg (pops safely on dark backgrounds)
  'safe-white': {
    darkAccent: COLORS.lightGrey,
    lightAccent: COLORS.white,
    bg: 'none',
    description: 'White & light grey on transparent background (safe for dark surfaces)',
  },
  // 2. light: accent-teal dark-accent, white light-accent, no bg (main light variant on dark backgrounds)
  light: {
    darkAccent: COLORS.accentTeal,
    lightAccent: COLORS.white,
    bg: 'none',
    description: 'Teal & white on transparent background (main light variant)',
  },
  // 3. dark: accent-dark dark-accent, accent-green light-accent, no bg (main dark variant on light backgrounds)
  dark: {
    darkAccent: COLORS.accentDark,
    lightAccent: COLORS.accentGreen,
    bg: 'none',
    description: 'Dark charcoal & deep green on transparent background (main dark variant)',
  },
  // 4. safe-dark: black dark-accent, dark grey light-accent, no bg (safe for light backgrounds)
  'safe-dark': {
    darkAccent: COLORS.black,
    lightAccent: COLORS.darkGrey,
    bg: 'none',
    description: 'Black & dark grey on transparent background (safe for light surfaces)',
  },
  // 5. light-squircle: light variant inside an accent-dark squircle
  'light-squircle': {
    darkAccent: COLORS.accentTeal,
    lightAccent: COLORS.white,
    bg: COLORS.accentDark,
    description: 'Light variant inside an accent-dark squircle (app icon / taskbar)',
  },
  // 6. dark-squircle: dark variant inside an accent-light squircle
  'dark-squircle': {
    darkAccent: COLORS.accentDark,
    lightAccent: COLORS.accentGreen,
    bg: COLORS.accentLight,
    description: 'Dark variant inside an accent-light squircle (light theme app icon)',
  },
};

export const STANDARD_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Generates an SVG string from the template by injecting the colors.
 */
export function renderSvg(template, { darkAccent, lightAccent, bg, size = 1024 }) {
  let svg = template;

  // Handle background squircle
  if (!bg || bg.toLowerCase() === 'none' || bg.toLowerCase() === 'transparent') {
    // Remove the rect element
    svg = svg.replace(/<rect\s+id="background-squircle"[\s\S]*?\/>\s*/i, '');
    // Also remove the comment above it if present
    svg = svg.replace(/<!--[\s\S]*?Background squircle[\s\S]*?-->\s*/i, '');
  } else {
    // Update fill color on background-squircle
    svg = svg.replace(/(<rect\s+id="background-squircle"[^>]*?fill=")[^"]*(")/i, `$1${bg}$2`);
  }

  // Update dark-accent fill
  svg = svg.replace(/(<path\s+id="dark-accent"[^>]*?fill=")[^"]*(")/i, `$1${darkAccent}$2`);

  // Update light-accent fill
  svg = svg.replace(/(<path\s+id="light-accent"[^>]*?fill=")[^"]*(")/i, `$1${lightAccent}$2`);

  // Update width and height if not 1024
  if (size !== 1024) {
    svg = svg.replace(/(<svg[^>]*?\bwidth=")[^"]*(")/i, `$1${size}$2`);
    svg = svg.replace(/(<svg[^>]*?\bheight=")[^"]*(")/i, `$1${size}$2`);
  }

  return svg;
}

/**
 * Creates a valid multi-resolution Windows .ico buffer containing PNG frames.
 */
export function createIcoBuffer(pngFrames) {
  const count = pngFrames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(count, 4); // Frame count

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const { size, buffer } of pngFrames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height (0 means 256)
    entry.writeUInt8(0, 2); // Color count (0 = no palette)
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // Size in bytes
    entry.writeUInt32LE(offset, 12); // Offset in file
    dirEntries.push(entry);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngFrames.map((f) => f.buffer)]);
}

/**
 * Launch an offscreen browser using Playwright/Edge to render SVGs to PNG buffers.
 */
async function createRasterizer() {
  const playwright = await import('playwright');
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  const launchOptions = {
    headless: true,
  };
  if (existsSync(edgePath)) {
    launchOptions.executablePath = edgePath;
  }

  const browser = await playwright.chromium.launch(launchOptions);
  const page = await browser.newPage();

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
window.renderSvgToPng = async (svgString, size) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  ctx.drawImage(img, 0, 0, size, size);
  URL.revokeObjectURL(url);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.replace(/^data:image\\/png;base64,/, '');
};
</script>
</body>
</html>`;

  await page.setContent(html);

  return {
    async rasterize(svgString, size) {
      const base64 = await page.evaluate(({ svg, s }) => window.renderSvgToPng(svg, s), {
        svg: svgString,
        s: size,
      });
      return Buffer.from(base64, 'base64');
    },
    async close() {
      await browser.close();
    },
  };
}

/**
 * Parse CLI flags: --dark, --light, --bg, --name, --out
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dark' || arg === '-d') parsed.darkAccent = args[++i];
    else if (arg === '--light' || arg === '-l') parsed.lightAccent = args[++i];
    else if (arg === '--bg' || arg === '-b') parsed.bg = args[++i];
    else if (arg === '--name' || arg === '-n') parsed.name = args[++i];
    else if (arg === '--out' || arg === '-o') parsed.outDir = args[++i];
    else if (arg === '--help' || arg === '-h') parsed.help = true;
  }
  return parsed;
}

async function main() {
  const cli = parseArgs();

  if (cli.help) {
    console.log(`
TeXtra Icon Generator
---------------------
Options:
  --dark, -d       Dark accent fill (hex / rgb)
  --light, -l      Light accent fill (hex / rgb)
  --bg, -b         Background squircle color (or 'none' for transparent)
  --name, -n       Variant name for output files
  --out, -o        Output folder (default: resources/icons)
  --help, -h       Show help

If run without arguments, all standard TeXtra variants will be generated:
  - safe-white
  - light
  - dark
  - safe-dark
  - light-squircle
  - dark-squircle
`);
    return;
  }

  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  mkdirSync(OUT_DIR, { recursive: true });

  const variants = [];
  if (cli.darkAccent && cli.lightAccent) {
    const name = cli.name || 'custom';
    variants.push({
      name,
      config: {
        darkAccent: cli.darkAccent,
        lightAccent: cli.lightAccent,
        bg: cli.bg || 'none',
      },
    });
  } else {
    for (const [name, config] of Object.entries(PRESETS)) {
      variants.push({ name, config });
    }
  }

  console.log(`Starting TeXtra icon generation (${variants.length} variant(s))...`);
  const rasterizer = await createRasterizer();

  try {
    for (const { name, config } of variants) {
      console.log(`\nGenerating variant: [${name}]`);
      const targetDir = join(OUT_DIR, name);
      mkdirSync(targetDir, { recursive: true });

      // 1. Generate SVGs (1024 master and 128 preview)
      const svg1024 = renderSvg(template, { ...config, size: 1024 });
      const svg128 = renderSvg(template, { ...config, size: 128 });

      writeFileSync(join(targetDir, `${name}-1024.svg`), svg1024, 'utf8');
      writeFileSync(join(targetDir, `${name}-128.svg`), svg128, 'utf8');
      writeFileSync(join(targetDir, `${name}.svg`), svg1024, 'utf8');

      // 2. Generate PNGs across all sizes
      const pngFrames = [];
      for (const size of STANDARD_SIZES) {
        const pngBuf = await rasterizer.rasterize(svg1024, size);
        writeFileSync(join(targetDir, `${name}-${size}.png`), pngBuf);
        if (size === 256) {
          writeFileSync(join(targetDir, `${name}.png`), pngBuf);
        }
        if (ICO_SIZES.includes(size)) {
          pngFrames.push({ size, buffer: pngBuf });
        }
      }

      // 3. Generate multi-resolution .ico
      const icoBuf = createIcoBuffer(pngFrames);
      writeFileSync(join(targetDir, `${name}.ico`), icoBuf);
      console.log(
        `  ✓ Generated SVGs, PNGs (16px to 1024px), and ${name}.ico in resources/icons/${name}/`,
      );

      // 4. If this is the light-squircle variant, sync with top-level resources/ for desktop app packaging
      if (name === 'light-squircle') {
        const resourcesDir = join(ROOT, 'resources');
        writeFileSync(join(resourcesDir, 'icon.ico'), icoBuf);
        writeFileSync(join(resourcesDir, 'icon.png'), await rasterizer.rasterize(svg1024, 256));
        writeFileSync(join(resourcesDir, 'icon-512.png'), await rasterizer.rasterize(svg1024, 512));
        writeFileSync(join(resourcesDir, 'icon.svg'), svg128);
        console.log(
          `  ★ Synced default desktop assets in resources/ (icon.ico, icon.png, icon-512.png, icon.svg)`,
        );
      }
    }

    console.log('\nAll icon variants generated successfully!');
  } finally {
    await rasterizer.close();
  }
}

main().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
