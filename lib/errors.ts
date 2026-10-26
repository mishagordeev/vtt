/** Ошибка, которую можно безопасно показать клиенту. */
export class AppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export const ROOM_NOT_FOUND = "Комната не найдена. Проверьте ссылку.";
