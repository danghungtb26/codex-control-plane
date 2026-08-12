import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [];
let stopping = false;

const start = (args: string[], label: string) => {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    if (stopping) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    console.error(`[dev] ${label} exited with ${reason}`);
    shutdown(code ?? 1);
  });

  return child;
};

const shutdown = (exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 100).unref();
};

start(["run", "vite", "build", "--config", "dashboard/vite.config.ts", "--watch"], "dashboard build watcher");
start(["--watch", "src/server.ts"], "control plane");

console.log("[dev] single-port mode: http://127.0.0.1:${PORT:-8788}/");
console.log("[dev] Vite rebuilds dashboard/dist automatically; refresh the browser after UI edits.");

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
