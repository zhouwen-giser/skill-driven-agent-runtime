import process from 'node:process';

import { validateComposeWithDocker } from './lib/infrastructure.mjs';

validateComposeWithDocker(process.cwd());
