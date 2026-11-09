import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export default class ScannerErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[QCMC Scanner] UI render failure", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main role="alert" style={{ minHeight: "100dvh", padding: 24, background: "#fff", color: "#14213d", fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Scanner screen could not load</h1>
        <p style={{ margin: 0 }}>Your locally saved scans have not been cleared. Please record the error below before restarting.</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 12, background: "#f3f4f6", borderRadius: 8, fontSize: 12 }}>{this.state.error.message}</pre>
        <button type="button" style={{ padding: 14, border: 0, borderRadius: 8, background: "#14213d", color: "#fff", fontSize: 16 }} onClick={() => this.setState({ error: null })}>Try again</button>
        <button type="button" style={{ padding: 14, border: "1px solid #14213d", borderRadius: 8, background: "#fff", color: "#14213d", fontSize: 16 }} onClick={() => window.location.reload()}>Reload scanner</button>
      </main>
    );
  }
}
