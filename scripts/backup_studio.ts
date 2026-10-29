/**
 * Backs up .spacepipe-studio/ and verifies the copy byte for byte. Run before any phase that touches it:
 *   node scripts/backup_studio.ts
 * Exits 1 if the copy does not match.
 */
import path from 'node:path';
import { backupStudio, verifyBackup } from '../server/studioBackup.ts';

const root = path.resolve(import.meta.dirname, '..');
const b = backupStudio(root);
const v = verifyBackup(path.join(root, '.spacepipe-studio'), b.dir);
console.log(JSON.stringify({ backup: b.dir, manifest: b.manifestPath, files: b.files, bytes: b.bytes, verify: v }, null, 2));
if (!v.ok) { console.error('Backup does not match the live folder (it may have changed during the copy). Run again.'); process.exit(1); }
console.log(`Verified: ${v.checked} files match byte for byte.`);
