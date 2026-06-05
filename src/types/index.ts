export type Employee = {
  id: string;
  employee_id?: string;
  email: string;
  full_name: string;
  department: string;
  company: string;
  custom_location: string;
  designation: string;
  role: "admin" | "employee";
};
