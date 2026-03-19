export type LabApoioConsumerErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'UPSTREAM_ERROR'
  | 'VALIDATION_ERROR';

export class LabApoioConsumerError extends Error {
  statusCode: number;
  code: LabApoioConsumerErrorCode;
  details?: unknown;

  constructor(
    statusCode: number,
    code: LabApoioConsumerErrorCode,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
