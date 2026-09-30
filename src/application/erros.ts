/** Erro esperado de um caso de uso (entrada inválida, recurso inexistente, sem permissão…). */
export class ErroAplicacao extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 429 = 400,
    /** Campos extras que vão junto na resposta (ex.: `ate` no bloqueio por tentativas). */
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(mensagem);
    this.name = 'ErroAplicacao';
  }
}
