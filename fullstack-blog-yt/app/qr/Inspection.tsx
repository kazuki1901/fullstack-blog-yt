"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { BarcodeDetectorInstance } from "./barcode-detector";

type ScanRecord = {
  text: string;
  scannedAt: number;
  match: "expected" | "unexpected";
};

type LiveBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: "match" | "unmatch";
};

type ExpectedItem = {
  code: string;
  label: string;
  category: "早朝" | "TOP" | "夜便";
};

type Destination = {
  id: string;
  name: string;
  address: string;
  shift: "早朝" | "TOP" | "夜便";
  items: ExpectedItem[];
};

type View = "camera" | "list";

const DESTINATIONS: Destination[] = [
  {
    id: "conv-a-kanazawa-st",
    name: "コンビニA 金沢駅前店",
    address: "金沢市木ノ新保町",
    shift: "早朝",
    items: [
      { code: "OHK-XYZ-000121", label: "商品 1kg", category: "早朝" },
      { code: "OHK-XYZ-000122", label: "商品 1kg", category: "早朝" },
      { code: "OHK-XYZ-000124", label: "商品 1kg", category: "早朝" },
    ],
  },
  {
    id: "conv-b-korinbo",
    name: "コンビニB 香林坊店",
    address: "金沢市香林坊",
    shift: "早朝",
    items: [
      { code: "OHK-XYZ-000127", label: "商品 1kg", category: "早朝" },
      { code: "OHK-XYZ-000129", label: "商品 1kg", category: "早朝" },
    ],
  },
  {
    id: "super-c-musashi",
    name: "スーパーC 武蔵店",
    address: "金沢市武蔵町",
    shift: "TOP",
    items: [
      { code: "OHK-XYZ-000123", label: "詰合せ", category: "TOP" },
      { code: "OHK-XYZ-000128", label: "詰合せ", category: "TOP" },
    ],
  },
  {
    id: "drug-d-kanazawa",
    name: "ドラッグストアD 金沢店",
    address: "金沢市福久町",
    shift: "夜便",
    items: [
      { code: "OHK-XYZ-000125", label: "雑貨セット", category: "夜便" },
      { code: "OHK-XYZ-000126", label: "雑貨セット", category: "夜便" },
      { code: "OHK-XYZ-000130", label: "雑貨セット", category: "夜便" },
    ],
  },
  {
    id: "hospital-e",
    name: "E病院",
    address: "金沢市片町",
    shift: "夜便",
    items: [
      { code: "OHK-XYZ-000131", label: "医療資材", category: "夜便" },
    ],
  },
];

const REJECT_COOLDOWN_MS = 1200;

