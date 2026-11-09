
import { useCallback, useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import LoginPage from "@/components/LoginPage";
import BlankPage from "@/components/BlankPage";
import ScannerErrorBoundary from "@/components/ScannerErrorBoundary";
import { erpLogin } from "@/lib/erpService";
import { isTerminalErpSessionStatus, resumeErpSession, setErpCsrf, setErpSid, setErpMobileToken } from "@/lib/erpApi";
import type { Employee } from "@/types";
import { clearStorageLocationCache } from "@/lib/storageLocationService";
import { applyScannerTextSize, loadScannerTextSize } from "@/lib/scannerPreferences";

const EMPLOYEE_STORAGE_KEY = "employee";

const loadStoredEmployee = (): Employee | undefined => {
  try {
    const raw = localStorage.getItem(EMPLOYEE_STORAGE_KEY);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    if (!parsed.id || !parsed.email) return undefined;

    return parsed as Employee;
  } catch {
    localStorage.removeItem(EMPLOYEE_STORAGE_KEY);
    return undefined;
  }
};

const saveStoredEmployee = (employee?: Employee) => {
  try {
    if (employee) {
      localStorage.setItem(EMPLOYEE_STORAGE_KEY, JSON.stringify(employee));
    } else {
      localStorage.removeItem(EMPLOYEE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
};

const storedEmployee = loadStoredEmployee();
const initialEmployee = storedEmployee;
applyScannerTextSize(loadScannerTextSize());

const App = () => {
  const [employee, setEmployee] = useState<Employee | undefined>(() => initialEmployee);
  const [error, setError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(() => Boolean(initialEmployee));
  const restoreInFlightRef = useRef(false);

  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", preventContextMenu);
    return () => document.removeEventListener("contextmenu", preventContextMenu);
  }, []);

  const clearStoredSession = useCallback((message?: string) => {
    clearStorageLocationCache();
    setErpSid(undefined);
    setErpCsrf(undefined);
    setErpMobileToken(undefined);
    setEmployee(undefined);
    saveStoredEmployee(undefined);
    setError(message);
  }, []);

  const restoreSession = useCallback(
    async (options?: { showLoading?: boolean; expiredMessage?: string }) => {
      if (!employee || restoreInFlightRef.current) {
        return employee != null;
      }

      restoreInFlightRef.current = true;
      if (options?.showLoading) {
        setIsRestoringSession(true);
      }

      try {
        const status = await resumeErpSession();
        if (isTerminalErpSessionStatus(status)) {
          clearStoredSession(options?.expiredMessage || "Your device login is no longer valid. Sign in again to continue. Your saved work is safe.");
          return false;
        }
        // An ERP outage must not erase the locally authenticated operator or
        // their saved Physical Count. Online validation resumes when connected.
        return true;
      } finally {
        restoreInFlightRef.current = false;
        if (options?.showLoading) {
          setIsRestoringSession(false);
        }
      }
    },
    [clearStoredSession, employee]
  );

  useEffect(() => {
    if (!initialEmployee) {
      setIsRestoringSession(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const ok = await restoreSession({
        showLoading: true,
        expiredMessage: "Your login has expired. Sign in again to continue. Your saved work is safe.",
      });
      if (cancelled || ok) {
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [restoreSession]);

  useEffect(() => {
    if (!employee) {
      return;
    }

    if (Capacitor.isNativePlatform()) {
      const listenerPromise = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          void restoreSession({
            showLoading: false,
            expiredMessage: "Your login has expired. Sign in again to continue. Your saved work is safe.",
          });
        }
      });

      return () => {
        void listenerPromise.then((listener) => listener.remove());
      };
    }

    const handleFocus = () => {
      void restoreSession({
        showLoading: false,
        expiredMessage: "Your login has expired. Sign in again to continue. Your saved work is safe.",
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void restoreSession({
          showLoading: false,
          expiredMessage: "Your login has expired. Sign in again to continue. Your saved work is safe.",
        });
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [employee, restoreSession]);

  // Android Back may exit only at the actual unauthenticated Login screen.
  // During session restoration the Login UI is temporary; do not exit while
  // a previously authenticated operator's saved session is being restored.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || employee || isRestoringSession) return;

    let cancelled = false;
    let listener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null;
    void CapacitorApp.addListener("backButton", () => {
      void CapacitorApp.exitApp();
    }).then((handle) => {
      if (cancelled) {
        void handle.remove();
      } else {
        listener = handle;
      }
    });
    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [employee, isRestoringSession]);

  const handleLogin = async (email: string, password: string) => {
    if (isRestoringSession) {
      return;
    }

    setIsLoading(true);
    setError(undefined);

    try {
      const loggedInEmployee = await erpLogin(email, password);
      setEmployee(loggedInEmployee);
      saveStoredEmployee(loggedInEmployee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    clearStoredSession(undefined);
  };

  if (isRestoringSession) {
    return (
      <LoginPage
        onLogin={handleLogin}
        isLoading
        offlineMessage="Restoring saved session..."
      />
    );
  }

  if (employee && !isRestoringSession) {
    return <ScannerErrorBoundary><BlankPage employee={employee} onLogout={handleLogout} /></ScannerErrorBoundary>;
  }

  return (
    <LoginPage
      onLogin={handleLogin}
      isLoading={isLoading}
      error={error}
    />
  );
};

export default App;
