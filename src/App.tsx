
import { useEffect, useState } from "react";
import LoginPage from "@/components/LoginPage";
import BlankPage from "@/components/BlankPage";
import { erpLogin } from "@/lib/erpService";
import { resumeErpSession, setErpCsrf, setErpSid, setErpMobileToken } from "@/lib/erpApi";
import type { Employee } from "@/types";

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

const initialEmployee = loadStoredEmployee();

const App = () => {
  const [employee, setEmployee] = useState<Employee | undefined>(() => initialEmployee);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(() => Boolean(initialEmployee));

  useEffect(() => {
    let cancelled = false;

    if (!initialEmployee) {
      setIsRestoringSession(false);
      return () => {
        cancelled = true;
      };
    }

    setIsRestoringSession(true);
    void (async () => {
      const ok = await resumeErpSession();
      if (cancelled) return;

      if (!ok) {
        setErpSid(undefined);
        setErpCsrf(undefined);
        setErpMobileToken(undefined);
        setEmployee(undefined);
        saveStoredEmployee(undefined);
        setError("Session expired. Sign in again.");
      }

      setIsRestoringSession(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
    setErpSid(undefined);
    setErpCsrf(undefined);
    setErpMobileToken(undefined);
    setEmployee(undefined);
    saveStoredEmployee(undefined);
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
    return <BlankPage employee={employee} onLogout={handleLogout} />;
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
