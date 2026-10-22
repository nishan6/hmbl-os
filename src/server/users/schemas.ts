import { z } from "zod";

export const createUserInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(12, "Use at least 12 characters").max(128, "Use at most 128 characters"),
  roleKeys: z.array(z.string()).default([]),
});

export type CreateUserInput = z.input<typeof createUserInput>;
