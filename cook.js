/*
 * Cookery – Browser Edition
 * Rough port of the original bash-based `cook` for images.
 * Image processing relies on Canvas 2D APIs. Not all features are identical
 * to ImageMagick, but the spirit of random, iterative image "cooking" remains.
 */

// Select DOM elements
const imageInput = document.getElementById('imageInput');
const selectImageBtn = document.getElementById('selectImageBtn');

const startBtn = document.getElementById('startBtn');
startBtn.style.display = 'none';
const downloadBtn = document.getElementById('downloadBtn');
downloadBtn.style.display = 'none'; // Hide initially
const recipeContent = document.getElementById('recipeContent');
const recipeText = document.getElementById('recipeText');
const generateNewRecipeBtn = document.getElementById('generateNewRecipeBtn');
const webcamFeed = document.getElementById('webcamFeed');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const takePhotoBtn = document.getElementById('takePhotoBtn');

let originalImage = new Image();
let imgLoaded = false;
let webcamStream = null;

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

// Start webcam feed
async function startWebcam() {
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
    webcamFeed.srcObject = webcamStream;
    webcamFeed.play();
    takePhotoBtn.disabled = false; // Enable button on success
  } catch (err) {
    console.error('Error accessing webcam:', err);
    alert('Could not access webcam. Please ensure you have a webcam and have granted permission.');
    takePhotoBtn.disabled = true; // Disable button on failure
  }
}

// Take photo from webcam feed
function takePhoto() {
  const { videoWidth, videoHeight } = webcamFeed;
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  ctx.drawImage(webcamFeed, 0, 0, videoWidth, videoHeight);
  originalImage.src = canvas.toDataURL(); // Store the captured image as original
  imgLoaded = true;
  startBtn.style.display = 'inline-block';
  startBtn.disabled = false;
  downloadBtn.disabled = true;
  downloadBtn.style.display = 'none';
  stopWebcam(); // Stop webcam after taking photo
  webcamFeed.style.display = 'none'; // Hide webcam feed
  canvas.style.display = 'block'; // Show canvas
}

// Stop webcam feed
function stopWebcam() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamFeed.srcObject = null;
  }
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

async function op_compress(explicitValue = null) {
  let factor;
  if (explicitValue !== null) {
    factor = parseInt(explicitValue, 10);
  } else {
    const rand = randInt(1, 100);
    factor = Math.max(1, Math.round(101 - rand * 1)); // 1–100
  }
  const jpegQ = Math.max(0.01, Math.pow(factor / 100, 2));
  await compressQuality(jpegQ);
  return `-quality ${factor}`;
}

// Operation wrappers mirroring original names
function op_modulate(explicitValue = null) {
  let factor;
  if (explicitValue !== null) {
    factor = parseInt(explicitValue, 10);
  } else {
    factor = randInt(100, 500);
  }
  const sat = ((factor - 100) * 1) + 100; // approximate scaling
  adjustSaturation(ctx, sat);
  // Add brightness swing for deeper fry
  const brightSwing = randInt(-50, 80) * 1;
  adjustBrightness(ctx, brightSwing);
  return `-modulate ${factor}`;
}

function op_contrast(explicitValue = null) {
  let val;
  if (explicitValue !== null) {
    val = parseInt(explicitValue, 10);
  } else {
    val = randInt(10, 200);
  }
  const c = val * 1;
  adjustContrast(ctx, c);
  return `-contrast`;
}

function op_resize(explicitValue = null) {
  let rand;
  if (explicitValue !== null) {
    rand = parseInt(explicitValue, 10);
  } else {
    rand = randInt(5, 95);
  }
  const { width } = canvas;
  let px = ((rand / 100) * width);
  px = ((px - width) * 1) + width;
  px = Math.max(1, Math.floor(px));
  resizeShuffle(ctx, px);
  return `-resize ${rand}%`;
}

function op_edge(explicitValue = null) {
  const kernel = [
    -1, -1, -1,
    -1, 8, -1,
    -1, -1, -1,
  ];
  convolve(ctx, kernel);
  return `-edge 1`;
}

function op_normalize(explicitValue = null) {
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
  return `-normalize`;
}

