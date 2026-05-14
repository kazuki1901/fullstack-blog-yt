"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { BarcodeDetectorInstance } from "../qr/barcode-detector";

type CodeState = {
  text: string;
  firstSeenAt: number;
  lastSeenAt: number;
  hits: number;
  confirmedAt: number | null;
};

type ConfirmedItem = {
  text: string;
  confirmedAt: number;
};

type TentativeItem = {
  text: string;
  hits: number;
};

type ExpectedItem = {
  code: string;
  category: "早朝" | "TOP" | "夜便";
};

type LiveBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: "confirmed" | "tentative" | "new";
  hits: number;
};

const MIN_HITS_TO_CONFIRM = 5;
const STALE_TENTATIVE_MS = 1500;

const EXPECTED_ITEMS: ExpectedItem[] = [
  { code: "OHK-XYZ-000121", category: "早朝" },
  { code: "OHK-XYZ-000122", category: "早朝" },
  { code: "OHK-XYZ-000123", category: "TOP" },
  { code: "OHK-XYZ-000124", category: "早朝" },
  { code: "OHK-XYZ-000125", category: "夜便" },
  { code: "OHK-XYZ-000126", category: "夜便" },
  { code: "OHK-XYZ-000127", category: "早朝" },
  { code: "OHK-XYZ-000128", category: "TOP" },
  { code: "OHK-XYZ-000129", category: "早朝" },
  { code: "OHK-XYZ-000130", category: "夜便" },
  { code: "OHK-XYZ-000131", category: "早朝" },
  { code: "OHK-XYZ-000132", category: "TOP" },
];

function shortenCode(code: string) {
  if (code.length <= 14) return code;
  return code.slice(0, 4) + "…" + code.slice(-6);
}

const subscribeNoop = () => () => {};
const getSupportedClient = () => typeof window.BarcodeDetector === "function";
const getSupportedServer = (): boolean | null => null;

