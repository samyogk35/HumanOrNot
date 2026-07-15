import { createApp } from './app';

async function main() {
  // Set required environment variables for the backend
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://testuser:testpassword@localhost:5432/humanornot';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'super-secret-dev-key';

  try {
    const { server } = await createApp();
    const PORT = 3000;
    
    server.listen(PORT, () => {
      console.log(`🚀 Backend server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
