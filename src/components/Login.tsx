import { useState } from "react";

export default function Login({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      location.href = next || "/editor/";
    } else {
      setError("密码错误 / wrong password");
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: "4rem auto" }}>
      <h1 style={{ fontSize: "1.3rem" }}>Sign in</h1>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password"
        autoFocus
        style={{
          display: "block",
          width: "100%",
          font: "inherit",
          padding: "0.5rem 0.7rem",
          border: "1px solid var(--border)",
          borderRadius: 6,
          marginBottom: "0.7rem",
        }}
      />
      {error && <p style={{ color: "var(--danger)", fontSize: "0.9rem" }}>{error}</p>}
      <button disabled={busy} style={{ font: "inherit" }}>
        {busy ? "…" : "Sign in"}
      </button>
    </form>
  );
}
