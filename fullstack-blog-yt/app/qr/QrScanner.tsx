"use client";

import { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

type ScanResult = {
  text: string;
  scannedAt: Date;
};

const REGION_ID = "qr-reader-region";

function isUrl(text: string) {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function QrScanner() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => {
      const instance = scannerRef.current;
      if (instance) {
        instance
          .stop()
          .catch(() => {})
          .finally(() => {
            instance.clear();
            scannerRef.current = null;
          });
      }
    };
  }, []);

  const start = async () => {
    setError(null);
    setResult(null);
    setCopied(false);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");

      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(REGION_ID);
      }

      await scannerRef.current.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          setResult({ text: decodedText, scannedAt: new Date() });
          stop();
        },
        () => {
          // 1 フレームずつの失敗は無視（スキャン継続）
        },
      );

      setScanning(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`カメラを起動できませんでした: ${message}`);
      setScanning(false);
    }
  };

  const stop = async () => {
    const instance = scannerRef.current;
    if (!instance) {
      setScanning(false);
      return;
    }
    try {
      await instance.stop();
      instance.clear();
    } catch {
      // すでに停止済みの場合は無視
    } finally {
      scannerRef.current = null;
      setScanning(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("クリップボードにコピーできませんでした");
    }
  };

  const resultIsUrl = result ? isUrl(result.text) : false;

  return (
    <div className="flex flex-col gap-4">
      <div
        id={REGION_ID}
        className="w-full aspect-square max-w-md mx-auto rounded-md overflow-hidden bg-black"
      />

      <div className="flex justify-center gap-3">
        {!scanning ? (
          <button
            type="button"
            onClick={start}
            className="px-6 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700"
          >
            スキャン開始
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="px-6 py-2 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700"
          >
            停止
          </button>
        )}
      </div>

      {error && (
        <p className="text-center text-red-600 font-semibold">{error}</p>
      )}

      {result && (
        <div className="bg-slate-100 rounded-md p-4 flex flex-col gap-3">
          <div>
            <p className="text-sm text-slate-500">読み取り結果</p>
            <p className="font-mono break-all text-slate-900">{result.text}</p>
          </div>
          <p className="text-xs text-slate-500">
            {result.scannedAt.toLocaleString("ja-JP")}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              className="px-4 py-1 rounded-md bg-slate-800 text-white text-sm hover:bg-slate-900"
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
            {resultIsUrl && (
              <a
                href={result.text}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-1 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700"
              >
                リンクを開く
              </a>
            )}
            <button
              type="button"
              onClick={start}
              className="px-4 py-1 rounded-md bg-slate-300 text-slate-900 text-sm hover:bg-slate-400"
            >
              もう一度スキャン
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 text-center">
        ※ スマホで使う場合は HTTPS もしくは localhost からアクセスしてください（カメラ API の制約）
      </p>
    </div>
  );
}
