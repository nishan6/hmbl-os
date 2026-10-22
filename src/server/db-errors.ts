import { Prisma } from "@/generated/prisma/client";
import { ConflictError } from "@/lib/errors";

/** Turns a unique-constraint violation into a ConflictError with a readable message. */
export async function withUniqueConflict<T>(message: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError(message);
    }
    throw error;
  }
}
