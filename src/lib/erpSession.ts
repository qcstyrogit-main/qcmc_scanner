const ERP_SID_KEY = "erp.sid";

export const getErpSid = () => sessionStorage.getItem(ERP_SID_KEY) || "";

export const setErpSid = (sid?: string | null) => {
  const cleaned = sid?.trim() || "";

  if (cleaned) {
    sessionStorage.setItem(ERP_SID_KEY, cleaned);
  } else {
    sessionStorage.removeItem(ERP_SID_KEY);
  }
};
