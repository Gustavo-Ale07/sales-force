import sharp from 'sharp';
import { loadWorkerConfig } from '../config/worker-env.js';

/**
 * Operator probe (Sandbox ONLY, user 0 ONLY): writes a small known JPEG into `TSIUSU.FOTO` of CODUSU 0 through the SAME gateway
 * code the worker uses, so the owner can check the column by SELECT (accept: header FFD8FF and the byte length printed here).
 * Runs inside the worker container (its environment holds the Sandbox credentials and the photo switch):
 *   node dist/cli/photo-write-probe.js
 * Prints no credential and no image content. Refuses unless the worker configuration is the Sandbox photo switch.
 */
async function main(): Promise<void> {
  const { gateway, profilePhotoWrite } = loadWorkerConfig(process.env);
  if (!profilePhotoWrite.enabled) {
    process.stderr.write('The profile photo switch is closed in this environment; nothing was sent.\n');
    process.exitCode = 2;
    return;
  }
  const jpeg = new Uint8Array(
    await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: 20, g: 110, b: 200 } } })
      .jpeg({ quality: 80 })
      .toBuffer(),
  );
  const header = Buffer.from(jpeg.subarray(0, 3)).toString('hex').toUpperCase();
  process.stdout.write(`sending a known JPEG to CODUSU 0: ${jpeg.byteLength} bytes, header ${header}\n`);
  try {
    await gateway.writeUserPhoto({ userCode: 0, image: jpeg, idempotencyKey: `probe:${Date.now()}` });
    process.stdout.write('the ERP accepted the write; check TSIUSU.FOTO of CODUSU 0 by SELECT\n');
  } catch (error) {
    const e = error as { code?: string; kind?: string; message?: string; cause?: unknown };
    const cause = e.cause instanceof Error ? e.cause.message : '';
    process.stdout.write(`refused: kind=${e.kind ?? '?'} code=${e.code ?? '?'} message=${e.message ?? ''}${cause === '' ? '' : ` erp="${cause}"`}\n`);
    process.exitCode = 1;
  }
}

void main();
