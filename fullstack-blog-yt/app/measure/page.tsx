import Link from "next/link";
import MeasureXR from "./MeasureXR";

export const metadata = {
  title: "AR 3辺計測(β)",
};

export default function MeasurePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-white text-slate-900">
      <div className="mx-auto max-w-3xl px-5 pb-10 pt-6">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            ← トップ
          </Link>
          <span className="rounded-full bg-blue-600/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-700">
            β · WebXR
          </span>
        </div>

        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          AR で <span className="text-blue-600">3辺を測る</span>
        </h1>
        <p className="mt-2 text-[15px] text-slate-600">
          2点をタップで1辺。W → D → H で才数まで自動計算します。
        </p>

        <div className="mt-6">
          <MeasureXR />
        </div>

        <ol className="mt-6 grid grid-cols-3 gap-3 text-center">
          {[
            { n: 1, t: "AR を開始" },
            { n: 2, t: "両端をMark" },
            { n: 3, t: "次の辺へ" },
          ].map((s) => (
            <li
              key={s.n}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-4 shadow-sm"
            >
              <div className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                {s.n}
              </div>
              <div className="text-[13px] font-semibold text-slate-800">
                {s.t}
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-5 text-center text-[12px] text-slate-500">
          Android Chrome 専用 · 誤差±数cm のため入力補助用途
        </p>
      </div>
    </main>
  );
}