function op_noise(explicitValue = null) {
  let amt;
  if (explicitValue !== null) {
    amt = parseInt(explicitValue, 10);
  } else {
    amt = Math.round(60 * 1);
  }
  addNoise(ctx, amt);
  return `-noise ${amt}`;
}

const operations = [op_modulate, op_compress, op_contrast, op_resize, op_edge, op_noise, op_normalize];

const operationMap = {
  '-modulate': op_modulate,
  '-quality': op_compress,
  '-contrast': op_contrast,
  '-resize': op_resize,
  '-edge': op_edge,
  '-noise': op_noise,
  '-normalize': op_normalize,
};

async function cook() {
  if (!imgLoaded) return;

  // Reset to original first
  drawImageToCanvas(originalImage);

  const recipeLines = recipeText.value.split('\n').filter(line => line.trim() !== '');

  for (const line of recipeLines) {
    const parts = line.split(' ');
    const command = parts[0];
    const value = parts.length > 1 ? parts[1] : null;

    const opFunction = operationMap[command];
    if (opFunction) {
      await opFunction(value);
    } else {
      console.warn(`Unknown recipe command: ${command}`);
    }
  }
  downloadBtn.disabled = false;
  downloadBtn.style.display = 'inline-block';
}

async function generateRandomRecipeString() {
  const iterations = 5; // Default iterations
  let recipe = [];
  for (let i = 0; i < iterations; i++) {
    const op = operations[randInt(0, operations.length - 1)];
    // Call op function in a "dry run" to get the recipe string
    // Pass null for explicitValue as we want random generation here
    recipe.push(await op(null));
  }
  return recipe.join('\n');
}

// Initial recipe generation on load
window.addEventListener('load', async () => {
  recipeText.value = await generateRandomRecipeString();
  canvas.style.display = 'block'; // Canvas visible by default
  webcamFeed.style.display = 'none'; // Webcam hidden by default
});

function download() {
  if (!imgLoaded) {
    alert('Please load an image first.');
    return;
  }
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
    startBtn.style.display = 'inline-block';
    startBtn.disabled = false;
    downloadBtn.disabled = true;
    downloadBtn.style.display = 'none'; // Hide download button on new image load
    stopWebcam(); // Stop webcam when image is loaded via file input
    webcamFeed.style.display = 'none'; // Hide webcam feed
    canvas.style.display = 'block'; // Show canvas
    takePhotoBtn.textContent = 'Use webcam'; // Reset button text
    takePhotoBtn.disabled = false; // Enable button
  } catch (err) {
    console.error(err);
    alert('Failed to load image.');
  }
});

startBtn.addEventListener('click', cook);
downloadBtn.addEventListener('click', download);
generateNewRecipeBtn.addEventListener('click', async () => {
  recipeText.value = await generateRandomRecipeString();
});
takePhotoBtn.addEventListener('click', async () => {
  if (takePhotoBtn.textContent === 'Use webcam') {
    // Switch to webcam mode
    try {
      await startWebcam();
      canvas.style.display = 'none';
      webcamFeed.style.display = 'block';
      takePhotoBtn.textContent = 'Take Photo';
    } catch (err) {
      console.error('Error accessing webcam:', err);
      alert('Could not access webcam. Please ensure you have a webcam and have granted permission.');
    }
  } else if (takePhotoBtn.textContent === 'Take Photo') {
    // Take photo mode
    takePhoto();
    takePhotoBtn.textContent = 'Use webcam';
  }
});



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
        startBtn.style.display = 'inline-block';
        startBtn.disabled = false;
        downloadBtn.disabled = true;
        downloadBtn.style.display = 'none'; // Hide download button on new image load
        stopWebcam(); // Stop webcam when image is loaded via drag and drop
        webcamFeed.style.display = 'none'; // Hide webcam feed
        canvas.style.display = 'block'; // Show canvas
        takePhotoBtn.textContent = 'Use webcam'; // Reset button text
        takePhotoBtn.disabled = false; // Enable button
      } catch (err) {
        console.error(err);
        alert('Failed to load image.');
      }
    } else {
      alert('Please drop an image file.');
    }
  }
});

selectImageBtn.addEventListener('click', () => {
  imageInput.click();
});

 