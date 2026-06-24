const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../database');
const { config, updateConfigInDb } = require('../config');
const cron = require('node-cron');

let drive = null;
let clientEmail = 'Not Connected';

/**
 * Returns a configured Google Drive client and auth email.
 */
function getGoogleDriveClient() {
  if (drive && clientEmail !== 'Not Connected') {
    return { drive, clientEmail };
  }

  try {
    // 1. Try to load google-credentials.json in the project root
    const credentialsPath = path.join(process.cwd(), 'google-credentials.json');
    let creds = null;

    if (fs.existsSync(credentialsPath)) {
      creds = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      console.log('[CloudBackup] Found credentials file google-credentials.json.');
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      // 2. Try environment variable
      creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      console.log('[CloudBackup] Found credentials in GOOGLE_SERVICE_ACCOUNT_JSON.');
    }

    if (!creds) {
      throw new Error('Google Service Account credentials are not configured. Place google-credentials.json in root or set GOOGLE_SERVICE_ACCOUNT_JSON.');
    }

    const auth = new google.auth.JWT(
      creds.client_email,
      null,
      creds.private_key,
      ['https://www.googleapis.com/auth/drive']
    );

    drive = google.drive({ version: 'v3', auth });
    clientEmail = creds.client_email;
    return { drive, clientEmail };
  } catch (error) {
    console.error('[CloudBackup] Auth initialization failed:', error.message);
    clientEmail = 'Not Connected';
    drive = null;
    throw error;
  }
}

/**
 * Searches for or creates a backup folder named "HelperJoko_Backup" in Google Drive.
 */
async function findOrCreateBackupFolder(driveClient) {
  const q = "name = 'HelperJoko_Backup' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const response = await driveClient.files.list({
    q,
    fields: 'files(id)',
    spaces: 'drive'
  });

  const files = response.data.files;
  if (files && files.length > 0) {
    return files[0].id;
  }

  console.log('[CloudBackup] Creating folder "HelperJoko_Backup" in Google Drive...');
  const folderMetadata = {
    name: 'HelperJoko_Backup',
    mimeType: 'application/vnd.google-apps.folder'
  };
  
  const folder = await driveClient.files.create({
    requestBody: folderMetadata,
    fields: 'id'
  });

  return folder.data.id;
}

/**
 * Finds a file by name inside a specific parent folder in Google Drive.
 */
async function findBackupFile(driveClient, folderId, fileName) {
  const q = `name = '${fileName}' and '${folderId}' in parents and trashed = false`;
  const response = await driveClient.files.list({
    q,
    fields: 'files(id)',
    spaces: 'drive'
  });

  const files = response.data.files;
  if (files && files.length > 0) {
    return files[0].id;
  }
  return null;
}

/**
 * Updates Google backup status configurations in DB.
 */
async function updateBackupStatus(status, errorMsg = '', lastSync = null, size = null) {
  await updateConfigInDb('google_backup_status', status);
  if (errorMsg !== undefined) await updateConfigInDb('google_backup_error', errorMsg);
  if (lastSync) await updateConfigInDb('google_backup_last_sync', lastSync);
  if (size) await updateConfigInDb('google_backup_size', size);
}

/**
 * Uploads a copy of dev.db into Google Drive.
 */
