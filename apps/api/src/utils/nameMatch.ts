// Normaliza nomes para a confirmação eletrônica: ignora maiúsculas/minúsculas e espaços extras.
export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function namesMatch(typed: string, registered: string): boolean {
  return normalizeName(typed) === normalizeName(registered);
}
