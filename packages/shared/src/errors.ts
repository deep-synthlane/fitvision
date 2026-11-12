/** Shape of every non-2xx JSON response from the API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation messages, keyed by field path. */
    fields?: Record<string, string>;
  };
}
