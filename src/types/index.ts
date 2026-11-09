export type Employee = {
  id: string;
  employee_id?: string;
  email: string;
  full_name: string;
  department: string;
  company?: string;
  custom_location?: string;
  designation?: string;
  role: "admin" | "employee";
};

export type ViewType =
  | "dashboard"
  | "scan"
  | "job_card_time"
  | "location_transfer"
  | "history"
  | "profile"
  | "settings"
  | "admin"
  | "delivery"
  | "delivery_history"
  | "delivery_customers"
  | "issue_stock_coming_soon"
  | "delivery_coming_soon";
