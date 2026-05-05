import BottomNav from "@/components/BottomNav";
import SessionSync from "@/components/SessionSync";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-20">
      <SessionSync />
      {children}
      <BottomNav />
    </div>
  );
}
