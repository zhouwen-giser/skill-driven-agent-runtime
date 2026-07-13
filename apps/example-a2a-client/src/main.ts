import { runExampleA2AClient } from './client.js';

const baseUrl = process.env['SDAR_A2A_URL'] ?? 'http://127.0.0.1:9999';
const text = process.argv.slice(2).join(' ') || 'Complete the local example task.';
const result = await runExampleA2AClient({ baseUrl, text });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
