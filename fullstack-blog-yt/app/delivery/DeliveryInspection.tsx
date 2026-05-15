"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ensureBarcodeDetector,
  type BarcodeDetectorInstance,
} from "@/app/lib/barcode-detector";

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

export default function DeliveryInspection() {
  const [destination, setDestination] = useState<Destination | null>(null);
  const [completed, setCompleted] = useState<Map<string, number>>(new Map());

  if (destination === null) {
    return (
      <DestinationPicker onPick={setDestination} completed={completed} />
    );
  }

  return (
    <InspectionWorkflow
      destination={destination}
      onBack={() => setDestination(null)}
      onComplete={(id) => {
        setCompleted((prev) => {
          const next = new Map(prev);
          next.set(id, Date.now());
          return next;
        });
        setDestination(null);
      }}
    />
  );
}

function DestinationPicker({
  onPick,
  completed,
}: {
  onPick: (d: Destination) => void;
  completed: Map<string, number>;
}) {
  const totalItems = DESTINATIONS.reduce((sum, d) => sum + d.items.length, 0);
  const doneCount = DESTINATIONS.filter((d) => completed.has(d.id)).length;
  const allDelivered = doneCount === DESTINATIONS.length;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50 text-slate-900">
      <header className="px-5 pt-6 pb-3">
        <p className="text-[15px] text-slate-500">納品検品スキャン / 金沢営業所</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
          納品先を選択
        </h1>
      </header>

      {allDelivered && (
        <div className="mx-5 mb-3 rounded-xl bg-green-50 px-3 py-2.5 text-[13px] font-bold text-green-800 ring-1 ring-green-200">
          ✓ 本日の納品はすべて完了しました
        </div>
      )}

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
            <dt className="text-slate-500">進捗</dt>
            <dd className="font-semibold tabular-nums">
              <span className="text-green-700">{doneCount}</span>
              <span className="text-slate-400"> / {DESTINATIONS.length} 完了</span>
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
          const doneAt = completed.get(d.id);
          const isDone = doneAt !== undefined;
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
                className={[
                  "flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left shadow-sm transition active:scale-[0.99]",
                  isDone
                    ? "bg-green-50 ring-1 ring-green-200 hover:bg-green-100"
                    : "bg-white ring-1 ring-slate-200 hover:bg-slate-50",
                ].join(" ")}
              >
                {isDone && (
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-sm"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {isDone ? (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 bg-green-100 text-green-800 ring-green-300">
                        ✓ 納品済
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ${tone}`}
                      >
                        {d.shift}
                      </span>
                    )}
                    <span
                      className={[
                        "truncate text-[16px] font-bold",
                        isDone ? "text-slate-500" : "text-slate-900",
                      ].join(" ")}
                    >
                      {d.name}
                    </span>
                  </div>
                  <p
                    className={[
                      "mt-1 truncate text-[13px]",
                      isDone ? "text-slate-400" : "text-slate-500",
                    ].join(" ")}
                  >
                    {d.address}
                  </p>
                  <p
                    className={[
                      "mt-1 text-[12px]",
                      isDone ? "text-slate-400" : "text-slate-600",
                    ].join(" ")}
                  >
                    {isDone ? (
                      <>
                        <span className="font-bold tabular-nums">
                          {d.items.length}
                        </span>{" "}
                        個 ・ {formatTime(doneAt)} 納品
                      </>
                    ) : (
                      <>
                        予定{" "}
                        <span className="font-bold tabular-nums text-slate-900">
                          {d.items.length}
                        </span>{" "}
                        個
                      </>
                    )}
                  </p>
                </div>
                <span
                  className={[
                    "shrink-0 text-2xl",
                    isDone ? "text-green-400" : "text-slate-300",
                  ].join(" ")}
                >
                  ›
                </span>
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
  onComplete,
}: {
  destination: Destination;
  onBack: () => void;
  onComplete: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const rejectMapRef = useRef<Map<string, number>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);

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
  const [showCompletion, setShowCompletion] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [memo, setMemo] = useState("");

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
    const duration = flash.tone === "ok" ? 3000 : 1100;
    const t = setTimeout(() => setFlash(null), duration);
    return () => clearTimeout(t);
  }, [flash]);

  const handleUndoLast = useCallback(() => {
    if (!flash || flash.tone !== "ok") return;
    const text = flash.text;
    setRecords((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].text === text && prev[i].match === "expected") {
          const next = prev.slice();
          next.splice(i, 1);
          return next;
        }
      }
      return prev;
    });
    seenRef.current.delete(text);
    setFlash(null);
  }, [flash]);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const start = async () => {
    setError(null);
    try {
      await ensureBarcodeDetector();
    } catch {
      setError(
        "QR 解読モジュールの読み込みに失敗しました。通信状況を確認してください。",
      );
      return;
    }
    if (typeof window.BarcodeDetector !== "function") {
      setError(
        "このブラウザでは QR 解読が動きません。Chrome / Edge / iOS Safari でお試しください。",
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
                const lastAt = rejectMapRef.current.get(text);
                if (!lastAt || now - lastAt > REJECT_COOLDOWN_MS) {
                  rejectMapRef.current.set(text, now);
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

            if (
              newRecords.some((r) => r.match === "expected") &&
              seenRef.current.size >= expectedItems.length
            ) {
              runningRef.current = false;
              stop();
              setShowCompletion(true);
              return;
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
    rejectMapRef.current.clear();
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
    rejectMapRef.current.clear();
    setRecords([]);
    onBack();
  };

  const totalExpected = expectedItems.length;
  const allDone = expectedDoneCount === totalExpected;

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
  };

  const handlePhotoClear = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
  };

  const handleCompleteSubmit = () => {
    const list = records.filter((r) => r.match === "expected");
    const parts = [
      `${destination.name} へ ${list.length} 件を納品します（デモ）`,
      "",
      ...list.map((r) => `・${r.text}`),
    ];
    if (memo.trim()) parts.push("", `メモ: ${memo.trim()}`);
    parts.push(photoUrl ? "写真: 添付あり" : "写真: なし");
    alert(parts.join("\n"));

    if (photoUrl) URL.revokeObjectURL(photoUrl);
    seenRef.current.clear();
    rejectMapRef.current.clear();
    setRecords([]);
    setPhotoUrl(null);
    setMemo("");
    setShowCompletion(false);
    onComplete(destination.id);
  };

  const handleCompletionDismiss = () => {
    setShowCompletion(false);
  };

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
            納品検品スキャン / 金沢営業所
          </p>
          <h1 className="truncate text-[18px] font-bold tracking-tight text-slate-900">
            {destination.name}
          </h1>
        </div>
      </header>

      <div className="px-5 pb-3">
        <p className="text-[12px] text-slate-500">
          {destination.shift} ・ {destination.address}
        </p>
      </div>

      <div className="px-5">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-slate-300 shadow-sm">
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
                "absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold shadow-lg",
                flash.tone === "ok"
                  ? "bg-green-600/95 text-white"
                  : "bg-red-600/95 text-white pointer-events-none",
              ].join(" ")}
            >
              <span className="flex-1 truncate">
                {flash.tone === "ok" ? "✓ 一致" : "✕ 予定外"}{" "}
                <span className="ml-1 font-mono text-xs opacity-90">
                  {shortenCode(flash.text)}
                </span>
              </span>
              {flash.tone === "ok" && (
                <button
                  type="button"
                  onClick={handleUndoLast}
                  className="shrink-0 rounded-md bg-white/20 px-2.5 py-1 text-xs font-bold text-white ring-1 ring-white/40 backdrop-blur-sm transition active:bg-white/30"
                >
                  取消
                </button>
              )}
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-6 bottom-16 top-6 rounded-2xl border border-dashed border-white/15" />
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col px-5 pb-2 overflow-hidden">
        <div className="flex items-center justify-between pb-1.5">
          <h2 className="text-[15px] font-bold text-slate-900">納品予定</h2>
          <span className="text-sm tabular-nums text-slate-600">
            <span className="font-bold text-blue-600">{expectedDoneCount}</span>
            <span className="text-slate-400"> / {totalExpected}</span>
          </span>
        </div>

        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{
              width: totalExpected
                ? `${(expectedDoneCount / totalExpected) * 100}%`
                : "0%",
            }}
          />
        </div>

        <ul className="flex-shrink overflow-y-auto rounded-xl bg-white ring-1 ring-slate-200 shadow-sm">
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
          このブラウザでは標準の QR 解読 API が無いため、初回スキャン時に
          ポリフィルを読み込みます(数秒)
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

      {showCompletion && (
        <CompletionModal
          destination={destination}
          itemCount={records.filter((r) => r.match === "expected").length}
          photoUrl={photoUrl}
          memo={memo}
          onMemoChange={setMemo}
          onPhotoChange={handlePhotoChange}
          onPhotoClear={handlePhotoClear}
          onSubmit={handleCompleteSubmit}
          onDismiss={handleCompletionDismiss}
        />
      )}
    </div>
  );
}

function CompletionModal({
  destination,
  itemCount,
  photoUrl,
  memo,
  onMemoChange,
  onPhotoChange,
  onPhotoClear,
  onSubmit,
  onDismiss,
}: {
  destination: Destination;
  itemCount: number;
  photoUrl: string | null;
  memo: string;
  onMemoChange: (s: string) => void;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPhotoClear: () => void;
  onSubmit: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/55 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-slate-500">全件スキャン完了</p>
            <h2 className="truncate text-[16px] font-bold text-slate-900">
              {destination.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="閉じる"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-xl bg-green-50 px-3 py-2.5 text-[13px] text-green-800 ring-1 ring-green-200">
            <span className="font-bold tabular-nums">{itemCount}</span>{" "}
            件すべてを照合済みです。納品証跡を残して送信してください。
          </div>

          <label className="mt-4 block text-[13px] font-bold text-slate-700">
            納品写真（任意）
          </label>
          {photoUrl ? (
            <div className="mt-1.5 relative overflow-hidden rounded-xl ring-1 ring-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt="納品写真"
                className="block max-h-60 w-full object-cover"
              />
              <button
                type="button"
                onClick={onPhotoClear}
                className="absolute right-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm"
              >
                撮り直す
              </button>
            </div>
          ) : (
            <label className="mt-1.5 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-[13px] text-slate-500 transition hover:bg-slate-100">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-slate-400"
                aria-hidden
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>タップして撮影</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={onPhotoChange}
                className="hidden"
              />
            </label>
          )}

          <label className="mt-4 block text-[13px] font-bold text-slate-700">
            メモ（任意）
          </label>
          <textarea
            value={memo}
            onChange={(e) => onMemoChange(e.target.value)}
            placeholder="破損・受領者・特記事項など"
            rows={3}
            className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-[14px] text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>

        <div className="grid grid-cols-[1fr_1.6fr] gap-3 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
          >
            戻る
          </button>
          <button
            type="button"
            onClick={onSubmit}
            className="rounded-lg bg-green-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-green-600/25 transition hover:bg-green-500"
          >
            納品を送信する
          </button>
        </div>
      </div>
    </div>
  );
}
