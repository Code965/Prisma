/// <reference types="vite/client" />
import type { PrismaApi } from '../../preload/index';

declare global {
  interface Window {
    /** Assente quando il renderer gira nel browser (anteprima con `pnpm dev:web`). */
    prisma?: PrismaApi;
  }
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
