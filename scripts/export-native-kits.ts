#!/usr/bin/env tsx
/**
 * Exporta os projetos nativos (Android Kotlin/Gradle, Windows C#/Electron e Linux ELF/.deb/Electron)
 * para o diretório de build (padrão: build-kits/) usados pelo workflow GitHub Actions
 * `.github/workflows/release-all-apps.yml` para compilar .APK, .EXE e .DEB/.AppImage.
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import * as nativePackages from '../server/nativePackages.ts';

function parseArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return fallback;
}

async function extractZipBuffer(buf: Buffer, destDir: string): Promise<number> {
  const zip = await JSZip.loadAsync(buf);
  let count = 0;
  for (const [entryPath, entry] of Object.entries(zip.files)) {
    const cleanRel = entryPath.replace(/^\/+/, '');
    if (!cleanRel || cleanRel.includes('..')) continue;
    const outPath = path.resolve(destDir, cleanRel);
    if (outPath !== destDir && !outPath.startsWith(destDir + path.sep)) {
      throw new Error(`Unsafe zip entry path blocked: ${entryPath}`);
    }
    if (entry.dir) {
      fs.mkdirSync(outPath, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const data = await entry.async('nodebuffer');
    fs.writeFileSync(outPath, data);
    if (cleanRel.endsWith('.sh') || cleanRel.endsWith('.mjs')) {
      try {
        fs.chmodSync(outPath, 0o755);
      } catch {
        // Windows ignores POSIX chmod bits
      }
    }
    count++;
  }
  return count;
}

async function main() {
  const outRoot = path.resolve(process.cwd(), parseArg('--out', 'build-kits'));
  const origin = nativePackages.sanitizeOrigin(
    parseArg('--origin', process.env.APP_URL || 'https://aegis.local')
  );
  const target = parseArg('--target', 'all').toLowerCase();

  fs.mkdirSync(outRoot, { recursive: true });

  if (target === 'all' || target === 'android') {
    const androidDir = path.join(outRoot, 'android');
    fs.rmSync(androidDir, { recursive: true, force: true });
    fs.mkdirSync(androidDir, { recursive: true });
    const androidPkg = await nativePackages.buildAndroidNativeProjectZip(origin);
    const n = await extractZipBuffer(androidPkg.buffer, androidDir);
    console.log(`[export] Android Kotlin project exported (${n} files) -> ${androidDir}`);
  }

  if (target === 'all' || target === 'windows') {
    const winDir = path.join(outRoot, 'windows');
    fs.rmSync(winDir, { recursive: true, force: true });
    fs.mkdirSync(winDir, { recursive: true });
    const winPkg = await nativePackages.buildWindowsNativePackageZip(origin);
    const n = await extractZipBuffer(winPkg.buffer, winDir);
    console.log(`[export] Windows native kit exported (${n} files) -> ${winDir}`);
  }

  if (target === 'all' || target === 'linux') {
    const linuxDir = path.join(outRoot, 'linux');
    fs.rmSync(linuxDir, { recursive: true, force: true });
    fs.mkdirSync(linuxDir, { recursive: true });
    const linuxArtifacts = nativePackages.buildLinuxNativeArtifacts();
    fs.writeFileSync(path.join(linuxDir, 'aegis-desktop_2.1.0_amd64.deb'), linuxArtifacts.debBuffer);
    fs.writeFileSync(path.join(linuxDir, 'aegis-desktop-linux-x64.tar.gz'), linuxArtifacts.tarGzBuffer);
    fs.writeFileSync(path.join(linuxDir, 'aegis-desktop'), linuxArtifacts.elfBuffer, { mode: 0o755 });
    console.log(`[export] Linux compiled artifacts (.deb, .tar.gz, ELF) -> ${linuxDir}`);
  }
}

main().catch((err) => {
  console.error('[export] Failed:', err);
  process.exit(1);
});
