/*
 * Cookery – Browser Edition
 * Rough port of the original bash-based `cook` for images.
 * Image processing relies on Canvas 2D APIs. Not all features are identical
 * to ImageMagick, but the spirit of random, iterative image "cooking" remains.
 */

// Select DOM elements
const imageInput = document.getElementById('imageInput');
const iterationsInput = document.getElementById('iterations');
const strengthInput = document.getElementById('strength');
const startBtn = document.getElementById('startBtn');
const downloadBtn = document.getElementById('downloadBtn');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let originalImage = new Image();
let imgLoaded = false;

// Utility: load a file into <img>
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      originalImage = new Image();
      originalImage.onload = () => resolve(originalImage);
      originalImage.onerror = reject;
      originalImage.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Draw image to fit canvas while preserving aspect ratio
function drawImageToCanvas(img) {
  const maxDim = 800;
  let { width, height } = img;
  const ratio = width / height;
  if (width > maxDim) {
    width = maxDim;
    height = maxDim / ratio;
  }
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);
}

// Random helpers
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Apply a convolution kernel (3x3)
function convolve(srcCtx, kernel) {
  const { width, height } = srcCtx.canvas;
  const srcData = srcCtx.getImageData(0, 0, width, height);
  const dstData = srcCtx.createImageData(width, height);
  const w = width * 4;

  // kernel is assumed length 9
  const k = kernel;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let r = 0, g = 0, b = 0;
      let idx = (y * width + x) * 4;
      const neighbors = [
        idx - w - 4, idx - w, idx - w + 4,
        idx - 4, idx, idx + 4,
        idx + w - 4, idx + w, idx + w + 4
      ];
      for (let i = 0; i < 9; i++) {
        const nIdx = neighbors[i];
        r += srcData.data[nIdx] * k[i];
        g += srcData.data[nIdx + 1] * k[i];
        b += srcData.data[nIdx + 2] * k[i];
      }
      dstData.data[idx] = Math.min(Math.max(r, 0), 255);
      dstData.data[idx + 1] = Math.min(Math.max(g, 0), 255);
      dstData.data[idx + 2] = Math.min(Math.max(b, 0), 255);
      dstData.data[idx + 3] = srcData.data[idx + 3];
    }
  }
  srcCtx.putImageData(dstData, 0, 0);
}

// Contrast adjustment
function adjustContrast(srcCtx, value) {
  // value in [-255, 255]
  const { width, height } = srcCtx.canvas;
  const imgData = srcCtx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const factor = (259 * (value + 255)) / (255 * (259 - value));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(factor * (data[i] - 128) + 128);
    data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128);
    data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128);
  }
  srcCtx.putImageData(imgData, 0, 0);
}

// Saturation (simple HSL approach per pixel)
function adjustSaturation(srcCtx, percent) {
  const { width, height } = srcCtx.canvas;
  const imgData = srcCtx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const p = percent / 100;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // convert to luminance
    const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
    data[i] = clamp(gray + (r - gray) * p);
    data[i + 1] = clamp(gray + (g - gray) * p);
    data[i + 2] = clamp(gray + (b - gray) * p);
  }
  srcCtx.putImageData(imgData, 0, 0);
}

// Brightness adjustment
function adjustBrightness(srcCtx, value) {
  // value in [-255, 255]
  const { width, height } = srcCtx.canvas;
  const imgData = srcCtx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(data[i] + value);
    data[i + 1] = clamp(data[i + 1] + value);
    data[i + 2] = clamp(data[i + 2] + value);
  }
  srcCtx.putImageData(imgData, 0, 0);
}

// Add random noise
function addNoise(srcCtx, amount) {
  const { width, height } = srcCtx.canvas;
  const imgData = srcCtx.getImageData(0, 0, width, height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = randInt(-amount, amount);
    data[i] = clamp(data[i] + n);
    data[i + 1] = clamp(data[i + 1] + n);
    data[i + 2] = clamp(data[i + 2] + n);
  }
  srcCtx.putImageData(imgData, 0, 0);
}

// Resize down and back up
function resizeShuffle(srcCtx, factor) {
  const temp = document.createElement('canvas');
  const { width, height } = srcCtx.canvas;
  temp.width = factor;
  temp.height = (factor / width) * height;
  const tctx = temp.getContext('2d');
  tctx.drawImage(srcCtx.canvas, 0, 0, temp.width, temp.height);
  srcCtx.clearRect(0, 0, width, height);
  srcCtx.imageSmoothingEnabled = false;
  srcCtx.drawImage(temp, 0, 0, width, height);
}

