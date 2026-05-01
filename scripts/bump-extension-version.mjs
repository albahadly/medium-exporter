import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const bumpType = process.argv[2] ?? 'patch';

function bumpSemver(version, type) {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part) || part < 0)) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  if (type === 'major') {
    return `${parts[0] + 1}.0.0`;
  }

  if (type === 'minor') {
    return `${parts[0]}.${parts[1] + 1}.0`;
  }

  if (type === 'patch') {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }

  throw new Error(`Unsupported bump type: ${type}. Use patch, minor, or major.`);
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function main() {
  const root = process.cwd();
  const packagePath = path.join(root, 'package.json');
  const manifestPath = path.join(root, 'manifest.json');
  const lockPath = path.join(root, 'package-lock.json');

  const packageJson = await readJson(packagePath);
  const manifestJson = await readJson(manifestPath);

  const currentVersion = packageJson.version;
  const nextVersion = bumpSemver(currentVersion, bumpType);

  packageJson.version = nextVersion;
  manifestJson.version = nextVersion;

  await writeJson(packagePath, packageJson);
  await writeJson(manifestPath, manifestJson);

  if (existsSync(lockPath)) {
    const lockJson = await readJson(lockPath);
    if (typeof lockJson.version === 'string') {
      lockJson.version = nextVersion;
    }

    if (
      lockJson.packages &&
      typeof lockJson.packages === 'object' &&
      lockJson.packages[''] &&
      typeof lockJson.packages[''] === 'object'
    ) {
      lockJson.packages[''].version = nextVersion;
    }

    await writeJson(lockPath, lockJson);
  }

  console.log(`Bumped extension version: ${currentVersion} -> ${nextVersion}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
