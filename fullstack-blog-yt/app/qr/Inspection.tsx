"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import type { BarcodeDetectorInstance } from "./barcode-detector";

type Marker = { id: string; x: number; y: number };

const TOTAL_BOXES = 10;
const ITEM_NAME = "明太子";

export default function Inspection() {
  const [screen, setScreen] = useState<"camera" | "detail">("camera");

  return screen === "camera" ? (
    <CameraScreen onNext={() => setScreen("detail")} />
  ) : (
    <DetailScreen
      onBack={() => setScreen("camera")}
      onSubmit={() => {
        alert("出庫しました（デモ）");
        setScreen("camera");
      }}
    />
  );
}

function CameraScreen({ onNext }: { onNext: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const rafRef = useRef<number | null>(null);

  const [markers, setMarkers] = useState<Marker[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addMarker = useCallback((m: Marker) => {
    setMarkers((prev) => (prev.length >= TOTAL_BOXES ? prev : [...prev, m]));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play();
        }

        if (typeof window.BarcodeDetector === "function") {
          detectorRef.current = new window.BarcodeDetector({
            formats: ["qr_code"],
          });
          const loop = async () => {
            if (cancelled) return;
            const video = videoRef.current;
            const detector = detectorRef.current;
            if (video && detector && video.readyState >= 2) {
              try {
                const codes = await detector.detect(video);
                for (const code of codes) {
                  const key = code.rawValue;
                  if (!key || seenRef.current.has(key)) continue;
                  if (seenRef.current.size >= TOTAL_BOXES) continue;
                  seenRef.current.add(key);
                  const b = code.boundingBox;
                  const x = ((b.x + b.width / 2) / video.videoWidth) * 100;
                  const y = ((b.y + b.height / 2) / video.videoHeight) * 100;
                  addMarker({ id: key, x, y });
                }
              } catch {
                // ignore frame failures
              }
            }
            if (!cancelled) {
              rafRef.current = requestAnimationFrame(() => {
                void loop();
              });
            }
          };
          void loop();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [addMarker]);

  const handleTap = (e: PointerEvent<HTMLDivElement>) => {
    if (markers.length >= TOTAL_BOXES) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    addMarker({ id: `tap-${Date.now()}-${markers.length}`, x, y });
  };

  return (
    <main className="flex h-[100dvh] flex-col bg-black text-white">
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="戻る"
            className="grid h-8 w-8 place-items-center rounded-full text-xl"
          >
            ←
          </button>
          <div>
            <div className="text-[16px] font-semibold leading-tight">出庫</div>
            <div className="text-[12px] leading-tight text-slate-300">
              {ITEM_NAME}
            </div>
          </div>
        </div>
        <div className="rounded-full bg-white/10 px-3 py-1 text-[14px] font-semibold tabular-nums">
          {markers.length} / {TOTAL_BOXES}
        </div>
      </header>

      <div
        onPointerUp={handleTap}
        className="relative flex-1 overflow-hidden bg-zinc-900"
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
        />

        {markers.map((m) => (
          <span
            key={m.id}
            className="pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-white/25 shadow-[0_0_0_4px_rgba(0,0,0,0.25)]"
            style={{ left: `${m.x}%`, top: `${m.y}%` }}
          />
        ))}

        {error && (
          <div className="absolute inset-x-4 top-4 rounded-md bg-rose-600/90 px-3 py-2 text-[12px]">
            カメラを起動できません: {error}
            <br />
            画面タップで擬似スキャン可
          </div>
        )}

        {!error && markers.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[11px] text-white/60">
            画面タップで擬似スキャン
          </div>
        )}
      </div>

      <footer className="bg-white p-3">
        <button
          type="button"
          onClick={onNext}
          disabled={markers.length === 0}
          className="w-full rounded-lg bg-blue-600 py-3 text-[15px] font-bold text-white transition disabled:bg-slate-300"
        >
          次へ
        </button>
      </footer>
    </main>
  );
}

function DetailScreen({
  onBack,
  onSubmit,
}: {
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <main className="flex h-[100dvh] flex-col bg-white text-slate-900">
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="戻る"
          className="grid h-8 w-8 place-items-center rounded-full text-xl text-slate-700"
        >
          ←
        </button>
        <div className="text-[16px] font-semibold">出庫</div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <dl className="divide-y divide-slate-100">
          <Row label="納品日(予定)" value="2024/02/28" />
          <Row label="入庫ロット番号" value="001" />
          <Row label="場所" value="2階 > 1番 > 010301" />
          <Row label="序列分" value="85" />
          <Row label="出庫数量" value="15" />
          <Row label="出庫予備数" value="22" />
        </dl>

        <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
          ※ このままバーコード、RFIDタグの読み込みもできます
        </p>

        <ul className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-lg ring-1 ring-slate-200">
          <ActionRow label="入庫ロット番号" badge={{ text: "必須", tone: "required" }} />
          <ActionRow label="シリアルリスト" badge={{ text: "確認済", tone: "done" }} />
        </ul>
      </div>

      <footer className="border-t border-slate-200 p-3">
        <button
          type="button"
          onClick={onSubmit}
          className="w-full rounded-lg bg-blue-500 py-3 text-[15px] font-bold text-white active:bg-blue-600"
        >
          出庫します
        </button>
      </footer>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-[13px] text-slate-500">{label}</dt>
      <dd className="text-[14px] font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function ActionRow({
  label,
  badge,
}: {
  label: string;
  badge: { text: string; tone: "required" | "done" };
}) {
  const badgeStyle =
    badge.tone === "required"
      ? "bg-rose-50 text-rose-600 ring-rose-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-3 active:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px] text-slate-900">{label}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${badgeStyle}`}
          >
            {badge.text}
          </span>
        </div>
        <span className="text-slate-400">›</span>
      </button>
    </li>
  );
}
