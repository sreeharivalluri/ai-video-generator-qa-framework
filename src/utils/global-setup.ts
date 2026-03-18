import * as fs from 'fs';

export default async function globalSetup(): Promise<void> {
  fs.mkdirSync('logs', { recursive: true });
  fs.mkdirSync('test-results', { recursive: true });
  console.log('[Setup] AI Video QA Framework ready');
}
