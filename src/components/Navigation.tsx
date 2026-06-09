import React from "react";
import { Employee, ViewType } from "@/types";
import { Home, Clock, User, Users, Settings } from "lucide-react";
import appLogo from "@/assets/app-logo-transparent.png";

interface NavigationProps {
  employee: Employee;
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
}

const Navigation: React.FC<NavigationProps> = ({
  employee,
  currentView,
  onNavigate,
}) => {
  const navItems = [
    { id: "dashboard" as ViewType, label: "Dashboard", icon: Home },
    { id: "history" as ViewType, label: "History", icon: Clock },
    { id: "profile" as ViewType, label: "Profile", icon: User },
    { id: "settings" as ViewType, label: "Settings", icon: Settings },
    ...(employee.role === "admin" ? [{ id: "admin" as ViewType, label: "Admin", icon: Users }] : []),
  ];

  const initials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');

        .nav {
          font-family: 'Sora', sans-serif;
          background: hsl(var(--background) / 0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid hsl(var(--border));
          position: sticky; top: 0; z-index: 50;
        }
        @media (max-width: 767px) { .nav { display: none; } }
        .nav-inner {
          max-width: 960px; margin: 0 auto;
          padding: 0 20px;
          height: 60px;
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
        }
        @media (min-width: 640px)  { .nav-inner { padding: 0 28px; } }
        @media (min-width: 1024px) { .nav-inner { padding: 0 40px; } }

        .nav-logo { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .nav-logo-image {
          width: 40px;
          height: 40px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .nav-logo-name {
          font-size: 15px; font-weight: 700; color: hsl(var(--foreground));
          letter-spacing: -0.2px;
          display: none;
        }
        @media (min-width: 480px) { .nav-logo-name { display: block; } }

        .nav-items {
          display: none; align-items: center; gap: 2px;
        }
        @media (min-width: 768px) { .nav-items { display: flex; } }

        .nav-item {
          display: flex; align-items: center; gap: 7px;
          padding: 7px 13px; border-radius: 9px;
          font-size: 13px; font-weight: 500;
          color: hsl(var(--muted-foreground)); background: none; border: none;
          cursor: pointer; transition: color 0.15s, background 0.15s;
          font-family: 'Sora', sans-serif; white-space: nowrap;
        }
        .nav-item:hover { color: hsl(var(--foreground)); background: hsl(var(--foreground) / 0.05); }
        .nav-item-active {
          color: hsl(var(--primary)) !important;
          background: hsl(var(--primary) / 0.12) !important;
        }

        .nav-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

        .nav-user {
          display: none; align-items: center; gap: 10px;
        }
        @media (min-width: 640px) { .nav-user { display: flex; } }

        .nav-user-text { text-align: right; }
        .nav-user-name { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); line-height: 1.3; }
        .nav-user-dept { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .nav-avatar {
          width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
          background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8));
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: white;
          box-shadow: 0 0 0 2px hsl(var(--primary) / 0.2);
        }

      `}</style>

      <nav className="nav">
        <div className="nav-inner">
          <div className="nav-logo">
            <img src={appLogo} alt="GeoTime QCMC logo" className="nav-logo-image" />
            <span className="nav-logo-name">GeoTime QCMC</span>
          </div>

          <div className="nav-items">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item${currentView === id ? " nav-item-active" : ""}`}
                onClick={() => onNavigate(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          <div className="nav-right">
            <div className="nav-user">
              <div className="nav-user-text">
                <div className="nav-user-name">{employee.full_name}</div>
                <div className="nav-user-dept">{employee.department}</div>
              </div>
              <div className="nav-avatar">{initials(employee.full_name)}</div>
            </div>
          </div>
        </div>
      </nav>

    </>
  );
};

export default Navigation;
