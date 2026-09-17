/**
 * Application error hierarchy (Spec 01 §3, §5).
 *
 * Every AppError carries a machine `slug`, an HTTP `status`, a short `title`,
 * and a `publicDetail` — a fixed, generic, client-safe string. The `message`
 * (Error.message) is the *internal* reason and is for server logs only; it is
 * never placed in a response body. The problem+json mapper lives in ./problem.
 */

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

interface AppErrorOptions {
  readonly fieldErrors?: readonly FieldError[];
  readonly cause?: unknown;
}

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly slug: string;
  abstract readonly title: string;
  /** Generic, client-facing detail. Never derived from internal state. */
  abstract readonly publicDetail: string;

  readonly fieldErrors: readonly FieldError[] | undefined;

  constructor(internalMessage: string, options?: AppErrorOptions) {
    super(internalMessage, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.fieldErrors = options?.fieldErrors;
  }
}

export class UnauthenticatedError extends AppError {
  readonly status = 401;
  readonly slug = "unauthenticated";
  readonly title = "Unauthenticated";
  readonly publicDetail = "Authentication is required to access this resource.";

  constructor(internal = "missing or malformed Authorization header") {
    super(internal);
  }
}

export class InvalidTokenError extends AppError {
  readonly status = 401;
  readonly slug = "invalid-token";
  readonly title = "Invalid token";
  readonly publicDetail =
    "The access token failed validation or is missing required claims.";

  constructor(internal: string) {
    super(internal);
  }
}

export class AuthUnavailableError extends AppError {
  readonly status = 503;
  readonly slug = "auth-unavailable";
  readonly title = "Authentication temporarily unavailable";
  readonly publicDetail =
    "Unable to validate credentials right now. Please retry shortly.";

  constructor(internal: string, options?: { cause?: unknown }) {
    super(internal, options);
  }
}

export class AccountDeletedError extends AppError {
  readonly status = 403;
  readonly slug = "account-deleted";
  readonly title = "Account deleted";
  readonly publicDetail = "This account has been deleted.";

  constructor(internal = "user row has deleted_at set") {
    super(internal);
  }
}

export class ValidationError extends AppError {
  readonly status = 422;
  readonly slug = "validation-error";
  readonly title = "Validation error";
  readonly publicDetail = "The request body failed validation.";

  constructor(
    fieldErrors: readonly FieldError[],
    internal = "request body validation failed",
  ) {
    super(internal, { fieldErrors });
  }
}

export class PayloadTooLargeError extends AppError {
  readonly status = 413;
  readonly slug = "payload-too-large";
  readonly title = "Payload too large";
  readonly publicDetail = "The request body exceeds the maximum allowed size.";

  constructor(internal = "request body over the configured byte limit") {
    super(internal);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  readonly status = 415;
  readonly slug = "unsupported-media-type";
  readonly title = "Unsupported media type";
  readonly publicDetail = "The request's Content-Type is not supported.";

  constructor(internal = "unsupported or missing Content-Type") {
    super(internal);
  }
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly slug = "not-found";
  readonly title = "Not found";
  readonly publicDetail = "The requested resource was not found.";

  constructor(internal = "resource not found") {
    super(internal);
  }
}

export class InternalError extends AppError {
  readonly status = 500;
  readonly slug = "internal";
  readonly title = "Internal server error";
  readonly publicDetail = "An unexpected error occurred.";

  constructor(internal = "unhandled error", options?: { cause?: unknown }) {
    super(internal, options);
  }
}

export class CustomExerciseLimitError extends AppError {
  readonly status = 409;
  readonly slug = "exercise-limit-reached";
  readonly title = "Custom exercise limit reached";
  readonly publicDetail =
    "You have reached the maximum number of custom exercises.";

  constructor(internal = "per-user active custom exercise cap exceeded") {
    super(internal);
  }
}

export class ExerciseRetiredError extends AppError {
  readonly status = 409;
  readonly slug = "exercise-retired";
  readonly title = "Exercise retired";
  readonly publicDetail =
    "This exercise has been retired and can no longer be modified.";

  constructor(internal = "target exercise is_active=false") {
    super(internal);
  }
}

export class ExerciseImmutableError extends AppError {
  readonly status = 403;
  readonly slug = "exercise-immutable";
  readonly title = "Exercise immutable";
  readonly publicDetail = "This is a global exercise and cannot be deleted.";

  constructor(internal = "target exercise is a global row") {
    super(internal);
  }
}

export class ExerciseImmutableUseForkError extends AppError {
  readonly status = 409;
  readonly slug = "exercise-immutable-use-fork";
  readonly title = "Exercise immutable — use fork";
  readonly publicDetail =
    "This is a global exercise and cannot be edited directly. Fork it first.";

  constructor(internal = "target exercise is a global row; PATCH refused") {
    super(internal);
  }
}

export class ExerciseAlreadyOwnedError extends AppError {
  readonly status = 409;
  readonly slug = "exercise-already-owned";
  readonly title = "Exercise already owned";
  readonly publicDetail =
    "You already own this exercise. Edit it directly instead of forking.";

  constructor(internal = "fork target is already owned by the caller") {
    super(internal);
  }
}
