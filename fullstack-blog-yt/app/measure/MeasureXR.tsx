"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import {
  XR,
  XRDomOverlay,
  IfInSessionMode,
  createXRStore,
  useXRHitTest,
  useXRSessionModeSupported,
} from "@react-three/xr";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Group, Matrix4, Vector3 } from "three";

const store = createXRStore({
  hand: false,
  controller: false,
  hitTest: true,
  domOverlay: true,
  // WebXR 非対応端末でも IWER (Quest3 エミュレータ) を出さない。
  // 実機 Android 用の AR アプリなので、PC では「非対応」表示で OK。
  emulate: false,
});

type DimKey = "W" | "D" | "H";
const DIM_ORDER: DimKey[] = ["W", "D", "H"];
const DIM_LABEL: Record<DimKey, string> = {
  W: "幅 (W)",
  D: "奥行 (D)",
  H: "高さ (H)",
};
const DIM_COLOR: Record<DimKey, string> = {
  W: "#22d3ee",
  D: "#a3e635",
  H: "#f472b6",
};

type Segment = { a: Vector3; b: Vector3; dim: DimKey };

const tmpMatrix = new Matrix4();

function Reticle({
  hitPosRef,
  hitValidRef,
}: {
  hitPosRef: React.MutableRefObject<Vector3>;
  hitValidRef: React.MutableRefObject<boolean>;
}) {
  const ref = useRef<Group>(null);

  useXRHitTest((results, getWorldMatrix) => {
    if (results.length === 0) {
      hitValidRef.current = false;
      return;
    }
    getWorldMatrix(tmpMatrix, results[0]);
    hitPosRef.current.setFromMatrixPosition(tmpMatrix);
    hitValidRef.current = true;
  }, "viewer");

  useFrame(() => {
    if (!ref.current) return;
    if (hitValidRef.current) {
      ref.current.position.copy(hitPosRef.current);
      ref.current.visible = true;
    } else {
      ref.current.visible = false;
    }
  });

  return (
    <group ref={ref}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.05, 0.07, 32]} />
        <meshBasicMaterial color="#22d3ee" toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.008, 12, 12]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}

