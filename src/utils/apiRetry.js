/**
 * Retries an asynchronous function with exponential backoff and jitter.
 * Useful for handling temporary rate limits (429) or server overloads (503).
 */
async function retryWithBackoff(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimitOrUnavailable =
        error.status === 429 ||
        error.status === 503 ||
        (error.message && (
          error.message.includes('503') ||
          error.message.includes('429') ||
          error.message.includes('overloaded') ||
          error.message.includes('high demand') ||
          error.message.includes('Service Unavailable')
        ));

      if (isRateLimitOrUnavailable && i < retries - 1) {
        const sleepTime = delay * Math.pow(2, i) + Math.random() * 500;
        console.warn(`[Gemini API] Temporary error encountered (${error.message}). Retrying in ${Math.round(sleepTime)}ms... (Attempt ${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, sleepTime));
      } else {
        throw error;
      }
    }
  }
}

module.exports = {
  retryWithBackoff
};
