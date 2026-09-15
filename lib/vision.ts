import type { VisionGroup, VisionPrediction } from "./types";

let modelPromise: Promise<any> | null = null;

export async function detectKitchenObjects(image: HTMLImageElement): Promise<VisionPrediction[]> {
  const tf = await import("@tensorflow/tfjs");
  await tf.ready();

  const coco = await import("@tensorflow-models/coco-ssd");
  if (!modelPromise) modelPromise = coco.load({ base: "lite_mobilenet_v2" });

  const model = await modelPromise;
  const rows = await model.detect(image, 30, 0.25);

  return rows.map((r: any) => ({
    label: String(r.class ?? "").toLowerCase(),
    score: Number(r.score ?? 0),
    bbox: [
      Number(r.bbox?.[0] ?? 0),
      Number(r.bbox?.[1] ?? 0),
      Number(r.bbox?.[2] ?? 0),
      Number(r.bbox?.[3] ?? 0)
    ]
  }));
}

export function groupPredictions(rows: VisionPrediction[]): VisionGroup[] {
  const grouped = new Map<string, VisionPrediction[]>();

  for (const row of rows) {
    const current = grouped.get(row.label) ?? [];
    current.push(row);
    grouped.set(row.label, current);
  }

  return [...grouped.entries()]
    .map(([label, items]) => ({
      label,
      count: items.length,
      confidence: items.reduce((s, x) => s + x.score, 0) / items.length,
      bboxes: items.map(x => x.bbox)
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export function estimateVisibleFill(rows: VisionPrediction[], width: number, height: number) {
  const total = Math.max(1, width * height);
  const occupied = rows.reduce(
    (s, r) => s + Math.max(0, r.bbox[2]) * Math.max(0, r.bbox[3]),
    0
  );
  return Math.max(10, Math.min(95, Math.round((occupied / total) * 135)));
}

export async function detectBarcodeValues(image: HTMLImageElement): Promise<string[]> {
  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  const reader = new BrowserMultiFormatReader();

  try {
    const result = await reader.decodeFromImageElement(image);
    const text = result?.getText?.();
    return text ? [String(text)] : [];
  } catch {
    return [];
  }
}

export async function readKitchenText(
  image: HTMLImageElement,
  onProgress?: (progress: number) => void
) {
  const Tesseract = await import("tesseract.js");
  const result = await Tesseract.recognize(image, "eng+spa", {
    logger: (message: any) => {
      if (message?.status === "recognizing text" && typeof message.progress === "number") {
        onProgress?.(message.progress);
      }
    }
  });

  return {
    text: String(result.data?.text ?? "").trim(),
    confidence: Number(result.data?.confidence ?? 0) / 100
  };
}

export function normalizeVisionText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function imageElementToJpegDataUrl(
  image: HTMLImageElement,
  maxSide = 1280,
  quality = 0.76
) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export const visionLabelEs: Record<string, string> = {
  banana: "plátano",
  apple: "manzana",
  orange: "naranja",
  broccoli: "brócoli",
  carrot: "zanahoria",
  bottle: "botella",
  cup: "taza",
  bowl: "bowl",
  sandwich: "sándwich",
  pizza: "pizza",
  cake: "torta",
  donut: "dona",
  "wine glass": "copa",
  diningtable: "mesa"
};