function PointMarker({ p, color }: { p: Vector3; color: string }) {
  return (
    <mesh position={p}>
      <sphereGeometry args={[0.012, 16, 16]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function PendingPreview({
  pendingA,
  hitPosRef,
  hitValidRef,
  color,
}: {
  pendingA: Vector3;
  hitPosRef: React.MutableRefObject<Vector3>;
  hitValidRef: React.MutableRefObject<boolean>;
  color: string;
}) {
  const ref = useRef<Group>(null);
  const [pts, setPts] = useState<[Vector3, Vector3]>([
    pendingA.clone(),
    pendingA.clone(),
  ]);

  useFrame(() => {
    if (!hitValidRef.current) return;
    setPts([pendingA, hitPosRef.current.clone()]);
  });

  return (
    <group ref={ref}>
      <Line
        points={pts as unknown as Vector3[]}
        color={color}
        lineWidth={3}
        dashed
        dashSize={0.02}
        gapSize={0.02}
      />
    </group>
  );
}

function SceneContent({
  hitPosRef,
  hitValidRef,
  segments,
  pendingA,
  currentDim,
}: {
  hitPosRef: React.MutableRefObject<Vector3>;
  hitValidRef: React.MutableRefObject<boolean>;
  segments: Segment[];
  pendingA: Vector3 | null;
  currentDim: DimKey | null;
}) {
  return (
    <>
      <Reticle hitPosRef={hitPosRef} hitValidRef={hitValidRef} />

      {segments.map((s, i) => (
        <group key={i}>
          <PointMarker p={s.a} color={DIM_COLOR[s.dim]} />
          <PointMarker p={s.b} color={DIM_COLOR[s.dim]} />
          <Line
            points={[s.a, s.b]}
            color={DIM_COLOR[s.dim]}
            lineWidth={4}
          />
        </group>
      ))}

      {pendingA && currentDim && (
        <>
          <PointMarker p={pendingA} color={DIM_COLOR[currentDim]} />
          <PendingPreview
            pendingA={pendingA}
            hitPosRef={hitPosRef}
            hitValidRef={hitValidRef}
            color={DIM_COLOR[currentDim]}
          />
        </>
      )}
    </>
  );
}

function distanceCm(a: Vector3, b: Vector3): number {
  return a.distanceTo(b) * 100;
}

// 才数(国内便): (W+D+H) cm を 1才 = 27cm として割る簡易計算ではなく、
// 一般的な「W×D×H ÷ 27³」(cm³ ÷ 19683) を使う。容積重量は 1才 = 8kg 換算。
function calcSai(wCm: number, dCm: number, hCm: number): number {
  return (wCm * dCm * hCm) / (27 * 27 * 27);
}

const noopSubscribe = () => () => {};
const useIsClient = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

export default function MeasureXR() {
  const isClient = useIsClient();
  if (!isClient) {
    return (
      <div className="h-[62vh] w-full animate-pulse rounded-3xl bg-slate-100" />
    );
  }
  return <MeasureXRInner />;
}

function MeasureXRInner() {
  const hitPosRef = useRef<Vector3>(new Vector3());
  const hitValidRef = useRef<boolean>(false);

  const [segments, setSegments] = useState<Segment[]>([]);
  const [pendingA, setPendingA] = useState<Vector3 | null>(null);
  const [currentDimIdx, setCurrentDimIdx] = useState(0);
  const [livePreviewCm, setLivePreviewCm] = useState<number | null>(null);
  const [inSession, setInSession] = useState(false);

  const arSupported = useXRSessionModeSupported("immersive-ar");

  // ライブ距離プレビュー(pendingA がある時、reticle までの距離を ~10Hz で更新)
  useEffect(() => {
    if (!pendingA) return;
    const id = window.setInterval(() => {
      if (hitValidRef.current) {
        setLivePreviewCm(distanceCm(pendingA, hitPosRef.current));
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [pendingA]);

  useEffect(() => {
    return store.subscribe((state) => {
      setInSession(state.session != null);
    });
  }, []);

  const currentDim: DimKey | null =
    currentDimIdx < DIM_ORDER.length ? DIM_ORDER[currentDimIdx] : null;

  const handleMark = useCallback(() => {
    if (!hitValidRef.current || !currentDim) return;
    const p = hitPosRef.current.clone();
    if (!pendingA) {
      setPendingA(p);
    } else {
      setSegments((prev) => [...prev, { a: pendingA, b: p, dim: currentDim }]);
      setPendingA(null);
      setLivePreviewCm(null);
      setCurrentDimIdx((i) => i + 1);
    }
  }, [currentDim, pendingA]);

  const handleSkipPoint = useCallback(() => {
    // 1点目を打った後にやり直したい時用
    setPendingA(null);
    setLivePreviewCm(null);
  }, []);

  const handleReset = useCallback(() => {
    setSegments([]);
    setPendingA(null);
    setLivePreviewCm(null);
    setCurrentDimIdx(0);
  }, []);

  const measurements = useMemo(() => {
    const m: Partial<Record<DimKey, number>> = {};
    for (const s of segments) {
      m[s.dim] = distanceCm(s.a, s.b);
    }
    return m;
  }, [segments]);

  const allDone =
    measurements.W != null && measurements.D != null && measurements.H != null;
  const sai = allDone
    ? calcSai(measurements.W!, measurements.D!, measurements.H!)
    : null;

  const arDisabled = arSupported === false;
  const arChecking = arSupported === undefined;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 shadow-xl ring-1 ring-black/5">
      {/* AR canvas — 常に下層 */}
      <div className="h-[62vh] w-full">
        <Canvas camera={{ position: [0, 1.5, 1.5], fov: 60 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 4, 2]} intensity={0.8} />

          <XR store={store}>
            <IfInSessionMode allow="immersive-ar">
              <SceneContent
                hitPosRef={hitPosRef}
                hitValidRef={hitValidRef}
                segments={segments}
                pendingA={pendingA}
                currentDim={currentDim}
              />

              <XRDomOverlay>
                <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 text-white">
                  {/* 上段:現在の計測対象 */}
                  <div className="pointer-events-auto self-start rounded-2xl bg-black/55 px-4 py-2 text-sm backdrop-blur">
                    {currentDim ? (
                      <>
                        <div className="text-[11px] uppercase tracking-wider opacity-70">
                          計測中
                        </div>
                        <div className="font-bold">
                          {DIM_LABEL[currentDim]}
                          {pendingA && livePreviewCm != null && (
                            <span className="ml-2 font-mono text-base">
                              {livePreviewCm.toFixed(1)} cm
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="font-bold">3辺 完了</div>
                    )}
                  </div>

                  {/* 中段: 計測結果カード */}
                  <div className="pointer-events-auto mx-auto w-full max-w-sm rounded-2xl bg-black/55 p-3 text-sm backdrop-blur">
                    <div className="grid grid-cols-3 gap-2">
                      {DIM_ORDER.map((d) => (
                        <div
                          key={d}
                          className="rounded-xl bg-white/5 px-2 py-1.5 text-center"
                        >
                          <div
                            className="text-[10px] font-bold uppercase tracking-wider"
                            style={{ color: DIM_COLOR[d] }}
                          >
                            {d}
                          </div>
                          <div className="font-mono text-base tabular-nums">
                            {measurements[d] != null
                              ? measurements[d]!.toFixed(0)
                              : "—"}
                          </div>
                          <div className="text-[10px] opacity-60">cm</div>
                        </div>
                      ))}
                    </div>
                    {sai != null && (
                      <div className="mt-2 flex items-center justify-between border-t border-white/15 pt-2">
                        <span className="text-xs opacity-70">才数 概算</span>
                        <span className="font-mono text-lg font-bold tabular-nums">
                          {sai.toFixed(2)} 才
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 下段: ボタン */}
                  <div className="pointer-events-auto flex items-center gap-2">
                    <button
                      onClick={handleMark}
                      disabled={!currentDim}
                      className="flex-1 rounded-2xl bg-blue-600 px-4 py-4 text-base font-bold text-white shadow-lg shadow-blue-900/40 active:scale-[0.98] disabled:bg-slate-500"
                    >
                      {pendingA ? "Mark · 2点目" : "Mark · 1点目"}
                    </button>
                    {pendingA && (
                      <button
                        onClick={handleSkipPoint}
                        className="rounded-2xl bg-white/15 px-3 py-4 text-xs font-semibold text-white backdrop-blur"
                      >
                        やり直し
                      </button>
                    )}
                    <button
                      onClick={handleReset}
                      className="rounded-2xl bg-white/15 px-3 py-4 text-xs font-semibold text-white backdrop-blur"
                    >
                      Reset
                    </button>
                    <button
                      onClick={() => store.getState().session?.end()}
                      className="rounded-2xl bg-white/90 px-3 py-4 text-xs font-bold text-slate-900"
                    >
                      終了
                    </button>
                  </div>
                </div>
              </XRDomOverlay>
            </IfInSessionMode>

            {/* AR 外:控えめなプレビューシーン */}
            <IfInSessionMode deny="immersive-ar">
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
                <planeGeometry args={[3, 3]} />
                <meshStandardMaterial color="#0f172a" />
              </mesh>
            </IfInSessionMode>
          </XR>
        </Canvas>
      </div>

      {/* AR 起動 CTA(セッション外でのみオーバーレイ表示) */}
      {!inSession && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-slate-950/40 via-slate-950/30 to-slate-950/70 p-6 text-center backdrop-blur-[2px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-200/80">
            WebXR Hit Test
          </div>
          <button
            onClick={() => store.enterAR()}
            disabled={arDisabled || arChecking}
            className="group relative inline-flex w-full max-w-xs items-center justify-center rounded-2xl bg-white px-6 py-5 text-lg font-bold text-slate-900 shadow-2xl shadow-blue-900/40 transition active:scale-[0.98] disabled:bg-white/20 disabled:text-white/70"
          >
            <span className="absolute inset-0 -z-10 rounded-2xl bg-blue-500/40 blur-xl group-enabled:animate-pulse" />
            {arDisabled
              ? "AR 非対応端末"
              : arChecking
              ? "確認中..."
              : "AR を開始"}
          </button>
          <p className="max-w-xs text-[12px] leading-relaxed text-white/70">
            {arDisabled
              ? "Android Chrome (ARCore対応) で開いてください"
              : "対応端末ではカメラ越しに箱が見えます"}
          </p>

          {segments.length > 0 && (
            <div className="mt-4 w-full max-w-xs rounded-2xl bg-white/95 p-3 text-left text-sm text-slate-900 shadow-lg">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                直前の結果
              </div>
              <div className="grid grid-cols-3 gap-2">
                {DIM_ORDER.map((d) => (
                  <div key={d} className="text-center">
                    <div
                      className="text-[10px] font-bold uppercase"
                      style={{ color: DIM_COLOR[d] }}
                    >
                      {d}
                    </div>
                    <div className="font-mono text-base tabular-nums">
                      {measurements[d] != null
                        ? measurements[d]!.toFixed(0)
                        : "—"}
                    </div>
                  </div>
                ))}
              </div>
              {sai != null && (
                <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
                  <span className="text-xs text-slate-500">才数 概算</span>
                  <span className="font-mono text-base font-bold">
                    {sai.toFixed(2)} 才
                  </span>
                </div>
              )}
              <button
                onClick={handleReset}
                className="mt-2 w-full rounded-lg bg-slate-100 py-1 text-[11px] font-semibold text-slate-600"
              >
                クリア
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
