/** Erro esperado de um caso de uso (entrada inválida, recurso inexistente…). */
export class ErroAplicacao extends Error {
  constructor(
    public readonly codigo: string,
    mensagem: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(mensagem);
    this.name = 'ErroAplicacao';
  }
}
