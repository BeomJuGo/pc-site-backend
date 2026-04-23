const running = new Set();

export function acquireLock(name) {
  if (running.size > 0) return false;
  running.add(name);
  return true;
}

export function releaseLock(name) {
  running.delete(name);
}

export function getRunning() {
  return [...running];
}
