import type { ZodType } from 'zod';

/** Runs a zod schema and returns either the parsed data or a map of field → first error message. */
export function validate<T>(schema: ZodType<T>, input: unknown): { data: T; errors: null } | { data: null; errors: Record<string, string> } {
  const result = schema.safeParse(input);
  if (result.success) return { data: result.data, errors: null };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    errors[key] ??= issue.message;
  }
  return { data: null, errors };
}