function shortenCode(code: string) {
  if (code.length <= 14) return code;
  return code.slice(0, 4) + "…" + code.slice(-6);
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

const subscribeNoop = () => () => {};
const getSupportedClient = () => typeof window.BarcodeDetector === "function";
const getSupportedServer = (): boolean | null => null;

export default function Inspection() {
  const [destination, setDestination] = useState<Destination | null>(null);

  if (destination === null) {
    return <DestinationPicker onPick={setDestination} />;
  }

  return (
    <InspectionWorkflow
      destination={destination}
      onBack={() => setDestination(null)}
    />
  );
}

function DestinationPicker({
  onPick,
}: {
  onPick: (d: Destination) => void;
}) {
  const totalItems = DESTINATIONS.reduce((sum, d) => sum + d.items.length, 0);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50 text-slate-900">
      <header className="px-5 pt-6 pb-3">
        <p className="text-[15px] text-slate-500">出庫検品 / 金沢営業所</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
          納品先を選択
        </h1>
      </header>

      <section className="mx-5 mb-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200 shadow-sm">
        <dl className="space-y-1.5 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-slate-500">納品日</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              2026/05/14
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">担当 / 車番</dt>
            <dd className="font-semibold text-slate-900">山田 / #4</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">納品先数</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {DESTINATIONS.length}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">合計個数</dt>
            <dd className="font-semibold text-slate-900 tabular-nums">
              {totalItems}
            </dd>
          </div>
        </dl>
      </section>

      <ul className="mx-5 mb-6 space-y-2">
        {DESTINATIONS.map((d) => {
          const tone =
            d.shift === "早朝"
              ? "bg-amber-100 text-amber-800 ring-amber-200"
              : d.shift === "TOP"
                ? "bg-blue-100 text-blue-800 ring-blue-200"
                : "bg-indigo-100 text-indigo-800 ring-indigo-200";
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onPick(d)}
                className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-3.5 text-left ring-1 ring-slate-200 shadow-sm transition active:scale-[0.99] hover:bg-slate-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ${tone}`}
                    >
                      {d.shift}
                    </span>
                    <span className="truncate text-[16px] font-bold text-slate-900">
                      {d.name}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[13px] text-slate-500">
                    {d.address}
                  </p>
                  <p className="mt-1 text-[12px] text-slate-600">
                    予定 <span className="font-bold tabular-nums text-slate-900">{d.items.length}</span> 個
                  </p>
                </div>
                <span className="shrink-0 text-2xl text-slate-300">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InspectionWorkflow({
  destination,
  onBack,
}: {
  destination: Destination;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const lastRejectRef = useRef<{ text: string; at: number } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [view, setView] = useState<View>("camera");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [liveBoxes, setLiveBoxes] = useState<LiveBox[]>([]);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [flash, setFlash] = useState<{
    text: string;
    tone: "ok" | "ng";
    at: number;
  } | null>(null);

  const supported = useSyncExternalStore(
    subscribeNoop,
    getSupportedClient,
    getSupportedServer,
  );

  const expectedItems = destination.items;
  const expectedSet = useMemo(
    () => new Set(expectedItems.map((e) => e.code)),
    [expectedItems],
  );

  const scannedExpected = useMemo(
    () =>
      new Set(
        records.filter((r) => r.match === "expected").map((r) => r.text),
      ),
    [records],
  );

  const expectedDoneCount = scannedExpected.size;
  const unexpectedRecords = useMemo(
    () => records.filter((r) => r.match === "unexpected"),
    [records],
  );

  const beep = useCallback((tone: "ok" | "ng") => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = tone === "ok" ? 880 : 240;
      gain.gain.value = 0.14;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (tone === "ok" ? 0.08 : 0.18));
    } catch {
      // ignore
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
    detectorRef.current = null;
    setScanning(false);
    setLiveBoxes([]);
  }, []);

  useEffect(() => {
    return () => {
      stop();
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [stop]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1100);
    return () => clearTimeout(t);
  }, [flash]);

  const start = async () => {
    setError(null);
    if (typeof window.BarcodeDetector !== "function") {
      setError(
        "このブラウザは BarcodeDetector API に未対応です。Chrome / Edge / Android Chrome をお試しください。",
      );
      return;
    }

    try {
      detectorRef.current = new window.BarcodeDetector({
        formats: ["qr_code"],
      });

      if (!audioCtxRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (Ctor) {
          try {
            audioCtxRef.current = new Ctor();
          } catch {
            audioCtxRef.current = null;
          }
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("video element not ready");
      video.srcObject = stream;
      await video.play();
      setVideoSize({
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
      });

      runningRef.current = true;
      setScanning(true);

      const loop = async () => {
        if (!runningRef.current) return;
        const detector = detectorRef.current;
        const v = videoRef.current;
        if (detector && v && v.readyState >= 2) {
          try {
            const codes = await detector.detect(v);
            const now = Date.now();
            const boxes: LiveBox[] = [];
            const newRecords: ScanRecord[] = [];

            for (const code of codes) {
              const text = code.rawValue;
              if (!text) continue;
              const isExpected = expectedSet.has(text);
              const bb = code.boundingBox;
              if (bb) {
                boxes.push({
                  text,
                  x: bb.x,
                  y: bb.y,
                  width: bb.width,
                  height: bb.height,
                  status: isExpected ? "match" : "unmatch",
                });
              }
              if (seenRef.current.has(text)) continue;

              if (isExpected) {
                seenRef.current.add(text);
                newRecords.push({
                  text,
                  scannedAt: now,
                  match: "expected",
                });
                beep("ok");
                navigator.vibrate?.(80);
                setFlash({ text, tone: "ok", at: now });
              } else {
                const last = lastRejectRef.current;
                if (
                  !last ||
                  last.text !== text ||
                  now - last.at > REJECT_COOLDOWN_MS
                ) {
                  lastRejectRef.current = { text, at: now };
                  newRecords.push({
                    text,
                    scannedAt: now,
                    match: "unexpected",
                  });
                  beep("ng");
                  navigator.vibrate?.([40, 60, 40]);
                  setFlash({ text, tone: "ng", at: now });
                }
              }
            }

            setLiveBoxes(boxes);
            if (newRecords.length > 0) {
              setRecords((prev) => [...prev, ...newRecords]);
            }
          } catch {
            // ignore frame failures
          }
        }
        if (runningRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            void loop();
          });
        }
      };

      void loop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`カメラを起動できませんでした: ${message}`);
      stop();
    }
  };

  const handleAbort = () => {
    if (
      records.length > 0 &&
      !confirm("スキャン内容を破棄して納品先一覧に戻りますか？")
    ) {
      return;
    }
    stop();
    seenRef.current.clear();
    lastRejectRef.current = null;
    setRecords([]);
    onBack();
  };

  const handleSubmit = () => {
    const list = records.filter((r) => r.match === "expected");
    if (list.length === 0) return;
    alert(
      `${destination.name} へ ${list.length} 件を出庫します（デモ）\n\n${list
        .map((r) => r.text)
        .join("\n")}`,
    );
    stop();
    seenRef.current.clear();
    lastRejectRef.current = null;
    setRecords([]);
    onBack();
  };

  const totalExpected = expectedItems.length;
  const allDone = expectedDoneCount === totalExpected;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center gap-3 px-5 pt-6 pb-2">
        <button
          type="button"
          onClick={handleAbort}
          aria-label="納品先一覧に戻る"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-xl text-slate-700 ring-1 ring-slate-200 active:bg-slate-100"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-slate-500">
            出庫検品 / 金沢営業所(単発)
          </p>
          <h1 className="truncate text-[18px] font-bold tracking-tight text-slate-900">
            {destination.name}
          </h1>
        </div>
      </header>

      <nav className="px-5 pb-3">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-1 ring-1 ring-slate-200">
          <button
            type="button"
            onClick={() => setView("camera")}
            className={[
              "rounded-lg px-3 py-2 text-sm font-bold transition",
              view === "camera"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            カメラ
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={[
              "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition",
              view === "list"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            予定リスト
            <span
              className={[
                "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
                view === "list"
                  ? "bg-white/25"
                  : "bg-blue-100 text-blue-700",
              ].join(" ")}
            >
              {expectedDoneCount}/{totalExpected}
            </span>
          </button>
        </div>
      </nav>

      <div
        className={[
          "px-5",
          view === "camera" ? "flex flex-1 flex-col" : "hidden",
        ].join(" ")}
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-300 shadow-sm">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            muted
            playsInline
          />
          {videoSize.width > 0 && (
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${videoSize.width} ${videoSize.height}`}
              preserveAspectRatio="xMidYMid slice"
            >
              {liveBoxes.map((b) => {
                const color = b.status === "match" ? "#22c55e" : "#ef4444";
                return (
                  <rect
                    key={b.text}
                    x={b.x}
                    y={b.y}
                    width={b.width}
                    height={b.height}
                    fill="none"
                    stroke={color}
                    strokeWidth={6}
                    rx={6}
                  />
                );
              })}
            </svg>
          )}

          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80 text-center">
              <p className="px-6 text-sm text-slate-100">
                「スキャン開始」を押すとカメラが起動します
              </p>
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 flex items-start justify-between p-3">
            <span className="rounded-full bg-black/65 px-3 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-sm">
              <span
                className={[
                  "mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
                  scanning ? "bg-red-500" : "bg-zinc-500",
                ].join(" ")}
              />
              {scanning ? "READING" : "PAUSED"}
            </span>
            <span className="rounded-md bg-green-600/90 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-sm">
              {expectedDoneCount} / {totalExpected}
            </span>
          </div>

          {flash && (
            <div
              className={[
                "pointer-events-none absolute inset-x-3 bottom-3 rounded-lg px-3 py-2 text-sm font-bold shadow-lg",
                flash.tone === "ok"
                  ? "bg-green-600/95 text-white"
                  : "bg-red-600/95 text-white",
              ].join(" ")}
            >
              {flash.tone === "ok" ? "✓ 一致" : "✕ 予定外"}{" "}
              <span className="ml-1 font-mono text-xs opacity-90">
                {shortenCode(flash.text)}
              </span>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-6 bottom-16 top-6 rounded-2xl border border-dashed border-white/15" />
        </div>

        <p className="mt-3 text-center text-xs text-slate-500">
          QR を 1 つずつ枠に映してください。一致音/不一致音で結果が分かります
        </p>
      </div>

      <div
        className={[
          "flex-1 px-5",
          view === "list" ? "flex flex-col" : "hidden",
        ].join(" ")}
      >
        <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 shadow-sm">
          <dl className="space-y-1.5 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-slate-500">納品先</dt>
              <dd className="font-semibold text-slate-900">{destination.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">住所</dt>
              <dd className="text-right font-semibold text-slate-900">
                {destination.address}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">便区分</dt>
              <dd className="font-semibold text-slate-900">{destination.shift}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">予定個数</dt>
              <dd className="font-semibold text-slate-900 tabular-nums">
                {totalExpected}
              </dd>
            </div>
          </dl>
        </section>

        <div className="mt-4 flex items-center justify-between pb-2">
          <h2 className="text-[15px] font-bold text-slate-900">出庫予定</h2>
          <span className="text-sm tabular-nums text-slate-600">
            <span className="font-bold text-blue-600">{expectedDoneCount}</span>
            <span className="text-slate-400"> / {totalExpected}</span>
          </span>
        </div>

        <ul className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 shadow-sm">
          {expectedItems.map((item) => {
            const done = scannedExpected.has(item.code);
            return (
              <li
                key={item.code}
                className="flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-0"
              >
                <span
                  className={[
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded",
                    done
                      ? "bg-green-600"
                      : "border border-slate-300 bg-white",
                  ].join(" ")}
                >
                  {done && (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3 w-3 text-white"
                      aria-hidden
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <div className="flex flex-1 flex-col">
                  <span
                    className={[
                      "text-sm font-medium",
                      done ? "text-slate-400 line-through" : "text-slate-900",
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                  <span
                    className={[
                      "font-mono text-[11px] tabular-nums",
                      done ? "text-slate-400" : "text-slate-500",
                    ].join(" ")}
                  >
                    {shortenCode(item.code)}
                  </span>
                </div>
                <span className="text-xs text-slate-500">{item.category}</span>
              </li>
            );
          })}
        </ul>

        {unexpectedRecords.length > 0 && (
          <>
            <div className="mt-5 flex items-center justify-between pb-2">
              <h2 className="text-[15px] font-bold text-slate-900">
                予定外のスキャン
              </h2>
              <span className="text-sm tabular-nums text-red-600">
                {unexpectedRecords.length} 件
              </span>
            </div>
            <ul className="overflow-hidden rounded-xl bg-red-50 ring-1 ring-red-200 shadow-sm">
              {unexpectedRecords.map((r) => (
                <li
                  key={`${r.text}-${r.scannedAt}`}
                  className="flex items-center gap-3 border-b border-red-100 px-3 py-2.5 last:border-0"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-red-500">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3 w-3 text-white"
                      aria-hidden
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </span>
                  <span className="flex-1 break-all font-mono text-sm text-slate-800">
                    {r.text}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-red-600">
                    {formatTime(r.scannedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      )}

      {supported === false && (
        <div className="mx-5 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          このブラウザは BarcodeDetector API に未対応です。Chrome / Edge /
          Android Chrome を推奨します
        </div>
      )}

      <div className="sticky bottom-0 mt-4 grid grid-cols-[1fr_2fr] gap-3 border-t border-slate-200 bg-slate-50/95 px-5 py-4 backdrop-blur">
        <button
          type="button"
          onClick={handleAbort}
          className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
        >
          納品先へ戻る
        </button>
        {scanning ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={expectedDoneCount === 0}
            className={[
              "rounded-lg px-4 py-3 text-sm font-bold text-white shadow-md transition",
              allDone
                ? "bg-green-600 shadow-green-600/25 hover:bg-green-500"
                : "bg-blue-600 shadow-blue-600/25 hover:bg-blue-500",
              "disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
            ].join(" ")}
          >
            {allDone
              ? "出庫する"
              : `出庫する(${expectedDoneCount}/${totalExpected})`}
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-500"
          >
            スキャン開始
          </button>
        )}
      </div>
    </div>
  );
}
