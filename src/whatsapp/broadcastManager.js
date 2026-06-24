/**
 * broadcastManager.js
 * Manages recurring broadcast jobs — starts and stops interval-based message sending to WA groups.
 */

const { prisma } = require('../database');
const { sendToGroups, getWAConnectionStatus } = require('./client');

// In-memory map of active jobs: jobId -> intervalHandle
const activeJobs = new Map();

/**
 * Starts a recurring broadcast job by its DB ID.
 * Sends the messages immediately, then repeats every job.intervalMs.
 */
async function startBroadcastJob(jobId) {
  if (activeJobs.has(jobId)) {
    console.log(`[Broadcast] Job ${jobId} is already running.`);
    return;
  }

  const job = await prisma.broadcastJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'RUNNING') {
    console.warn(`[Broadcast] Job ${jobId} not found or not RUNNING.`);
    return;
  }

  const messages = JSON.parse(job.messages || '[]');
  const targetGroups = JSON.parse(job.targetGroups || '[]');

  if (!messages.length || !targetGroups.length) {
    console.warn(`[Broadcast] Job ${jobId} has no messages or no target groups.`);
    return;
  }

  const executeTick = async () => {
    if (getWAConnectionStatus() !== 'CONNECTED') {
      console.warn(`[Broadcast] Job ${jobId}: WA not connected, skipping tick.`);
      return;
    }

    console.log(`[Broadcast] Job ${jobId} tick — sending to ${targetGroups.length} groups.`);
    try {
      await sendToGroups(targetGroups, messages);
      await prisma.broadcastJob.update({
        where: { id: jobId },
        data: { lastSentAt: new Date() }
      });
    } catch (err) {
      console.error(`[Broadcast] Job ${jobId} tick error:`, err.message);
    }
  };

  // Send immediately on start, then repeat
  await executeTick();
  const handle = setInterval(executeTick, job.intervalMs);
  activeJobs.set(jobId, handle);
  console.log(`[Broadcast] Job ${jobId} started. Interval: ${job.intervalMs}ms`);
}

/**
 * Stops a running broadcast job.
 */
async function stopBroadcastJob(jobId) {
  const handle = activeJobs.get(jobId);
  if (handle) {
    clearInterval(handle);
    activeJobs.delete(jobId);
    console.log(`[Broadcast] Job ${jobId} stopped.`);
  }

  try {
    await prisma.broadcastJob.update({
      where: { id: jobId },
      data: { status: 'STOPPED' }
    });
  } catch (err) {
    console.error(`[Broadcast] Failed to update job ${jobId} status:`, err.message);
  }
}

/**
 * Stops all active broadcast jobs. Call on server shutdown.
 */
function stopAllJobs() {
  for (const [jobId, handle] of activeJobs.entries()) {
    clearInterval(handle);
    console.log(`[Broadcast] Stopped job ${jobId} on shutdown.`);
  }
  activeJobs.clear();
}

/**
 * Resumes all RUNNING jobs from DB on server startup.
 */
async function resumeRunningJobs() {
  try {
    const jobs = await prisma.broadcastJob.findMany({ where: { status: 'RUNNING' } });
    for (const job of jobs) {
      await startBroadcastJob(job.id);
    }
    if (jobs.length > 0) {
      console.log(`[Broadcast] Resumed ${jobs.length} running job(s) from DB.`);
    }
  } catch (err) {
    console.error('[Broadcast] Failed to resume jobs from DB:', err.message);
  }
}

module.exports = {
  startBroadcastJob,
  stopBroadcastJob,
  stopAllJobs,
  resumeRunningJobs
};
