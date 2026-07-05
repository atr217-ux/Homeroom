export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto px-4 pt-24 text-center">
      <h1
        className="font-display italic leading-none mb-2"
        style={{ color: "var(--text)", fontSize: "clamp(3rem, 12vw, 4.5rem)" }}
      >
        Home
      </h1>
      <p style={{ color: "var(--text-2)" }}>Coming in Phase 5</p>
    </div>
  );
}
