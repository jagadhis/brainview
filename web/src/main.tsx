import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ToastProvider } from "./lib/toast.tsx";
import { UiProvider } from "./lib/ui-state.tsx";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UiProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </UiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
