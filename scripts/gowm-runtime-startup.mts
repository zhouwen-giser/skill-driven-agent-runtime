import { verifyGowmRuntimeStartup } from '../apps/server/test/gowm-runtime-startup.js';
// Isolated process: failed construction can precede a closeable runtime handle.
// Explicit exit releases only this process's sockets; the report records that limitation.
process.exit(await verifyGowmRuntimeStartup());