function clamp(v) {
  return Math.max(0, Math.min(255, v));
}

// Compress by re-encoding the canvas to JPEG with low quality to introduce artifacts
function compressQuality(quality) {
  // quality expected 0–1
  return new Promise(resolve => {
    canvas.toBlob(blob => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.src = url;
    }, 'image/jpeg', quality);
  });
}

async function op_compress(strength) {
  const rand = randInt(1, 100);
  // Mirror the bash logic: factor = 101 - rand * strength
  const factor = Math.max(1, Math.round(101 - rand * strength)); // 1–100
  // Map ImageMagick quality (1–100, 1 = worst) to JPEG quality (0.01–1)
  // Square-mapped for heavier artefacts
  const jpegQ = Math.max(0.01, Math.pow(factor / 100, 2));
  await compressQuality(jpegQ);
}

// Operation wrappers mirroring original names
function op_modulate(strength) {
  const factor = randInt(100, 500);
  const sat = ((factor - 100) * strength) + 100; // approximate scaling
  adjustSaturation(ctx, sat);
  // Add brightness swing for deeper fry
  const brightSwing = randInt(-50, 80) * strength;
  adjustBrightness(ctx, brightSwing);
}

function op_contrast(strength) {
  const val = randInt(10, 200);
  const c = val * strength;
  adjustContrast(ctx, c);
}

function op_resize(strength) {
  let rand = randInt(5, 95);
  const { width } = canvas;
  let px = ((rand / 100) * width);
  px = ((px - width) * strength) + width;
  px = Math.max(1, Math.floor(px));
  resizeShuffle(ctx, px);
}

function op_edge() {
  const kernel = [
    -1, -1, -1,
    -1, 8, -1,
    -1, -1, -1,
  ];
  convolve(ctx, kernel);
}

function op_normalize() {
  // simple mean normalization
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const range = max - min || 1;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(((data[i] - min) / range) * 255);
    data[i + 1] = clamp(((data[i + 1] - min) / range) * 255);
    data[i + 2] = clamp(((data[i + 2] - min) / range) * 255);
  }
  ctx.putImageData(imgData, 0, 0);
}

function op_noise(strength) {
  const amt = Math.round(60 * strength); // up to ±60 RGB
  addNoise(ctx, amt);
}

const operations = [op_modulate, op_compress, op_contrast, op_resize, op_edge, op_noise, op_normalize];

async function cook() {
  if (!imgLoaded) return;
  const iterations = parseInt(iterationsInput.value, 10) || 5;
  const strength = (parseInt(strengthInput.value, 10) || 100) / 100; // convert to 0-1

  // Reset to original first
  drawImageToCanvas(originalImage);

  for (let i = 0; i < iterations; i++) {
    const op = operations[randInt(0, operations.length - 1)];
    await op(strength);
  }

  downloadBtn.disabled = false;
}

function download() {
  const link = document.createElement('a');
  link.download = 'cooked-image.jpg';
  canvas.toBlob(blob => {
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }, 'image/jpeg', 0.92);
}

// Event listeners
imageInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await loadImage(file);
    drawImageToCanvas(originalImage);
    imgLoaded = true;
    startBtn.disabled = false;
    downloadBtn.disabled = true;
  } catch (err) {
    console.error(err);
    alert('Failed to load image.');
  }
});

startBtn.addEventListener('click', cook);
downloadBtn.addEventListener('click', download);

// Drag and drop functionality for canvas
canvas.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  canvas.style.opacity = '0.7';
  canvas.style.border = '3px dashed #007bff';
});

canvas.addEventListener('dragenter', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

canvas.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  // Only reset styles if we're actually leaving the canvas
  if (!canvas.contains(e.relatedTarget)) {
    canvas.style.opacity = '1';
    canvas.style.border = 'none';
  }
});

canvas.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  
  // Reset visual feedback
  canvas.style.opacity = '1';
  canvas.style.border = 'none';
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    
    // Check if it's an image file
    if (file.type.startsWith('image/')) {
      try {
        await loadImage(file);
        drawImageToCanvas(originalImage);
        imgLoaded = true;
        startBtn.disabled = false;
        downloadBtn.disabled = true;
      } catch (err) {
        console.error(err);
        alert('Failed to load image.');
      }
    } else {
      alert('Please drop an image file.');
    }
  }
});

// Canvas click to trigger file input
canvas.addEventListener('click', () => {
  imageInput.click();
}); 