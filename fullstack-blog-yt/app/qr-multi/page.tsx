import MultiQrScanner from "./MultiQrScanner";

export const metadata = {
  title: "出庫検品",
};

export default function QrMultiPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <MultiQrScanner />
    </main>
  );
}
