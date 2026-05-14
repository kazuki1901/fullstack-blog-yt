import MultiQrScanner from "./MultiQrScanner";

export const metadata = {
  title: "出庫検品",
};

export default function QrMultiPage() {
  return (
    <main className="min-h-screen bg-[#091428] text-zinc-100">
      <MultiQrScanner />
    </main>
  );
}
