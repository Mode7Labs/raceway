// Raceway Web UI Configuration
// Reads from environment variables set in .env file

export const config = {
  // API Base URL - where the Raceway server is running
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080',
} as const;
