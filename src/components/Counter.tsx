import { useState } from "react";

export default function Counter({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start);
  return (
    <button
      onClick={() => setN(n + 1)}
      style={{
        font: "inherit",
        padding: "0.5rem 1.1rem",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--accent-soft)",
        cursor: "pointer",
      }}
    >
      clicked {n} times
    </button>
  );
}
