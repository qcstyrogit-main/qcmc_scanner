import React from "react";
import { ArrowLeft, Construction, Wrench } from "lucide-react";

export type StatusPageVariant = "coming-soon" | "maintenance";

interface StatusPageProps {
  variant: StatusPageVariant;
  title: string;
  description?: string;
  onBack: () => void;
}

const StatusPage: React.FC<StatusPageProps> = ({ variant, title, description, onBack }) => {
  const isMaintenance = variant === "maintenance";
  const heading = isMaintenance ? "Under Maintenance" : "Coming Soon";
  const fallback = isMaintenance
    ? "This feature is temporarily unavailable while maintenance is in progress."
    : "This feature is being prepared and will be available in a future update.";

  return (
    <section className="status-page" aria-labelledby="status-page-title">
      <div className="status-page-card">
        <div className={`status-page-icon is-${variant}`} aria-hidden="true">
          {isMaintenance ? <Wrench size={31} /> : <Construction size={31} />}
        </div>
        <div className="status-page-eyebrow">{title}</div>
        <h1 id="status-page-title">{heading}</h1>
        <p>{description || fallback}</p>
        <button type="button" className="status-page-back" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
          Back to Inventory
        </button>
      </div>
    </section>
  );
};

export default StatusPage;
