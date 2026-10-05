async function globalTeardown(): Promise<void> {
  // Leave docker running for dev convenience. The next run resets the DB.
  // eslint-disable-next-line no-console
  console.log('[e2e] teardown: leaving docker containers running');
}

export default globalTeardown;
