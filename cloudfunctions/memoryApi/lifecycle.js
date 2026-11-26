'use strict';

const PENDING_UPLOAD_GRACE_MS = 30 * 60 * 1000;

function unfinishedUploadExpired(photo, now = Date.now()) {
  if (photo.upload_state === 'cleanup') return true;
  if (photo.upload_state !== 'pending') return false;
  const created = Date.parse(photo.created_at);
  return Number.isFinite(created) && now - created >= PENDING_UPLOAD_GRACE_MS;
}

async function runTrackedUpload({ createPending, upload, activate, markCleanup }) {
  await createPending();
  try {
    const stored = await upload();
    await activate(stored);
    return stored;
  } catch (error) {
    try { await markCleanup(error); } catch (markError) {
      console.error('failed to mark tracked upload for cleanup', markError);
    }
    throw error;
  }
}

async function runTrackedRemoval({ remove, markDeleted, markError }) {
  try {
    await remove();
    await markDeleted();
  } catch (error) {
    try { await markError(error); } catch (markErrorFailure) {
      console.error('failed to persist storage removal error', markErrorFailure);
    }
    throw error;
  }
}

module.exports = { runTrackedRemoval, runTrackedUpload, unfinishedUploadExpired };