async function backupDatabaseToCloud() {
  const dbPath = path.join(process.cwd(), 'dev.db');
  const tempDbPath = path.join(process.cwd(), 'dev_backup_temp.db');
  
  try {
    console.log('[CloudBackup] Starting database cloud backup...');
    await updateBackupStatus('Syncing', '');

    const { drive: driveClient, clientEmail: authEmail } = getGoogleDriveClient();
    await updateConfigInDb('google_backup_email', authEmail);

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Local database file not found at ${dbPath}`);
    }

    // Safely copy database to a temporary location to prevent locking issues
    fs.copyFileSync(dbPath, tempDbPath);
    const stats = fs.statSync(tempDbPath);
    const fileSize = stats.size;

    // Find/create folder
    let folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      folderId = await findOrCreateBackupFolder(driveClient);
    }

    // Check if dev_backup_latest.db exists
    const fileId = await findBackupFile(driveClient, folderId, 'dev_backup_latest.db');

    const media = {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(tempDbPath)
    };

    if (fileId) {
      console.log(`[CloudBackup] Overwriting existing backup file: dev_backup_latest.db (ID: ${fileId})`);
      await driveClient.files.update({
        fileId: fileId,
        media: media
      });
    } else {
      console.log('[CloudBackup] Uploading new backup file: dev_backup_latest.db');
      await driveClient.files.create({
        requestBody: {
          name: 'dev_backup_latest.db',
          parents: [folderId]
        },
        media: media
      });
    }

    // Delete temp file
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }

    const sizeStr = (fileSize / (1024 * 1024)).toFixed(2) + ' MB';
    const lastSyncTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    
    await updateBackupStatus('Connected', '', lastSyncTime, sizeStr);
    console.log(`[CloudBackup] Cloud sync completed successfully. Size: ${sizeStr}`);
    return { success: true, lastSyncTime, sizeStr };
  } catch (error) {
    console.error('[CloudBackup] Backup failed:', error.message);
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
    await updateBackupStatus('Sync Failed', error.message);
    throw error;
  }
}

/**
 * Downloads dev_backup_latest.db from Google Drive and overwrites local dev.db.
 */
async function restoreDatabaseFromCloud() {
  const dbPath = path.join(process.cwd(), 'dev.db');
  const tempRestorePath = path.join(process.cwd(), 'dev_restore_temp.db');

  try {
    console.log('[CloudBackup] Starting database cloud restore sequence...');
    const { drive: driveClient } = getGoogleDriveClient();

    let folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      folderId = await findOrCreateBackupFolder(driveClient);
    }

    const fileId = await findBackupFile(driveClient, folderId, 'dev_backup_latest.db');
    if (!fileId) {
      throw new Error('No cloud backup file (dev_backup_latest.db) found in Google Drive folder.');
    }

    console.log(`[CloudBackup] Downloading backup file from Google Drive (ID: ${fileId})...`);
    const dest = fs.createWriteStream(tempRestorePath);
    
    const response = await driveClient.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    await new Promise((resolve, reject) => {
      response.data
        .on('end', () => {
          console.log('[CloudBackup] Download complete.');
          resolve();
        })
        .on('error', (err) => {
          console.error('[CloudBackup] Download error:', err);
          reject(err);
        })
        .pipe(dest);
    });

    console.log('[CloudBackup] Disconnecting Prisma Client to release SQLite file lock...');
    await prisma.$disconnect();

    console.log('[CloudBackup] Overwriting live dev.db with downloaded backup...');
    fs.copyFileSync(tempRestorePath, dbPath);

    if (fs.existsSync(tempRestorePath)) {
      fs.unlinkSync(tempRestorePath);
    }

    console.log('[CloudBackup] Database restore complete. Re-connecting database...');
    await prisma.config.findFirst();

    console.log('[CloudBackup] Database connection verified successfully.');
    return { success: true };
  } catch (error) {
    console.error('[CloudBackup] Restore failed:', error.message);
    if (fs.existsSync(tempRestorePath)) {
      fs.unlinkSync(tempRestorePath);
    }
    throw error;
  }
}

/**
 * Initializes nodes-cron schedule and tests credentials on startup.
 */
function initBackupScheduler() {
  console.log('[CloudBackup] Initializing Google Drive Backup scheduler...');
  
  try {
    const { clientEmail: authEmail } = getGoogleDriveClient();
    updateBackupStatus('Connected', '', null, null).catch(() => {});
    updateConfigInDb('google_backup_email', authEmail).catch(() => {});
    console.log(`[CloudBackup] Google Drive backup initialized. Auth email: ${authEmail}`);
  } catch (err) {
    console.warn('[CloudBackup] Google Drive credentials not found or invalid. Auto-sync is disabled.');
    updateBackupStatus('Disconnected', err.message).catch(() => {});
  }

  // Schedule task every 6 hours: 0 */6 * * *
  cron.schedule('0 */6 * * *', async () => {
    console.log('[CloudBackup] Cron triggered: executing scheduled cloud backup...');
    try {
      await backupDatabaseToCloud();
    } catch (err) {
      console.error('[CloudBackup] Scheduled backup failed:', err.message);
    }
  });
}

module.exports = {
  backupDatabaseToCloud,
  restoreDatabaseFromCloud,
  initBackupScheduler
};
