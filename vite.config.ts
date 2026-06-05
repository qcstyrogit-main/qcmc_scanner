import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const erpTarget = env.VITE_ERP_TARGET || "https://erp.qcstyro.com";

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/erp": {
          target: erpTarget,
          changeOrigin: true,
          secure: erpTarget.startsWith("https"),
          rewrite: (requestPath) => requestPath.replace(/^\/erp/, ""),
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
