// library/taskQueue.js
function createQueue({ concurrency = 3, minDelayMs = 250 } = {}) {
  let active = 0;
  const queue = [];
  let lastRun = 0;

  const runNext = async () => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (!job) return;

    active++;
    try {
      const now = Date.now();
      const wait = Math.max(0, minDelayMs - (now - lastRun));
      if (wait) await new Promise((r) => setTimeout(r, wait));

      lastRun = Date.now();
      const res = await job.fn();
      job.resolve(res);
    } catch (e) {
      job.reject(e);
    } finally {
      active--;
      runNext();
    }
  };

  const push = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });

  return { push, size: () => queue.length, active: () => active };
}

module.exports = { createQueue };