export default function MultiQrScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const candidatesRef = useRef<Map<string, CodeState>>(new Map());
  const runningRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [view, setView] = useState<"camera" | "list">("camera");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedItem[]>([]);
  const [tentatives, setTentatives] = useState<TentativeItem[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [liveBoxes, setLiveBoxes] = useState<LiveBox[]>([]);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });

  const supported = useSyncExternalStore(
    subscribeNoop,
    getSupportedClient,
    getSupportedServer,
  );

  const beep = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
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
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
    detectorRef.current = null;
    setScanning(false);
    setLiveCount(0);
    setLiveBoxes([]);
    setTentatives([]);
  }, []);

  useEffect(() => {
    return () => {
      stop();
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [stop]);

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

      let lastLive = 0;
      let lastTentSig = "";
      let lastBoxSig = "";

      const loop = async () => {
        if (!runningRef.current) return;
        const detector = detectorRef.current;
        const v = videoRef.current;
        if (detector && v && v.readyState >= 2) {
          try {
            const codes = await detector.detect(v);
            const now = Date.now();
            const map = candidatesRef.current;
            const newlyConfirmed: ConfirmedItem[] = [];

            for (const code of codes) {
              const text = code.rawValue;
              if (!text) continue;
              let state = map.get(text);
              if (!state) {
                state = {
                  text,
                  firstSeenAt: now,
                  lastSeenAt: now,
                  hits: 1,
                  confirmedAt: null,
                };
                map.set(text, state);
              } else {
                state.hits += 1;
                state.lastSeenAt = now;
              }
              if (!state.confirmedAt && state.hits >= MIN_HITS_TO_CONFIRM) {
                state.confirmedAt = now;
                newlyConfirmed.push({
                  text: state.text,
                  confirmedAt: state.confirmedAt,
                });
                beep();
                navigator.vibrate?.(80);
              }
            }

            for (const [key, state] of map) {
              if (
                !state.confirmedAt &&
                now - state.lastSeenAt > STALE_TENTATIVE_MS
              ) {
                map.delete(key);
              }
            }

            const tents: TentativeItem[] = [];
            for (const s of map.values()) {
              if (!s.confirmedAt) tents.push({ text: s.text, hits: s.hits });
            }
            const tentSig = tents.map((t) => `${t.text}:${t.hits}`).join("|");

            const boxes: LiveBox[] = [];
            for (const code of codes) {
              const text = code.rawValue;
              if (!text) continue;
              const bb = code.boundingBox;
              const state = map.get(text);
              const status: LiveBox["status"] = state?.confirmedAt
                ? "confirmed"
                : state && state.hits > 1
                  ? "tentative"
                  : "new";
              boxes.push({
                text,
                x: bb.x,
                y: bb.y,
                width: bb.width,
                height: bb.height,
                status,
                hits: state?.hits ?? 1,
              });
            }
            const boxSig = boxes
              .map(
                (b) =>
                  `${b.text}:${b.status}:${Math.round(b.x)}:${Math.round(b.y)}`,
              )
              .join("|");

            if (codes.length !== lastLive) {
              lastLive = codes.length;
              setLiveCount(codes.length);
            }
            if (tentSig !== lastTentSig) {
              lastTentSig = tentSig;
              setTentatives(tents);
            }
            if (boxSig !== lastBoxSig) {
              lastBoxSig = boxSig;
              setLiveBoxes(boxes);
            }
            if (newlyConfirmed.length > 0) {
              setConfirmed((prev) => [...prev, ...newlyConfirmed]);
            }
          } catch {
            // ignore per-frame failures
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
    if (scanning) stop();
    candidatesRef.current.clear();
    setConfirmed([]);
    setTentatives([]);
    setLiveBoxes([]);
  };

  const handleSubmit = () => {
    if (confirmed.length === 0) return;
    const codes = confirmed.map((c) => c.text);
    alert(`${confirmed.length}件を送信しました\n\n${codes.join("\n")}`);
    candidatesRef.current.clear();
    setConfirmed([]);
    setTentatives([]);
    setLiveBoxes([]);
  };

  const confirmedCodes = useMemo(
    () => new Set(confirmed.map((c) => c.text)),
    [confirmed],
  );

  const tentativeByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tentatives) m.set(t.text, t.hits);
    return m;
  }, [tentatives]);

  const expectedConfirmedCount = useMemo(() => {
    const expectedSet = new Set(EXPECTED_ITEMS.map((e) => e.code));
    return confirmed.filter((c) => expectedSet.has(c.text)).length;
  }, [confirmed]);

  const confirmedCount = confirmed.length;
  const tentativeCount = tentatives.length;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#091428]">
      <header className="px-5 pt-6 pb-2">
        <p className="text-[15px] text-zinc-400">出庫検品 / 金沢営業所</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white">
          山田 / #4 車
        </h1>
      </header>

      <nav className="px-5 pb-3">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#0c1c34] p-1 ring-1 ring-blue-900/40">
          <button
            type="button"
            onClick={() => setView("camera")}
            className={[
              "rounded-lg px-3 py-2 text-sm font-bold transition",
              view === "camera"
                ? "bg-blue-500 text-white shadow"
                : "text-zinc-300 hover:bg-blue-900/30",
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
                ? "bg-blue-500 text-white shadow"
                : "text-zinc-300 hover:bg-blue-900/30",
            ].join(" ")}
          >
            検品状況
            <span
              className={[
                "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
                view === "list"
                  ? "bg-white/20"
                  : "bg-blue-500/20 text-blue-300",
              ].join(" ")}
            >
              {expectedConfirmedCount}/{EXPECTED_ITEMS.length}
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
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black ring-1 ring-blue-900/40">
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
                const color =
                  b.status === "confirmed"
                    ? "#34d399"
                    : b.status === "tentative"
                      ? "#fbbf24"
                      : "#60a5fa";
                return (
                  <g key={b.text}>
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.width}
                      height={b.height}
                      fill="none"
                      stroke={color}
                      strokeWidth={6}
                      strokeDasharray={
                        b.status === "tentative" ? "16 10" : undefined
                      }
                      rx={6}
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
              <p className="px-6 text-sm text-zinc-200">
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
              LIVE {liveCount}
            </span>
            <div className="flex gap-1.5">
              <span className="rounded-md bg-blue-500/90 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-sm">
                ✓ {confirmedCount}
              </span>
              <span className="rounded-md bg-black/65 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-sm">
                … {tentativeCount}
              </span>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-6 bottom-6 top-6 rounded-2xl border border-dashed border-white/15" />
        </div>

        <p className="mt-3 text-center text-xs text-zinc-500">
          複数の QR を同時に映してください（{MIN_HITS_TO_CONFIRM} 回連続検出で確定）
        </p>
      </div>

      <div
        className={[
          "flex-1 px-5",
          view === "list" ? "flex flex-col" : "hidden",
        ].join(" ")}
      >
        <section className="rounded-2xl bg-[#0c1c34] p-4 ring-1 ring-blue-900/40">
          <dl className="space-y-1.5 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-zinc-400">納品日</dt>
              <dd className="font-semibold text-white tabular-nums">
                2026/05/14
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">便区分</dt>
              <dd className="font-semibold text-white">早朝 / TOP / 夜便</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">担当 / 車番</dt>
              <dd className="font-semibold text-white">山田 / #4</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">予定個数</dt>
              <dd className="font-semibold text-white tabular-nums">
                {EXPECTED_ITEMS.length}
              </dd>
            </div>
          </dl>
        </section>

        <div className="mt-4 flex items-center justify-between pb-2">
          <h2 className="text-[15px] font-bold text-white">スキャン状況</h2>
          <span className="text-sm tabular-nums text-blue-300">
            {expectedConfirmedCount} / {EXPECTED_ITEMS.length}
          </span>
        </div>

        <ul className="overflow-hidden rounded-xl bg-[#0c1c34]/60 ring-1 ring-blue-900/30">
          {EXPECTED_ITEMS.map((item) => {
            const isConfirmed = confirmedCodes.has(item.code);
            const tentativeHits = tentativeByCode.get(item.code) ?? 0;
            return (
              <li
                key={item.code}
                className="flex items-center gap-3 border-b border-blue-900/20 px-3 py-2.5 last:border-0"
              >
                <ItemMark
                  isConfirmed={isConfirmed}
                  tentativeHits={tentativeHits}
                />
                <span
                  className={[
                    "flex-1 font-mono text-sm tabular-nums",
                    isConfirmed
                      ? "text-zinc-500 line-through"
                      : "text-zinc-200",
                  ].join(" ")}
                >
                  {shortenCode(item.code)}
                </span>
                <span className="text-xs text-zinc-400">{item.category}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {error && (
        <div className="mx-5 mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-red-500/30">
          {error}
        </div>
      )}

      {supported === false && (
        <div className="mx-5 mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-500/30">
          このブラウザは BarcodeDetector API に未対応です。Chrome / Edge /
          Android Chrome を推奨します
        </div>
      )}

      <div className="sticky bottom-0 mt-4 grid grid-cols-[1fr_2fr] gap-3 border-t border-blue-900/40 bg-[#091428] px-5 py-4">
        <button
          type="button"
          onClick={handleAbort}
          className="rounded-lg border border-zinc-600 bg-transparent px-4 py-3 text-sm font-bold text-zinc-200 transition hover:bg-zinc-800"
        >
          中断
        </button>
        {scanning ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={confirmedCount === 0}
            className="rounded-lg bg-blue-500 px-4 py-3 text-sm font-bold text-white shadow-md shadow-blue-500/30 transition hover:bg-blue-400 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:shadow-none"
          >
            送信({confirmedCount}件)
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="rounded-lg bg-blue-500 px-4 py-3 text-sm font-bold text-white shadow-md shadow-blue-500/30 transition hover:bg-blue-400"
          >
            スキャン開始
          </button>
        )}
      </div>
    </div>
  );
}

function ItemMark({
  isConfirmed,
  tentativeHits,
}: {
  isConfirmed: boolean;
  tentativeHits: number;
}) {
  if (isConfirmed) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-500">
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
      </span>
    );
  }
  if (tentativeHits > 0) {
    return (
      <span className="flex h-5 min-w-[1.75rem] shrink-0 items-center justify-center rounded border border-zinc-500 px-1 text-[10px] font-bold tabular-nums text-zinc-300">
        {tentativeHits}/{MIN_HITS_TO_CONFIRM}
      </span>
    );
  }
  return <span className="h-5 w-5 shrink-0 rounded border border-zinc-700" />;
}
