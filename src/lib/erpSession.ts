const ERP_SID_KEY = "erp.sid";
const ERP_CSRF_KEY = "erp.csrf";

export const getErpSid = () => sessionStorage.getItem(ERP_SID_KEY) || "";
export const getErpCsrf = () => sessionStorage.getItem(ERP_CSRF_KEY) || "";

export const setErpSid = (sid?: string | null) => {
  const cleaned = sid?.trim() || "";

  if (cleaned) {
    sessionStorage.setItem(ERP_SID_KEY, cleaned);
  } else {
    sessionStorage.removeItem(ERP_SID_KEY);
  }
};

export const setErpCsrf = (token?: string | null) => {
  const cleaned = token?.trim() || "";

  if (cleaned) {
    sessionStorage.setItem(ERP_CSRF_KEY, cleaned);
  } else {
    sessionStorage.removeItem(ERP_CSRF_KEY);
  }
};
