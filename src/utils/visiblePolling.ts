/** Skip hidden/background ticks and keep each task serial, including visibility resumes. */
export function startVisiblePolling(task: (reason: 'initial' | 'interval' | 'resume') => Promise<unknown>, intervalMs: number,
  visibility: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document) {
  let stopped = false;
  let running = false;
  const run = async (reason: 'initial' | 'interval' | 'resume') => {
    if (stopped || running || visibility.hidden) return;
    running = true;
    try { await task(reason); }
    catch { /* The task owns its error state; a failed tick must not stop future ticks. */ }
    finally { running = false; }
  };
  const resume = () => { void run('resume'); };
  visibility.addEventListener('visibilitychange', resume);
  const timer = setInterval(() => { void run('interval'); }, intervalMs);
  void run('initial');
  return () => {
    stopped = true;
    clearInterval(timer);
    visibility.removeEventListener('visibilitychange', resume);
  };
}
