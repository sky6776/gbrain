#!/usr/bin/env bun
import { execFileSync } from 'child_process';

try {
  execFileSync('gbrain', ['--version'], { stdio: 'pipe' });
  execFileSync('gbrain', ['apply-migrations', '--yes', '--non-interactive'], { stdio: 'inherit' });
} catch {
  console.error(
    "[gbrain] postinstall skipped. If installed via bun install -g github:...: " +
    "run `gbrain doctor` and `gbrain apply-migrations --yes` manually. " +
    "See https://github.com/garrytan/gbrain/issues/218"
  );
}
