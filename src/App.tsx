
import { useState } from "react";
import LoginPage from "@/components/LoginPage";
import { erpLogin } from "@/lib/erpService";
import type { Employee } from "@/types";

const App = () => {
  const [employee, setEmployee] = useState<Employee>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (email: string, password: string) => {
    setIsLoading(true);
    setError(undefined);

    try {
      const loggedInEmployee = await erpLogin(email, password);
      setEmployee(loggedInEmployee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LoginPage
      onLogin={handleLogin}
      isLoading={isLoading}
      error={error}
      offlineMessage={
        employee
          ? `Signed in as ${employee.full_name}. App features have been removed.`
          : undefined
      }
    />
  );
};

export default App;
