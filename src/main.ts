import './styles.css';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { Document, Packer, Paragraph } from 'docx';
import * as mammoth from 'mammoth';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found');

app.innerHTML = `
  <div class="container">
    <header class="hero">
      <div>
        <span class="badge">In-memory processing · No uploads</span>
        <h1>FileReshape</h1>
        <p>Pick an operation from the tabs to reduce file sizes or convert formats. Everything runs locally in your browser memory.</p>
      </div>
      <nav class="tabs" role="tablist" aria-label="Operations">
        <button class="tab active" role="tab" aria-selected="true" data-tab="tab-pdf-reduce">PDF Reduce</button>
        <button class="tab" role="tab" aria-selected="false" data-tab="tab-word-reduce">Word Reduce</button>
        <button class="tab" role="tab" aria-selected="false" data-tab="tab-photo-reduce">Photo Reduce</button>
        <button class="tab" role="tab" aria-selected="false" data-tab="tab-convert">Convert</button>
      </nav>
    </header>

    <section class="panel">
      <div class="card tab-panel active" id="tab-pdf-reduce" role="tabpanel">
        <h2>PDF Size Reducer</h2>
        <p>Select a quality level. The app targets approximate size ratios based on the original file.</p>
        <div class="field">
          <label>PDF file</label>
          <input type="file" accept="application/pdf" id="pdfReduceInput" />
        </div>
        <div class="field">
          <label>Quality preset</label>
          <select id="pdfQualityPreset">
            <option value="high">Best quality (≈ 80% size)</option>
            <option value="medium" selected>Medium (≈ 50% size)</option>
            <option value="low">Low (≈ 25% size)</option>
          </select>
        </div>
        <button id="pdfReduceBtn">Reduce PDF</button>
        <div class="status" id="pdfReduceStatus"></div>
        <div class="output" id="pdfReduceOutput"></div>
      </div>

      <div class="card tab-panel" id="tab-word-reduce" role="tabpanel">
        <h2>Word Size Reducer</h2>
        <p>Best-effort: extracts text and re-creates a lighter DOCX with the chosen quality level.</p>
        <div class="field">
          <label>Word file (.docx)</label>
          <input type="file" accept=".docx" id="wordReduceInput" />
        </div>
        <div class="field">
          <label>Quality preset</label>
          <select id="wordQualityPreset">
            <option value="high">Best quality (≈ 80% size)</option>
            <option value="medium" selected>Medium (≈ 50% size)</option>
            <option value="low">Low (≈ 25% size)</option>
          </select>
        </div>
        <button id="wordReduceBtn">Reduce Word</button>
        <div class="status" id="wordReduceStatus"></div>
        <div class="output" id="wordReduceOutput"></div>
      </div>

      <div class="card tab-panel" id="tab-photo-reduce" role="tabpanel">
        <h2>Photo Size Reducer</h2>
        <p>Compress JPG/PNG with the selected quality level. Optional resize.</p>
        <div class="field">
          <label>Image file</label>
          <input type="file" accept="image/jpeg,image/png" id="photoReduceInput" />
        </div>
        <div class="field">
          <label>Output format</label>
          <select id="photoFormat">
            <option value="original">Original</option>
            <option value="image/jpeg">JPG</option>
            <option value="image/png">PNG</option>
          </select>
        </div>
        <div class="field">
          <label>Quality preset</label>
          <select id="photoQualityPreset">
            <option value="high">Best quality (≈ 80% size)</option>
            <option value="medium" selected>Medium (≈ 50% size)</option>
            <option value="low">Low (≈ 25% size)</option>
          </select>
        </div>
        <div class="field">
          <label>Width (px, optional)</label>
          <input type="number" id="photoWidth" min="0" step="10" value="0" />
        </div>
        <div class="field">
          <label>Height (px, optional)</label>
          <input type="number" id="photoHeight" min="0" step="10" value="0" />
        </div>
        <button id="photoReduceBtn">Reduce Photo</button>
        <div class="status" id="photoReduceStatus"></div>
        <div class="output" id="photoReduceOutput"></div>
      </div>

      <div class="card tab-panel" id="tab-convert" role="tabpanel">
        <h2>PDF ↔ Word Converter</h2>
        <p>Best-effort conversion focused on text. Layout and images may change.</p>
        <div class="field">
          <label>Convert PDF → Word</label>
          <input type="file" accept="application/pdf" id="pdfToWordInput" />
          <button id="pdfToWordBtn">Convert PDF to Word</button>
        </div>
        <div class="field">
          <label>Convert Word → PDF</label>
          <input type="file" accept=".docx" id="wordToPdfInput" />
          <button id="wordToPdfBtn">Convert Word to PDF</button>
        </div>
        <div class="status" id="convertStatus"></div>
        <div class="output" id="convertOutput"></div>
      </div>
    </section>
  </div>
`;


