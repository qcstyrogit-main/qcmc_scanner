
import { useState } from "react";
import LoginPage from "@/components/LoginPage";
import BlankPage from "@/components/BlankPage";
import { erpLogin } from "@/lib/erpService";
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

const App = () => {
  const [employee, setEmployee] = useState<Employee | undefined>(() => loadStoredEmployee());
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (email: string, password: string) => {
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
    setEmployee(undefined);
    saveStoredEmployee(undefined);
  };

  if (employee) {
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
