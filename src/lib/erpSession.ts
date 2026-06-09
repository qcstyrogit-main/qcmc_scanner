const ERP_SID_KEY = "erp.sid";
const ERP_CSRF_KEY = "erp.csrf";
const ERP_MOBILE_TOKEN_KEY = "erp.mobile_token";

const readStorage = (key: string) => {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore session storage failures.
  }

  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore local storage failures.
  }
};

const removeStorage = (key: string) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore session storage failures.
  }

  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore local storage failures.
  }
};

export const getErpSid = () => readStorage(ERP_SID_KEY);
export const getErpCsrf = () => readStorage(ERP_CSRF_KEY);
export const getErpMobileToken = () => readStorage(ERP_MOBILE_TOKEN_KEY);

export const setErpSid = (sid?: string | null) => {
  const cleaned = sid?.trim() || "";

  if (cleaned) {
    writeStorage(ERP_SID_KEY, cleaned);
  } else {
    removeStorage(ERP_SID_KEY);
  }
};

export const setErpCsrf = (token?: string | null) => {
  const cleaned = token?.trim() || "";

  if (cleaned) {
    writeStorage(ERP_CSRF_KEY, cleaned);
  } else {
    removeStorage(ERP_CSRF_KEY);
  }
};

export const setErpMobileToken = (token?: string | null) => {
  const cleaned = token?.trim() || "";

  if (cleaned) {
    writeStorage(ERP_MOBILE_TOKEN_KEY, cleaned);
  } else {
    removeStorage(ERP_MOBILE_TOKEN_KEY);
  }
};
