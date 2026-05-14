export type DetectedBarcode = {
  rawValue: string;
  format: string;
  cornerPoints?: { x: number; y: number }[];
  boundingBox: DOMRectReadOnly;
};

export type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};

export type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

let polyfillPromise: Promise<void> | null = null;

/**
 * window.BarcodeDetector を確実に呼べる状態にする。
 * Chromium 系（Android Chrome / Edge / PC Chrome）はネイティブ実装をそのまま使う。
 * iOS Safari など未対応ブラウザの場合のみ、@sec-ant/barcode-detector
 * の WASM ポリフィルを動的 import して window に登録する。
 */
export async function ensureBarcodeDetector(): Promise<void> {
  if (typeof window === "undefined") return;
  if (typeof window.BarcodeDetector === "function") return;
  if (!polyfillPromise) {
    polyfillPromise = import("@sec-ant/barcode-detector/pure")
      .then((mod) => {
        (window as Window).BarcodeDetector =
          mod.BarcodeDetector as unknown as BarcodeDetectorCtor;
      })
      .catch((err) => {
        polyfillPromise = null;
        throw err;
      });
  }
  await polyfillPromise;
}
