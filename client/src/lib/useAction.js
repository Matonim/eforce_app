import { useCallback, useState } from 'react';

/** Wraps request() with busy/error state for one UI control. Never throws. */
export function useAction(request) {
  const [status, setStatus] = useState({ busy: false, error: null });

  const run = useCallback(
    async (event, payload) => {
      setStatus({ busy: true, error: null });
      try {
        const response = await request(event, payload);
        setStatus({ busy: false, error: null });
        return response;
      } catch (err) {
        setStatus({ busy: false, error: err.message });
        return null;
      }
    },
    [request],
  );

  return { ...status, run, clearError: () => setStatus((s) => ({ ...s, error: null })) };
}
