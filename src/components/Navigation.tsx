import React from "react";
import { Employee, ViewType } from "@/types";
import { Home, Clock, User, Users, Settings, QrCode } from "lucide-react";
import appLogo from "@/assets/app-logo-transparent.png";

interface NavigationProps {
  employee: Employee;
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  onScanClick: () => void;
}

const Navigation: React.FC<NavigationProps> = ({
  employee,
  currentView,
  onNavigate,
  onScanClick,
}) => {
  const [hideBottomNav, setHideBottomNav] = React.useState(false);
  const [spinningTab, setSpinningTab] = React.useState<string | null>(null);

  const navItems = [
    { id: "dashboard" as ViewType, label: "Dashboard", icon: Home },
    { id: "scan" as ViewType, label: "QR", icon: QrCode },
    { id: "history" as ViewType, label: "History", icon: Clock },
    { id: "profile" as ViewType, label: "Profile", icon: User },
    { id: "settings" as ViewType, label: "Settings", icon: Settings },
    ...(employee.role === "admin" ? [{ id: "admin" as ViewType, label: "Admin", icon: Users }] : []),
  ];

  const bottomNavItems = [
    { id: "dashboard" as ViewType, label: "Home", icon: Home },
    { id: "history" as ViewType, label: "History", icon: Clock },
    { id: "scan" as ViewType, label: "QR", icon: QrCode },
    { id: "profile" as ViewType, label: "Profile", icon: User },
    { id: "settings" as ViewType, label: "Settings", icon: Settings },
  ];

  const initials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  React.useEffect(() => {
    let lastY = typeof window !== "undefined" ? window.scrollY : 0;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const delta = currentY - lastY;
        if (Math.abs(delta) > 6) {
          if (delta > 0 && currentY > 80) setHideBottomNav(true);
          if (delta < 0) setHideBottomNav(false);
        }
        lastY = currentY;
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

        .bottom-nav {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          height: calc(64px + env(safe-area-inset-bottom));
          background: hsl(var(--background) / 0.95);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-top: 1px solid hsl(var(--border));
          display: none;
          align-items: center;
          justify-content: center;
          padding-bottom: env(safe-area-inset-bottom);
          z-index: 55;
          transition: transform 0.25s ease, opacity 0.25s ease;
        }
        @media (max-width: 767px) { .bottom-nav { display: grid; } }
        .bottom-nav.hidden {
          transform: translateY(110%);
          opacity: 0;
        }

        .bottom-nav-item {
          flex: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          background: none;
          border: none;
          color: hsl(var(--muted-foreground));
          font-family: 'Sora', sans-serif;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
        }
        .bottom-nav-item-center {
          position: relative;
          transform: translateY(-10px);
        }
        .bottom-nav-center-btn {
          width: 48px;
          height: 48px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8));
          color: white;
          box-shadow: 0 8px 16px -10px hsl(var(--primary));
          overflow: hidden;
        }
        .bottom-nav-click {
          position: relative;
        }
        .bottom-nav-click::after {
          content: "";
          position: absolute;
          inset: -6px;
          border-radius: 999px;
          border: 2px solid rgba(255,255,255,0.7);
          opacity: 0;
          transform: scale(0.6);
        }
        .bottom-nav-click-active::after {
          animation: bottomNavClickSplash 0.5s ease;
        }
        @keyframes bottomNavClickSplash {
          0% { opacity: 0; transform: scale(0.6); }
          40% { opacity: 0.9; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.3); }
        }
        .bottom-nav-item-center .bottom-nav-label {
          margin-top: 6px;
        }
        .bottom-nav-label {
          font-size: 10px;
          font-weight: 600;
        }
        .bottom-nav-item-active { color: hsl(var(--primary)); }
        .bottom-nav-dot {
          width: 4px; height: 4px; border-radius: 999px; margin-top: 2px;
          background: hsl(var(--primary));
        }
        .bottom-nav-anim {
          display: inline-flex;
          position: relative;
        }
        .bottom-nav-spin {
          animation: bottomNavSpin 0.7s ease;
        }
        @keyframes bottomNavSpin {
          to { transform: rotate(360deg); }
        }
        .bottom-nav-bounce {
          animation: bottomNavBounce 0.35s ease;
        }
        @keyframes bottomNavBounce {
          0% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-3px) scale(1.05); }
          100% { transform: translateY(0) scale(1); }
        }
        .bottom-nav-door {
          animation: bottomNavDoor 0.45s ease;
          transform-origin: left center;
        }
        @keyframes bottomNavDoor {
          0% { transform: perspective(40px) rotateY(0deg); }
          50% { transform: perspective(40px) rotateY(-22deg) translateX(-1px); }
          100% { transform: perspective(40px) rotateY(0deg); }
        }
        .bottom-nav-clock {
          animation: bottomNavClock 0.5s ease;
          transform-origin: center center;
        }
        @keyframes bottomNavClock {
          0% { transform: rotate(0deg); }
          60% { transform: rotate(35deg); }
          100% { transform: rotate(0deg); }
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
                onClick={() => {
                  if (id === "scan") {
                    onScanClick();
                    return;
                  }
                  onNavigate(id);
                }}
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

      <div
        className={`bottom-nav${hideBottomNav ? " hidden" : ""}`}
        style={{ gridTemplateColumns: `repeat(${bottomNavItems.length}, 1fr)` }}
      >
        {bottomNavItems.map(({ id, label, icon: Icon }) => {
          const active = currentView === id;
          return (
            <button
              key={id}
              className={`bottom-nav-item${active ? " bottom-nav-item-active" : ""}${
                id === "scan" ? " bottom-nav-item-center" : ""
              }`}
              onClick={() => {
                const duration = id === "settings" ? 700 : 450;
                setSpinningTab(id);
                setTimeout(() => setSpinningTab(null), duration);
                if (id === "scan") {
                  onScanClick();
                  return;
                }
                onNavigate(id);
              }}
            >
              {id === "scan" ? (
                <>
                  <span className="bottom-nav-center-btn">
                    <span
                      className={`bottom-nav-click${
                        spinningTab === id ? " bottom-nav-click-active" : ""
                      }`}
                    >
                      <Icon size={20} />
                    </span>
                  </span>
                  <span className="bottom-nav-label">{label}</span>
                </>
              ) : (
                <>
                  <span
                    className={[
                      "bottom-nav-anim",
                      spinningTab === id
                        ? id === "settings"
                          ? "bottom-nav-spin"
                          : id === "dashboard"
                            ? "bottom-nav-door"
                            : id === "history"
                              ? "bottom-nav-clock"
                              : "bottom-nav-bounce"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="bottom-nav-label">{label}</span>
                </>
              )}
              {active && <span className="bottom-nav-dot" />}
            </button>
          );
        })}
      </div>
    </>
  );
};

export default Navigation;