const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 2 : 1)} ${units[unit]}`;
};

const presetQuality = (preset: string | undefined, fallback: number) => {
  switch (preset) {
    case 'high':
      return 0.97;
    case 'low':
      return 0.92;
    case 'medium':
    default:
      return fallback;
  }
};

const presetTargetRatio = (preset: string | undefined) => {
  switch (preset) {
    case 'high':
      return 0.8;
    case 'low':
      return 0.25;
    case 'medium':
    default:
      return 0.5;
  }
};

const buildWordParagraphs = (text: string, preset: string | undefined) => {
  if (!text) return [new Paragraph('')];
  if (preset === 'low') {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return [new Paragraph(collapsed)];
  }
  if (preset === 'high') {
    const lines = text.split(/\n/);
    return lines.map((line) => new Paragraph(line));
  }
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines.map((line) => new Paragraph(line)) : [new Paragraph('')];
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const findQualityForTarget = async (
  encode: (quality: number) => Promise<Uint8Array>,
  targetBytes: number,
  minQ: number,
  maxQ: number
) => {
  let low = minQ;
  let high = maxQ;
  let best: Uint8Array | null = null;

  for (let i = 0; i < 6; i += 1) {
    const mid = clamp((low + high) / 2, minQ, maxQ);
    const bytes = await encode(mid);
    if (bytes.byteLength <= targetBytes) {
      best = bytes;
      high = mid;
    } else {
      low = mid;
    }
  }

  return best ?? (await encode(minQ));
};

const findClosestQualityForTarget = async (
  encode: (quality: number) => Promise<Uint8Array>,
  targetBytes: number,
  minQ: number,
  maxQ: number,
  floorRatio: number
) => {
  const floorBytes = Math.floor(targetBytes * floorRatio);
  const candidates: Array<{ quality: number; bytes: Uint8Array }> = [];

  for (let i = 0; i < 6; i += 1) {
    const q = clamp(minQ + ((maxQ - minQ) * i) / 5, minQ, maxQ);
    candidates.push({ quality: q, bytes: await encode(q) });
  }

  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const size = candidate.bytes.byteLength;
    const score = Math.abs(size - targetBytes);
    const meetsFloor = size >= floorBytes;
    const bestMeetsFloor = best.bytes.byteLength >= floorBytes;

    if (meetsFloor && !bestMeetsFloor) {
      best = candidate;
      bestScore = score;
      continue;
    }
    if (meetsFloor === bestMeetsFloor && score < bestScore) {
      best = candidate;
      bestScore = score;
      continue;
    }
  }

  return best.bytes;
};

const readFileAsArrayBuffer = (file: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const setStatus = (el: HTMLElement | null, message: string) => {
  if (el) el.textContent = message;
};

const setupTabs = () => {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
  const panels = Array.from(document.querySelectorAll<HTMLElement>('.tab-panel'));
  if (!tabs.length || !panels.length) return;

  const activate = (tabId: string) => {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === tabId;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      panel.classList.toggle('active', panel.id === tabId);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      if (tabId) activate(tabId);
    });
  });
};

const setOutput = (el: HTMLElement | null, message: string, blob?: Blob, filename?: string) => {
  if (!el) return;
  el.innerHTML = '';
  const info = document.createElement('div');
  info.textContent = message;
  el.appendChild(info);
  if (blob && filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.textContent = `Download ${filename}`;
    link.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(link.href), 3000));
    el.appendChild(link);
  }
};

setupTabs();

const pdfReduceBtn = document.querySelector<HTMLButtonElement>('#pdfReduceBtn');
const pdfReduceInput = document.querySelector<HTMLInputElement>('#pdfReduceInput');
const pdfQualityPreset = document.querySelector<HTMLSelectElement>('#pdfQualityPreset');
const pdfReduceStatus = document.querySelector<HTMLDivElement>('#pdfReduceStatus');
const pdfReduceOutput = document.querySelector<HTMLDivElement>('#pdfReduceOutput');

pdfReduceBtn?.addEventListener('click', async () => {
  const file = pdfReduceInput?.files?.[0];
  if (!file) return;
  pdfReduceBtn.disabled = true;
  setStatus(pdfReduceStatus, 'Processing...');
  setOutput(pdfReduceOutput, '');

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const originalBuffer = buffer.slice(0);
    let outputBytes: Uint8Array;
    {
      const preset = pdfQualityPreset?.value ?? 'medium';
      const targetBytes = Math.max(1, Math.floor(file.size * presetTargetRatio(preset)));
      const loadingTask = pdfjsLib.getDocument({ data: buffer });
      const pdf = await loadingTask.promise;
      const scales = [1, 0.9];
      let result: Uint8Array | null = null;

      for (const scale of scales) {
        const canvases: HTMLCanvasElement[] = [];
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas not supported');
          await page.render({ canvasContext: ctx, viewport }).promise;
          canvases.push(canvas);
        }

        const encode = async (quality: number) => {
          const outPdf = await PDFDocument.create();
          for (const canvas of canvases) {
            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
                'image/jpeg',
                quality
              );
            });
            const imgBytes = await blob.arrayBuffer();
            const jpg = await outPdf.embedJpg(imgBytes);
            const outPage = outPdf.addPage([jpg.width, jpg.height]);
            outPage.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
          }
          return outPdf.save();
        };

        const minQ = 0.85;
        const maxQ = clamp(presetQuality(preset, 0.95), minQ, 0.99);
        const bytes = await findClosestQualityForTarget(encode, targetBytes, minQ, maxQ, 0.95);
        result = bytes;
        if (Math.abs(bytes.byteLength - targetBytes) / targetBytes < 0.05) break;
      }

      outputBytes = result ?? new Uint8Array(originalBuffer);
    }

    const blob = new Blob([outputBytes], { type: 'application/pdf' });
    setOutput(
      pdfReduceOutput,
      `Original: ${formatBytes(file.size)} · New: ${formatBytes(blob.size)}`,
      blob,
      file.name.replace(/\.pdf$/i, '') + '-reduced.pdf'
    );
    setStatus(pdfReduceStatus, 'Done.');
  } catch (err) {
    setStatus(pdfReduceStatus, `Error: ${(err as Error).message}`);
  } finally {
    pdfReduceBtn.disabled = false;
  }
});

const wordReduceBtn = document.querySelector<HTMLButtonElement>('#wordReduceBtn');
const wordReduceInput = document.querySelector<HTMLInputElement>('#wordReduceInput');
const wordQualityPreset = document.querySelector<HTMLSelectElement>('#wordQualityPreset');
const wordReduceStatus = document.querySelector<HTMLDivElement>('#wordReduceStatus');
const wordReduceOutput = document.querySelector<HTMLDivElement>('#wordReduceOutput');

wordReduceBtn?.addEventListener('click', async () => {
  const file = wordReduceInput?.files?.[0];
  if (!file) return;
  wordReduceBtn.disabled = true;
  setStatus(wordReduceStatus, 'Processing...');
  setOutput(wordReduceOutput, '');

  try {
    const buffer = await readFileAsArrayBuffer(file);
    let outputBlob: Blob;

    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const paragraphs = buildWordParagraphs(result.value, wordQualityPreset?.value);
    const doc = new Document({
      sections: [{ children: paragraphs }]
    });
    outputBlob = await Packer.toBlob(doc);

    setOutput(
      wordReduceOutput,
      `Original: ${formatBytes(file.size)} · New: ${formatBytes(outputBlob.size)}`,
      outputBlob,
      file.name.replace(/\.docx$/i, '') + '-reduced.docx'
    );
    setStatus(wordReduceStatus, 'Done.');
  } catch (err) {
    setStatus(wordReduceStatus, `Error: ${(err as Error).message}`);
  } finally {
    wordReduceBtn.disabled = false;
  }
});

const photoReduceBtn = document.querySelector<HTMLButtonElement>('#photoReduceBtn');
const photoReduceInput = document.querySelector<HTMLInputElement>('#photoReduceInput');
const photoFormat = document.querySelector<HTMLSelectElement>('#photoFormat');
const photoWidth = document.querySelector<HTMLInputElement>('#photoWidth');
const photoHeight = document.querySelector<HTMLInputElement>('#photoHeight');
const photoQualityPreset = document.querySelector<HTMLSelectElement>('#photoQualityPreset');
const photoReduceStatus = document.querySelector<HTMLDivElement>('#photoReduceStatus');
const photoReduceOutput = document.querySelector<HTMLDivElement>('#photoReduceOutput');

photoReduceBtn?.addEventListener('click', async () => {
  const file = photoReduceInput?.files?.[0];
  if (!file || !photoFormat) return;
  photoReduceBtn.disabled = true;
  setStatus(photoReduceStatus, 'Processing...');
  setOutput(photoReduceOutput, '');

  try {
    const bitmap = await createImageBitmap(file);
    const requestedWidth = Math.max(0, Number(photoWidth?.value ?? 0));
    const requestedHeight = Math.max(0, Number(photoHeight?.value ?? 0));
    let width = bitmap.width;
    let height = bitmap.height;

    if (requestedWidth > 0 && requestedHeight > 0) {
      width = Math.round(requestedWidth);
      height = Math.round(requestedHeight);
    } else if (requestedWidth > 0) {
      const scale = requestedWidth / bitmap.width;
      width = Math.round(requestedWidth);
      height = Math.max(1, Math.round(bitmap.height * scale));
    } else if (requestedHeight > 0) {
      const scale = requestedHeight / bitmap.height;
      width = Math.max(1, Math.round(bitmap.width * scale));
      height = Math.round(requestedHeight);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const targetType = photoFormat.value === 'original' ? file.type : photoFormat.value;
    const preset = photoQualityPreset?.value ?? 'medium';
    const targetBytes = Math.max(1, Math.floor(file.size * presetTargetRatio(preset)));

    const encode = async (quality: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
          targetType,
          targetType === 'image/jpeg' ? quality : undefined
        );
      });

    let blob: Blob;
    if (targetType === 'image/jpeg') {
      const minQ = 0.65;
      const maxQ = clamp(presetQuality(preset, 0.88), minQ, 0.98);
      const bytes = await findQualityForTarget(
        async (q) => new Uint8Array(await (await encode(q)).arrayBuffer()),
        targetBytes,
        minQ,
        maxQ
      );
      blob = new Blob([bytes], { type: targetType });
    } else {
      blob = await encode(0.95);
    }

    const extension = targetType === 'image/png' ? '.png' : '.jpg';
    setOutput(
      photoReduceOutput,
      `Original: ${formatBytes(file.size)} · New: ${formatBytes(blob.size)}`,
      blob,
      file.name.replace(/\.(png|jpe?g)$/i, '') + '-compressed' + extension
    );
    setStatus(photoReduceStatus, 'Done.');
  } catch (err) {
    setStatus(photoReduceStatus, `Error: ${(err as Error).message}`);
  } finally {
    photoReduceBtn.disabled = false;
  }
});

const pdfToWordBtn = document.querySelector<HTMLButtonElement>('#pdfToWordBtn');
const pdfToWordInput = document.querySelector<HTMLInputElement>('#pdfToWordInput');
const wordToPdfBtn = document.querySelector<HTMLButtonElement>('#wordToPdfBtn');
const wordToPdfInput = document.querySelector<HTMLInputElement>('#wordToPdfInput');
const convertStatus = document.querySelector<HTMLDivElement>('#convertStatus');
const convertOutput = document.querySelector<HTMLDivElement>('#convertOutput');

pdfToWordBtn?.addEventListener('click', async () => {
  const file = pdfToWordInput?.files?.[0];
  if (!file) return;
  pdfToWordBtn.disabled = true;
  setStatus(convertStatus, 'Processing PDF → Word...');
  setOutput(convertOutput, '');

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    const pdf = await loadingTask.promise;

    const paragraphs: Paragraph[] = [];
    let totalText = '';
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => {
          const chunk = item.str ?? '';
          return item.hasEOL ? `${chunk}\n` : chunk;
        })
        .join(' ');
      totalText += text + '\n';
      const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      lines.forEach((line) => paragraphs.push(new Paragraph(line)));
      if (i < pdf.numPages) paragraphs.push(new Paragraph(''));
    }

    if (!totalText.trim()) {
      setStatus(convertStatus, 'This PDF looks scanned (image-only), so it can’t be converted without OCR.');
      return;
    }

    const doc = new Document({ sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph('')]}] });
    const blob = await Packer.toBlob(doc);
    setOutput(
      convertOutput,
      `Converted ${pdf.numPages} page(s).`,
      blob,
      file.name.replace(/\.pdf$/i, '') + '.docx'
    );
    setStatus(convertStatus, 'Done.');
  } catch (err) {
    setStatus(convertStatus, `Error: ${(err as Error).message}`);
  } finally {
    pdfToWordBtn.disabled = false;
  }
});

wordToPdfBtn?.addEventListener('click', async () => {
  const file = wordToPdfInput?.files?.[0];
  if (!file) return;
  wordToPdfBtn.disabled = true;
  setStatus(convertStatus, 'Processing Word → PDF...');
  setOutput(convertOutput, '');

  try {
    const buffer = await readFileAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const text = result.value || '';

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 12;
    const lineHeight = 16;
    const margin = 50;
    const pageSize: [number, number] = [595.28, 841.89];

    let page = pdfDoc.addPage(pageSize);
    let y = page.getHeight() - margin;

    const pushLine = (line: string) => {
      if (y - lineHeight < margin) {
        page = pdfDoc.addPage(pageSize);
        y = page.getHeight() - margin;
      }
      page.drawText(line, { x: margin, y, size: fontSize, font });
      y -= lineHeight;
    };

    const paragraphs = text.split(/\n+/);
    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let line = '';
      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, fontSize);
        if (width > page.getWidth() - margin * 2 && line) {
          pushLine(line);
          line = word;
        } else {
          line = testLine;
        }
      }
      if (line) pushLine(line);
      y -= lineHeight * 0.5;
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    setOutput(
      convertOutput,
      'Converted to PDF.',
      blob,
      file.name.replace(/\.docx$/i, '') + '.pdf'
    );
    setStatus(convertStatus, 'Done.');
  } catch (err) {
    setStatus(convertStatus, `Error: ${(err as Error).message}`);
  } finally {
    wordToPdfBtn.disabled = false;
  }
});
