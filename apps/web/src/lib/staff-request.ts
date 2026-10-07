export type StaffRequest = (path: string, init?: RequestInit) => Promise<Response>;

// An imperative, per-workspace latch for asynchronous callbacks, not render state.
// React state still controls the view; a late success cannot undo this failure.
export const createStaffAuthenticationGuard = (
  onAuthenticationRequired: () => void,
): Readonly<{ isRequired: () => boolean; requireAuthentication: () => void }> => {
  let required = false;
  return Object.freeze({
    isRequired: () => required,
    requireAuthentication: () => {
      required = true;
      onAuthenticationRequired();
    },
  });
};

export const createStaffRequest = (
  options: Readonly<{
    apiOrigin: string;
    organizationHeaders: Readonly<Record<string, string>>;
    fetchImpl?: typeof fetch;
    onAuthenticationRequired: () => void;
  }>,
): StaffRequest => {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (path, init = {}) => {
    const headers = new Headers(options.organizationHeaders);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    const response = await fetchImpl(options.apiOrigin + path, {
      ...init,
      credentials: "include",
      headers,
    });
    if (response.status === 401) options.onAuthenticationRequired();
    return response;
  };
};
