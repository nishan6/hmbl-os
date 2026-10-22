import "dotenv/config";
import { vi } from "vitest";

// `server-only` throws outside a React Server Component bundle; tests import server modules directly.
vi.mock("server-only", () => ({}));
