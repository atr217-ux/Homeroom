import BottomNav from "@/components/BottomNav";
import DailyRecap from "@/components/DailyRecap";
import SessionSync from "@/components/SessionSync";
import { ThemeProvider } from "@/lib/theme";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div
        className="min-h-screen pb-24"
        style={{ background: "var(--bg)", color: "var(--text)" }}
      >
        <SessionSync />
        {children}
        <BottomNav />
        <DailyRecap />
      </div>
    </ThemeProvider>
  );
}
