import ShipmentInspection from "./ShipmentInspection";

export const metadata = {
  title: "出庫検品スキャン / 金沢営業所",
};

export default function ShipmentPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <ShipmentInspection />
    </main>
  );
}
