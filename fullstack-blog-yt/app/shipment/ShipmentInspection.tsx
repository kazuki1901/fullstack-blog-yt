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

type CodeState = {
  text: string;
  firstSeenAt: number;
  lastSeenAt: number;
  hits: number;
  confirmedAt: number | null;
};

type DimsInput = { l: string; w: string; h: string };

type SizeCode =
  | "60"
  | "80"
  | "100"
  | "120"
  | "140"
  | "160"
  | "180"
  | "200"
  | "260"
  | "規格外";

type ParsedDims = {
  l: number;
  w: number;
  h: number;
  totalCm: number;
  sizeCode: SizeCode;
};

function calcSizeCode(totalCm: number): SizeCode {
  if (totalCm <= 60) return "60";
  if (totalCm <= 80) return "80";
  if (totalCm <= 100) return "100";
  if (totalCm <= 120) return "120";
  if (totalCm <= 140) return "140";
  if (totalCm <= 160) return "160";
  if (totalCm <= 180) return "180";
  if (totalCm <= 200) return "200";
  if (totalCm <= 260) return "260";
  return "規格外";
}

function parseDims(d?: DimsInput | null): ParsedDims | null {
  if (!d) return null;
  const l = Number.parseInt(d.l, 10);
  const w = Number.parseInt(d.w, 10);
  const h = Number.parseInt(d.h, 10);
  if (!Number.isFinite(l) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }
  if (l <= 0 || w <= 0 || h <= 0) return null;
  const totalCm = l + w + h;
  return { l, w, h, totalCm, sizeCode: calcSizeCode(totalCm) };
}

type ConfirmedItem = {
  text: string;
  confirmedAt: number;
  dims?: DimsInput;
};

