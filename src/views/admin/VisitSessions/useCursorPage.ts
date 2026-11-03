import { useEffect, useRef, useState } from 'react';
const EMPTY: never[] = [];

export function useCursorPage<T, C>(
  fetchPage: (cursor?: C) => Promise<{ records: T[]; next?: C }>,
  key: string,
  active = true,
) {
  const fetchRef = useRef(fetchPage);
  const cache = useRef(new Map<string, { records: T[]; next?: C }>());
  const waiters = useRef(new Map<string, () => void>());
  fetchRef.current = fetchPage;
  const [navigation, setNavigation] = useState<{ key: string; index: number; cursors: (C | undefined)[]; revision: number }>({ key, index: 0, cursors: [undefined], revision: 0 });
  const current = navigation.key === key ? navigation : { key, index: 0, cursors: [undefined], revision: 0 };
  const [result, setResult] = useState<{ key: string; index: number; revision: number; records: T[]; next?: C; error?: string; loading: boolean }>({ key: '', index: 0, revision: 0, records: [], loading: true });
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const identity = { key, index: current.index, revision: current.revision };
    const cacheKey = JSON.stringify(identity);
    const cached = cache.current.get(cacheKey);
    if (cached) {
      setResult({ ...identity, ...cached, loading: false });
      return;
    }
    setResult({ ...identity, records: [], loading: true });
    fetchRef.current(current.cursors[current.index]).then(page => {
      if (!cancelled) {
        cache.current.set(cacheKey, page);
        if (cache.current.size > 10) cache.current.delete(cache.current.keys().next().value!);
        setResult({ ...identity, ...page, loading: false });
      }
    }, error => {
      if (!cancelled) setResult({ ...identity, records: [], loading: false, error: String(error) });
    }).finally(() => { waiters.current.get(cacheKey)?.(); waiters.current.delete(cacheKey); });
    return () => { cancelled = true; waiters.current.get(cacheKey)?.(); waiters.current.delete(cacheKey); };
  }, [key, current.index, current.revision, active]);
  const visible = active && result.key === key && result.index === current.index && result.revision === current.revision;
  return {
    records: visible ? result.records : EMPTY,
    loading: active && (!visible || result.loading),
    error: visible ? result.error : undefined,
    page: current.index + 1,
    hasNext: visible && !!result.next && !result.loading,
    previous: () => setNavigation({ ...current, index: Math.max(0, current.index - 1) }),
    next: () => { if (visible && result.next) setNavigation({ ...current, index: current.index + 1, cursors: [...current.cursors.slice(0, current.index + 1), result.next] }); },
    refresh: () => {
      cache.current.clear();
      const revision = current.revision + 1;
      if (!active) {
        setNavigation({ key, index: 0, cursors: [undefined], revision });
        return Promise.resolve();
      }
      const cacheKey = JSON.stringify({ key, index: 0, revision });
      const completion = new Promise<void>(resolve => { waiters.current.get(cacheKey)?.(); waiters.current.set(cacheKey, resolve); });
      setNavigation({ key, index: 0, cursors: [undefined], revision });
      return completion;
    },
  };
}
