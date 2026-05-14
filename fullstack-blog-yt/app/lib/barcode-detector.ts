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