type TentativeItem = {
  text: string;
  hits: number;
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

const MIN_HITS_TO_CONFIRM = 10;
const STALE_TENTATIVE_MS = 1500;

type DepotKind = "shipper" | "branch" | "relay";

type Depot = {
  id: string;
  name: string;
  kind: DepotKind;
  lat: number;
  lng: number;
  radiusM: number;
  address?: string;
};

const DEPOT_KIND_LABEL: Record<DepotKind, string> = {
  shipper: "荷主",
  branch: "営業所",
  relay: "中継所",
};

const DEPOTS: Depot[] = [
  {
    id: "toho-amagasaki",
    name: "東邦自動車",
    kind: "shipper",
    lat: 34.756757,
    lng: 135.445805,
    radiusM: 2500,
    address: "兵庫県尼崎市小中島1-17-15",
  },
  {
    id: "osaka",
    name: "大阪営業所",
    kind: "branch",
    lat: 34.7024,
    lng: 135.4959,
    radiusM: 800,
  },
  {
    id: "kyoto-relay",
    name: "京都中継所",
    kind: "relay",
    lat: 35.0116,
    lng: 135.7681,
    radiusM: 800,
  },
  {
    id: "fukui-relay",
    name: "福井中継所",
    kind: "relay",
    lat: 36.0652,
    lng: 136.2216,
    radiusM: 800,
  },
  {
    id: "kanazawa",
    name: "金沢営業所",
    kind: "branch",
    lat: 36.578,
    lng: 136.6485,
    radiusM: 800,
  },
];

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findDepot(
  lat: number,
  lng: number,
  accuracyM: number = 0,
): { depot: Depot; distance: number } | null {
  let best: { depot: Depot; distance: number } | null = null;
  // GPS の誤差円が拠点円と重なるか(distance - accuracy <= radiusM) で判定。
  // 屋内/WiFi 測位で精度が ±数百〜数千m に劣化しても拠点を見落とさない。
  for (const d of DEPOTS) {
    const distance = haversineMeters(lat, lng, d.lat, d.lng);
    const effective = distance - accuracyM;
    if (effective <= d.radiusM && (!best || distance < best.distance)) {
      best = { depot: d, distance };
    }
  }
  return best;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function isSameDay(a: number, b: number) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

const subscribeNoop = () => () => {};
const getSupportedClient = () => typeof window.BarcodeDetector === "function";
const getSupportedServer = (): boolean | null => null;

export default function ShipmentInspection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const candidatesRef = useRef<Map<string, CodeState>>(new Map());
  const runningRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [view, setView] = useState<"camera" | "history">("camera");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedItem[]>([]);
  const [tentatives, setTentatives] = useState<TentativeItem[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [liveBoxes, setLiveBoxes] = useState<LiveBox[]>([]);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    at: number;
  } | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [positionLoading, setPositionLoading] = useState(false);
  const [submitted, setSubmitted] = useState<{
    count: number;
    items: ConfirmedItem[];
    at: number;
    position: {
      lat: number;
      lng: number;
      accuracy: number;
      at: number;
    } | null;
    positionError: string | null;
    depot: Depot | null;
  } | null>(null);
  const [history, setHistory] = useState<
    {
      id: string;
      at: number;
      count: number;
      items: ConfirmedItem[];
      position: {
        lat: number;
        lng: number;
        accuracy: number;
        at: number;
      } | null;
      depot: Depot | null;
    }[]
  >([]);
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const [lastDims, setLastDims] = useState<DimsInput | null>(null);

  const supported = useSyncExternalStore(
    subscribeNoop,
    getSupportedClient,
    getSupportedServer,
  );

  const capturePosition = useCallback(() => {
    setPositionError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPositionError("この端末は位置情報に未対応です");
      return;
    }
    setPositionLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        });
        setPositionLoading(false);
      },
      (err) => {
        setPositionLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setPositionError("位置情報の許可が必要です");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setPositionError("位置情報を取得できませんでした(電波/GPS 状態)");
        } else if (err.code === err.TIMEOUT) {
          setPositionError("位置情報の取得がタイムアウトしました");
        } else {
          setPositionError("位置情報を取得できませんでした");
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  }, []);

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
    capturePosition();
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
    setExpandedText(null);
  };

  const updateItemDims = useCallback(
    (text: string, next: DimsInput | undefined) => {
      setConfirmed((prev) =>
        prev.map((c) => (c.text === text ? { ...c, dims: next } : c)),
      );
      if (next && parseDims(next)) {
        setLastDims(next);
      }
    },
    [],
  );

  const currentDepot = useMemo(
    () =>
      position
        ? findDepot(position.lat, position.lng, position.accuracy)
        : null,
    [position],
  );

  const [sessionStartMs] = useState(() => Date.now());
  const todayHistoryCount = useMemo(
    () => history.filter((h) => isSameDay(h.at, sessionStartMs)).length,
    [history, sessionStartMs],
  );

  const handleSubmit = () => {
    if (confirmed.length === 0) return;
    const items = confirmed;
    if (scanning) stop();
    const now = Date.now();
    const depot = currentDepot?.depot ?? null;
    setSubmitted({
      count: confirmed.length,
      items,
      at: now,
      position,
      positionError,
      depot,
    });
    setHistory((prev) => [
      {
        id: `sub-${now}`,
        at: now,
        count: confirmed.length,
        items,
        position,
        depot,
      },
      ...prev,
    ]);
    candidatesRef.current.clear();
    setConfirmed([]);
    setTentatives([]);
    setLiveBoxes([]);
    setExpandedText(null);
    setPosition(null);
    setPositionError(null);
  };

  const handleSubmittedDismiss = () => {
    setSubmitted(null);
  };

  const confirmedCount = confirmed.length;
  const tentativeCount = tentatives.length;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50 text-slate-900">
      <header className="px-5 pt-6 pb-2">
        <p className="text-[15px] text-slate-500">出庫検品スキャン / 金沢営業所</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
          山田 / #4 車
        </h1>
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
            onClick={() => setView("history")}
            className={[
              "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition",
              view === "history"
                ? "bg-blue-600 text-white shadow"
                : "text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            当日履歴
            <span
              className={[
                "rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
                view === "history"
                  ? "bg-white/25"
                  : "bg-blue-100 text-blue-700",
              ].join(" ")}
            >
              {todayHistoryCount}
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
                const color =
                  b.status === "confirmed"
                    ? "#22c55e"
                    : b.status === "tentative"
                      ? "#f59e0b"
                      : "#3b82f6";
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
              LIVE {liveCount}
            </span>
            <div className="flex gap-1.5">
              <span className="rounded-md bg-green-600/90 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-sm">
                ✓ {confirmedCount}
              </span>
              <span className="rounded-md bg-black/65 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-sm">
                … {tentativeCount}
              </span>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-6 bottom-6 top-6 rounded-2xl border border-dashed border-white/15" />

          {(positionLoading || position || positionError) && (
            <div className="pointer-events-auto absolute inset-x-3 bottom-3 flex items-center gap-2">
              <span
                className={[
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold shadow-sm backdrop-blur-sm",
                  positionError
                    ? "bg-amber-500/90 text-white"
                    : currentDepot
                      ? "bg-green-600/95 text-white"
                      : "bg-black/65 text-white",
                ].join(" ")}
              >
                <span aria-hidden>📍</span>
                {positionLoading
                  ? "位置取得中…"
                  : positionError
                    ? positionError
                    : currentDepot
                      ? `[${DEPOT_KIND_LABEL[currentDepot.depot.kind]}] ${currentDepot.depot.name} (±${Math.round(currentDepot.distance)}m)`
                      : position
                        ? `拠点外 ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`
                        : ""}
              </span>
              {positionError && (
                <button
                  type="button"
                  onClick={capturePosition}
                  className="shrink-0 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-slate-800 shadow-sm transition active:bg-white"
                >
                  再取得
                </button>
              )}
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-slate-500">
          複数の QR を同時に映してください（{MIN_HITS_TO_CONFIRM} 回連続検出で確定）
        </p>

        {confirmed.length > 0 && (
          <section className="mt-4 pb-2">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-[13px] font-bold text-slate-600">
                確定済み {confirmed.length} 件
              </h2>
              <p className="text-[11px] text-slate-500 tabular-nums">
                採寸{" "}
                {confirmed.filter((c) => parseDims(c.dims)).length}/
                {confirmed.length}
              </p>
            </div>
            <ul className="space-y-1.5">
              {confirmed.map((item) => {
                const expanded = expandedText === item.text;
                const parsed = parseDims(item.dims);
                return (
                  <li key={item.text}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedText((prev) =>
                          prev === item.text ? null : item.text,
                        )
                      }
                      className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-slate-200 shadow-sm transition active:bg-slate-50"
                    >
                      <span className="text-green-600">✓</span>
                      <span className="flex-1 truncate font-mono text-[12px] text-slate-700">
                        {item.text}
                      </span>
                      {parsed ? (
                        <span className="shrink-0 rounded-md bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-800 ring-1 ring-blue-200 tabular-nums">
                          📏 {parsed.sizeCode}サイズ
                        </span>
                      ) : item.dims ? (
                        <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
                          📏 入力中
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
                          📏 未入力
                        </span>
                      )}
                      <span
                        className={[
                          "shrink-0 text-slate-400 transition-transform",
                          expanded ? "rotate-90" : "",
                        ].join(" ")}
                        aria-hidden
                      >
                        ›
                      </span>
                    </button>
                    {expanded && (
                      <DimsEditor
                        value={item.dims}
                        lastDims={lastDims}
                        onChange={(next) => updateItemDims(item.text, next)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <div
        className={[
          "flex-1 px-5 pb-2",
          view === "history" ? "flex flex-col" : "hidden",
        ].join(" ")}
      >
        <HistoryView history={history} />
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
          中断
        </button>
        {scanning ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={confirmedCount === 0}
            className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-500 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            送信({confirmedCount}件)
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

      {submitted && (
        <SubmittedModal
          count={submitted.count}
          items={submitted.items}
          at={submitted.at}
          position={submitted.position}
          positionError={submitted.positionError}
          depot={submitted.depot}
          onDismiss={handleSubmittedDismiss}
        />
      )}
    </div>
  );
}

function DimsEditor({
  value,
  lastDims,
  onChange,
}: {
  value?: DimsInput;
  lastDims: DimsInput | null;
  onChange: (next: DimsInput | undefined) => void;
}) {
  const v = value ?? { l: "", w: "", h: "" };
  const parsed = parseDims(value);
  const update = (k: keyof DimsInput, raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, "").slice(0, 3);
    const next: DimsInput = { ...v, [k]: cleaned };
    if (!next.l && !next.w && !next.h) {
      onChange(undefined);
    } else {
      onChange(next);
    }
  };
  const canCopyLast = lastDims !== null && parseDims(lastDims) !== null;
  return (
    <div className="mt-1 rounded-xl bg-white px-3 py-3 ring-1 ring-slate-200">
      <div className="grid grid-cols-3 gap-2">
        <DimsField label="縦" value={v.l} onChange={(x) => update("l", x)} />
        <DimsField label="横" value={v.w} onChange={(x) => update("w", x)} />
        <DimsField label="高さ" value={v.h} onChange={(x) => update("h", x)} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[12px] text-slate-600">
          {parsed ? (
            <>
              3辺合計{" "}
              <span className="font-bold tabular-nums text-slate-900">
                {parsed.totalCm}cm
              </span>{" "}
              →{" "}
              <span
                className={[
                  "font-bold tabular-nums",
                  parsed.sizeCode === "規格外"
                    ? "text-red-700"
                    : "text-blue-700",
                ].join(" ")}
              >
                {parsed.sizeCode}サイズ
              </span>
            </>
          ) : (
            <span className="text-slate-400">3辺を入力してください</span>
          )}
        </p>
        <div className="flex shrink-0 gap-1.5">
          {canCopyLast && (
            <button
              type="button"
              onClick={() => onChange(lastDims!)}
              className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700 transition active:bg-slate-200"
            >
              前と同じ
            </button>
          )}
          {value && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700 transition active:bg-slate-200"
            >
              クリア
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DimsField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block px-0.5 text-[11px] font-bold text-slate-500">
        {label}
      </span>
      <div className="mt-0.5 flex items-baseline rounded-lg bg-slate-50 px-2 py-1.5 ring-1 ring-slate-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="w-full bg-transparent text-right text-[16px] font-bold tabular-nums text-slate-900 outline-none placeholder:text-slate-300"
        />
        <span className="ml-1 text-[11px] text-slate-500">cm</span>
      </div>
    </label>
  );
}

function HistoryView({
  history,
}: {
  history: {
    id: string;
    at: number;
    count: number;
    items: ConfirmedItem[];
    position: {
      lat: number;
      lng: number;
      accuracy: number;
      at: number;
    } | null;
    depot: Depot | null;
  }[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionStartMs] = useState(() => Date.now());
  const today = useMemo(
    () => history.filter((h) => isSameDay(h.at, sessionStartMs)),
    [history, sessionStartMs],
  );
  const totalCount = useMemo(
    () => today.reduce((sum, h) => sum + h.count, 0),
    [today],
  );
  const depotSummary = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of today) {
      const key = h.depot?.name ?? "拠点外";
      m.set(key, (m.get(key) ?? 0) + h.count);
    }
    return [...m.entries()];
  }, [today]);

  if (today.length === 0) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
        本日の送信履歴はまだありません。
        <br />
        スキャンして送信すると、ここに記録されます。
      </div>
    );
  }

  return (
    <>
      <section className="mt-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200 shadow-sm">
        <p className="text-[12px] text-slate-500">本日の合計</p>
        <p className="text-[26px] font-bold tabular-nums text-slate-900">
          {totalCount}{" "}
          <span className="text-[14px] font-semibold text-slate-500">件</span>
          <span className="ml-2 text-[14px] font-semibold text-slate-500">
            ／ {today.length} 回送信
          </span>
        </p>
        {depotSummary.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {depotSummary.map(([name, count]) => (
              <li
                key={name}
                className={[
                  "rounded-md px-2 py-1 text-[11px] font-bold ring-1",
                  name === "拠点外"
                    ? "bg-amber-50 text-amber-700 ring-amber-200"
                    : "bg-green-50 text-green-700 ring-green-200",
                ].join(" ")}
              >
                {name}: {count} 件
              </li>
            ))}
          </ul>
        )}
      </section>

      <ul className="mt-3 space-y-2">
        {today.map((h) => {
          const expanded = expandedId === h.id;
          return (
            <li key={h.id}>
              <button
                type="button"
                onClick={() =>
                  setExpandedId((prev) => (prev === h.id ? null : h.id))
                }
                className="flex w-full items-start gap-3 rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-slate-200 shadow-sm transition active:bg-slate-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {h.depot ? (
                      <>
                        <span
                          className={[
                            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ring-1",
                            h.depot.kind === "shipper"
                              ? "bg-purple-100 text-purple-800 ring-purple-200"
                              : h.depot.kind === "branch"
                                ? "bg-blue-100 text-blue-800 ring-blue-200"
                                : "bg-amber-100 text-amber-800 ring-amber-200",
                          ].join(" ")}
                        >
                          {DEPOT_KIND_LABEL[h.depot.kind]}
                        </span>
                        <span className="shrink-0 truncate text-[13px] font-bold text-slate-800">
                          📍 {h.depot.name}
                        </span>
                      </>
                    ) : (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 bg-amber-100 text-amber-800 ring-amber-300">
                        拠点外
                      </span>
                    )}
                    <span className="ml-auto text-[15px] font-bold text-slate-900 tabular-nums">
                      {h.count} 件
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-500 tabular-nums">
                    送信 {formatTime(h.at)}
                  </p>
                </div>
                <span
                  className={[
                    "shrink-0 text-xl transition-transform text-slate-400",
                    expanded ? "rotate-90" : "",
                  ].join(" ")}
                >
                  ›
                </span>
              </button>
              {expanded && (
                <div className="mt-1 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                  {h.position && (
                    <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                      位置: {h.position.lat.toFixed(6)},{" "}
                      {h.position.lng.toFixed(6)} (±
                      {Math.round(h.position.accuracy)}m)
                    </div>
                  )}
                  <ul className="max-h-56 overflow-y-auto">
                    {h.items.map((item) => {
                      const parsed = parseDims(item.dims);
                      return (
                        <li
                          key={item.text}
                          className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0"
                        >
                          <span className="shrink-0 text-green-600">✓</span>
                          <span className="flex-1 break-all font-mono text-[12px] text-slate-700">
                            {item.text}
                          </span>
                          {parsed ? (
                            <span className="shrink-0 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 ring-1 ring-blue-200 tabular-nums">
                              {parsed.sizeCode} ({parsed.l}×{parsed.w}×
                              {parsed.h})
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                              採寸なし
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SubmittedModal({
  count,
  items,
  at,
  position,
  positionError,
  depot,
  onDismiss,
}: {
  count: number;
  items: ConfirmedItem[];
  at: number;
  position: {
    lat: number;
    lng: number;
    accuracy: number;
    at: number;
  } | null;
  positionError: string | null;
  depot: Depot | null;
  onDismiss: () => void;
}) {
  const measuredCount = items.filter((i) => parseDims(i.dims)).length;
  const time = formatTime(at);
  const mapUrl = position
    ? `https://www.google.com/maps?q=${position.lat},${position.lng}`
    : null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/55 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex flex-col items-center gap-2 px-5 pt-8 pb-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8"
              aria-hidden
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <h2 className="text-[20px] font-bold text-slate-900">送信されました</h2>
          <p className="text-[13px] text-slate-500">
            出庫検品の結果をサーバーへ送信しました
          </p>
        </div>

        <div className="mx-5 mb-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <dl className="grid grid-cols-2 gap-y-2 text-[14px]">
            <dt className="text-slate-500">送信件数</dt>
            <dd className="text-right font-bold tabular-nums text-slate-900">
              {count} 件
            </dd>
            <dt className="text-slate-500">送信時刻</dt>
            <dd className="text-right font-bold tabular-nums text-slate-900">
              {time}
            </dd>
            <dt className="text-slate-500">担当 / 車番</dt>
            <dd className="text-right font-bold text-slate-900">
              山田 / #4
            </dd>
            <dt className="text-slate-500">採寸入力</dt>
            <dd className="text-right font-bold tabular-nums text-slate-900">
              {measuredCount}/{count} 件
            </dd>
          </dl>
        </div>

        <div className="mx-5 mb-4 overflow-hidden rounded-2xl ring-1 ring-slate-200">
          <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <span aria-hidden>📍</span>送信元拠点
          </div>
          {position ? (
            <div className="bg-white px-3 py-2.5">
              {depot ? (
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ring-1",
                      depot.kind === "shipper"
                        ? "bg-purple-100 text-purple-800 ring-purple-200"
                        : depot.kind === "branch"
                          ? "bg-blue-100 text-blue-800 ring-blue-200"
                          : "bg-amber-100 text-amber-800 ring-amber-200",
                    ].join(" ")}
                  >
                    {DEPOT_KIND_LABEL[depot.kind]}
                  </span>
                  <p className="text-[15px] font-bold text-green-700">
                    {depot.name}
                  </p>
                </div>
              ) : (
                <p className="text-[14px] font-bold text-amber-700">
                  拠点外（未登録の場所）
                </p>
              )}
              {depot?.address && (
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {depot.address}
                </p>
              )}
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                {position.lat.toFixed(6)}, {position.lng.toFixed(6)} ・ ±{Math.round(position.accuracy)}m ・ {formatTime(position.at)}
              </p>
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block rounded-md bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100"
                >
                  地図で開く →
                </a>
              )}
            </div>
          ) : (
            <div className="bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
              ⚠ {positionError ?? "位置情報を取得できませんでした"}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="mx-5 mb-4 overflow-hidden rounded-xl ring-1 ring-slate-200">
            <div className="bg-slate-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              送信したコード
            </div>
            <ul className="max-h-48 overflow-y-auto bg-white">
              {items.map((item) => {
                const parsed = parseDims(item.dims);
                return (
                  <li
                    key={item.text}
                    className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0"
                  >
                    <span className="shrink-0 text-green-600">✓</span>
                    <span className="flex-1 break-all font-mono text-[12px] text-slate-700">
                      {item.text}
                    </span>
                    {parsed ? (
                      <span className="shrink-0 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800 ring-1 ring-blue-200 tabular-nums">
                        {parsed.sizeCode} ({parsed.l}×{parsed.w}×{parsed.h})
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                        採寸なし
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-500"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
