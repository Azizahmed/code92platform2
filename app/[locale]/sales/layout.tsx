import SalesNav from '@/components/sales/SalesNav';

export default function SalesLayout({children}: {children: React.ReactNode}) {
  return (
    <div className="space-y-6">
      <SalesNav />
      {children}
    </div>
  );
}
