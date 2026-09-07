import { createHash } from 'node:crypto';

export function inputClass(file) {
  // These historical locations contain executable test-selection/contract inputs, not results.
  if (
    [
      'reports/v1.4.1-evidence/source-to-evidence-matrix.json',
      'reports/v1.4.1-evidence/verification-proof-manifest.json',
      'reports/ugv-agent-profile-simulation/contract-freeze.json',
    ].includes(file)
  )
    return 'runtime';
  if (
    file.startsWith('reports/') ||
    file === 'PROJECT_STATUS.md' ||
    file === 'CHANGELOG.md' ||
    file.startsWith('execplans/') ||
    file === 'verification-inputs.json'
  )
    return 'status';
  if (
    file.startsWith('docs/') ||
    file.startsWith('source/') ||
    file.startsWith('adr/') ||
    ['AGENTS.md', 'PLANS.md'].includes(file)
  )
    return 'baseline';
  return 'runtime';
}

export function inputDigest(entries, classification) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        entries
          .filter((entry) => inputClass(entry.path) === classification)
          .sort((left, right) => left.path.localeCompare(right.path, 'en')),
      ),
    )
    .digest('hex');
}
