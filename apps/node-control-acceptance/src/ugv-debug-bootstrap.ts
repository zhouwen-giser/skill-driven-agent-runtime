import {
  ensureUgvDebugAuthority,
  ugvAgentProfileAuthorityConfigurationFromEnvironment,
} from './ugv-agent-profile-authority-bootstrap-driver.js';

try {
  const { configuration } = await ugvAgentProfileAuthorityConfigurationFromEnvironment('bootstrap');
  const result = await ensureUgvDebugAuthority(configuration);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error: unknown) {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'UGV_DEBUG_AUTHORITY_INITIALIZATION_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
  process.exitCode = 1;
}
