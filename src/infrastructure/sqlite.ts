/**
 * Implementação SQLite do Armazém (usa o `node:sqlite` embutido no Node 24 — sem servidor,
 * sem compilação nativa). Trocar por Postgres no futuro = reescrever só este arquivo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db, Dialeto } from './banco';
import { fileURLToPath } from 'node:url';
import type {
  Ajudante,
  Armazem,
  FiltroPacotes,
  ItemLote,
  Lote,
  RepositorioAjudantes,
  RepositorioCargas,
  RepositorioContas,
  RepositorioDias,
  RepositorioPessoas,
  RepositorioRegioes,
  RepositorioDestinos,
  RepositorioEventos,
  RepositorioLotes,
  RepositorioPacotes,
  StatusLote,
} from '../application/portas';
import type { Carga, EventoCarga } from '../domain/carga';
import type { Destino } from '../domain/destinoPacote';
import type { Associacao, EventoRegiao, Regiao } from '../domain/regioes';
import type { EventoPessoa, MemoriaPessoa } from '../domain/caixas';
import type { Conta, EventoConta, Sessao } from '../domain/contas';
import type { Dia } from '../domain/dias';
import { chaveTexto } from '../domain/destino/texto';
import type { Evento } from '../domain/eventos';
import type { Pacote } from '../domain/pacote';

type Linha = Record<string, unknown>;
const json = (v: unknown) => JSON.stringify(v);
const parse = <T>(v: unknown): T => JSON.parse(String(v)) as T;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

const PASTA_MIGRACOES = fileURLToPath(new URL('./migrations/', import.meta.url));

export function abrirBanco(caminho: string): DatabaseSync {
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS migracoes (nome TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL)');
  const aplicadas = new Set(db.prepare('SELECT nome FROM migracoes').all().map((r) => String(r.nome)));
  for (const nome of readdirSync(PASTA_MIGRACOES).filter((f) => f.endsWith('.sql')).sort()) {
    if (aplicadas.has(nome)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(PASTA_MIGRACOES + nome, 'utf8'));
      db.prepare('INSERT INTO migracoes (nome, aplicada_em) VALUES (?, ?)').run(nome, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

// ---------------------------------------------------------------------------

function pacoteDaLinha(r: Linha): Pacote {
  return {
    id: String(r.id),
    transportadora: String(r.transportadora),
    codigo: String(r.codigo),
    dados: {
      destinatario: String(r.destinatario),
      rua: String(r.rua),
      ruaDetalhe: String(r.rua_detalhe),
      numero: String(r.numero),
      complemento: String(r.complemento),
      bairro: String(r.bairro),
      cidade: String(r.cidade),
      uf: String(r.uf),
      cep: String(r.cep),
    },
    destinoId: str(r.destino_id),
    destinoCandidatos: parse(r.destino_candidatos),
    estado: String(r.estado) as Pacote['estado'],
    responsavelId: str(r.responsavel_id),
    cargaId: str(r.carga_id),
    caixaId: str(r.caixa_id),
    confirmacaoEntrega: r.confirmacao_entrega ? parse(r.confirmacao_entrega) : null,
    motivoInsucesso: str(r.motivo_insucesso),
    retornadoDe: r.retornado_de ? parse(r.retornado_de) : null,
    pendencias: parse(r.pendencias),
    origem: {
      loteId: String(r.origem_lote_id),
      arquivo: String(r.origem_arquivo),
      card: r.origem_card === null ? null : Number(r.origem_card),
    },
    criadoEm: String(r.criado_em),
    atualizadoEm: String(r.atualizado_em),
    versao: Number(r.versao),
  };
}

class Pacotes implements RepositorioPacotes {
  constructor(
    private db: Db,
    private dialeto: Dialeto = 'sqlite',
  ) {}

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM pacotes WHERE id = ?').get(id);
    return r ? pacoteDaLinha(r) : undefined;
  }

  porChave(transportadora: string, codigo: string) {
    const r = this.db.prepare('SELECT * FROM pacotes WHERE transportadora = ? AND codigo = ?').get(transportadora, codigo);
    return r ? pacoteDaLinha(r) : undefined;
  }

  /** Prefixo numérico do número da casa (12A → 12; sem número → 0), igual nos dois motores. */
  private numeroInteiro() {
    return this.dialeto === 'postgres' ? "COALESCE(NULLIF(substring(numero from '^[0-9]+'), '')::bigint, 0)" : 'CAST(numero AS INTEGER)';
  }

  listar(f: FiltroPacotes = {}) {
    const onde: string[] = [];
    const args: (string | number)[] = [];
    if (f.estado) (onde.push('estado = ?'), args.push(f.estado));
    if (f.responsavelId) (onde.push('responsavel_id = ?'), args.push(f.responsavelId));
    if (f.semResponsavel) onde.push('responsavel_id IS NULL');
    if (f.revisaoPendente) onde.push("pendencias <> '[]'");
    if (f.destinoId) (onde.push('destino_id = ?'), args.push(f.destinoId));
    const sql =
      `SELECT * FROM pacotes ${onde.length ? `WHERE ${onde.join(' AND ')}` : ''} ` +
      `ORDER BY lower(rua), ${this.numeroInteiro()}, numero, complemento, codigo`;
    let lista = this.db.prepare(sql).all(...args).map(pacoteDaLinha);
    if (f.busca) {
      // Busca sem acento/maiúscula, em código, destinatário, rua e complemento.
      const alvo = chaveTexto(f.busca);
      lista = lista.filter((p) =>
        [p.codigo, p.dados.destinatario, p.dados.rua, p.dados.complemento, p.dados.numero].some((c) =>
          chaveTexto(c).includes(alvo),
        ),
      );
    }
    return lista;
  }

  salvar(p: Pacote, versaoEsperada: number | null) {
    const valores = [
      p.transportadora, p.codigo, p.dados.destinatario, p.dados.rua, p.dados.ruaDetalhe, p.dados.numero,
      p.dados.complemento, p.dados.bairro, p.dados.cidade, p.dados.uf, p.dados.cep, p.destinoId,
      json(p.destinoCandidatos), p.estado, p.responsavelId, json(p.pendencias), p.origem.loteId,
      p.origem.arquivo, p.origem.card, p.criadoEm, p.atualizadoEm, p.versao, p.cargaId,
      p.confirmacaoEntrega ? json(p.confirmacaoEntrega) : null, p.motivoInsucesso, p.caixaId,
      p.retornadoDe ? json(p.retornadoDe) : null,
    ];
    if (versaoEsperada === null) {
      this.db
        .prepare(
          `INSERT INTO pacotes (transportadora, codigo, destinatario, rua, rua_detalhe, numero, complemento, bairro,
            cidade, uf, cep, destino_id, destino_candidatos, estado, responsavel_id, pendencias, origem_lote_id,
            origem_arquivo, origem_card, criado_em, atualizado_em, versao, carga_id, confirmacao_entrega, motivo_insucesso,
            caixa_id, retornado_de, id)
           VALUES (${new Array(28).fill('?').join(',')})`,
        )
        .run(...valores, p.id);
      return;
    }
    const r = this.db
      .prepare(
        `UPDATE pacotes SET transportadora=?, codigo=?, destinatario=?, rua=?, rua_detalhe=?, numero=?, complemento=?,
          bairro=?, cidade=?, uf=?, cep=?, destino_id=?, destino_candidatos=?, estado=?, responsavel_id=?, pendencias=?,
          origem_lote_id=?, origem_arquivo=?, origem_card=?, criado_em=?, atualizado_em=?, versao=?, carga_id=?,
          confirmacao_entrega=?, motivo_insucesso=?, caixa_id=?, retornado_de=?
         WHERE id=? AND versao=?`,
      )
      .run(...valores, p.id, versaoEsperada);
    if (Number(r.changes) !== 1) throw new Error(`pacote ${p.codigo} foi alterado por outra operação; tente de novo`);
  }
}

function eventoDaLinha(r: Linha): Evento {
  return {
    id: String(r.id),
    pacoteId: String(r.pacote_id),
    tipo: String(r.tipo),
    dados: parse(r.dados),
    ator: String(r.ator),
    origem: String(r.origem),
    ocorridoEm: String(r.ocorrido_em),
    registradoEm: String(r.registrado_em),
    chaveIdempotencia: String(r.chave_idempotencia),
  } as Evento;
}

class Eventos implements RepositorioEventos {
  constructor(private db: Db) {}

  anexar(e: Evento) {
    const existente = this.porChave(e.chaveIdempotencia);
    if (existente) return { gravado: false, evento: existente };
    this.db
      .prepare(
        `INSERT INTO eventos (id, pacote_id, tipo, dados, ator, origem, ocorrido_em, registrado_em, chave_idempotencia)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(e.id, e.pacoteId, e.tipo, json(e.dados), e.ator, e.origem, e.ocorridoEm, e.registradoEm, e.chaveIdempotencia);
    return { gravado: true, evento: e };
  }

  porChave(chave: string) {
    const r = this.db.prepare('SELECT * FROM eventos WHERE chave_idempotencia = ?').get(chave);
    return r ? eventoDaLinha(r) : undefined;
  }

  doPacote(pacoteId: string) {
    return this.db.prepare('SELECT * FROM eventos WHERE pacote_id = ? ORDER BY seq').all(pacoteId).map(eventoDaLinha);
  }
}

function destinoDaLinha(r: Linha): Destino {
  return {
    id: String(r.id),
    ruaNome: String(r.rua_nome),
    ruaChave: String(r.rua_chave),
    numeroNome: String(r.numero_nome),
    numeroChave: String(r.numero_chave),
    contextoChave: String(r.contexto_chave),
    contextoNome: str(r.contexto_nome),
    contextoTipo: str(r.contexto_tipo) as Destino['contextoTipo'],
  };
}

class Destinos implements RepositorioDestinos {
  constructor(private db: Db) {}

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM destinos WHERE id = ?').get(id);
    return r ? destinoDaLinha(r) : undefined;
  }

  noNumero(ruaChave: string, numeroChave: string) {
    return this.db
      .prepare('SELECT * FROM destinos WHERE rua_chave = ? AND numero_chave = ? ORDER BY id')
      .all(ruaChave, numeroChave)
      .map(destinoDaLinha);
  }

  criar(d: Destino, criadoEm: string) {
    this.db
      .prepare(
        `INSERT INTO destinos (id, rua_nome, rua_chave, numero_nome, numero_chave, contexto_chave, contexto_nome, contexto_tipo, criado_em)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(d.id, d.ruaNome, d.ruaChave, d.numeroNome, d.numeroChave, d.contextoChave, d.contextoNome, d.contextoTipo, criadoEm);
  }
}

function loteDaLinha(r: Linha): Lote {
  return {
    id: String(r.id),
    arquivo: String(r.arquivo),
    sha256: String(r.sha256),
    schema: String(r.schema),
    transportadora: String(r.transportadora),
    extractor: { nome: String(r.extractor_nome), versao: String(r.extractor_versao) },
    geradoEm: String(r.gerado_em),
    recebidoEm: String(r.recebido_em),
    status: String(r.status) as StatusLote,
    confirmadoEm: str(r.confirmado_em),
    confirmadoPor: str(r.confirmado_por),
    documento: parse(r.documento),
  };
}

function itemDaLinha(r: Linha): ItemLote {
  return {
    loteId: String(r.lote_id),
    indice: Number(r.indice),
    codigo: String(r.codigo),
    classe: String(r.classe) as ItemLote['classe'],
    dados: parse(r.dados),
    origem: parse(r.origem),
    motivos: parse(r.motivos),
    diferencas: parse(r.diferencas),
    pacoteExistenteId: str(r.pacote_existente_id),
    decisao: str(r.decisao) as ItemLote['decisao'],
    pacoteId: str(r.pacote_id),
  };
}

class Lotes implements RepositorioLotes {
  constructor(private db: Db) {}

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM lotes WHERE id = ?').get(id);
    return r ? loteDaLinha(r) : undefined;
  }

  porSha256(sha: string) {
    const r = this.db
      .prepare("SELECT * FROM lotes WHERE sha256 = ? ORDER BY (status = 'DESCARTADO'), recebido_em DESC LIMIT 1")
      .get(sha);
    return r ? loteDaLinha(r) : undefined;
  }

  listar() {
    return this.db.prepare('SELECT * FROM lotes ORDER BY recebido_em DESC').all().map(loteDaLinha);
  }

  criar(l: Lote, itens: ItemLote[]) {
    this.db
      .prepare(
        `INSERT INTO lotes (id, arquivo, sha256, schema, transportadora, extractor_nome, extractor_versao, gerado_em,
          recebido_em, status, confirmado_em, confirmado_por, documento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        l.id, l.arquivo, l.sha256, l.schema, l.transportadora, l.extractor.nome, l.extractor.versao, l.geradoEm,
        l.recebidoEm, l.status, l.confirmadoEm, l.confirmadoPor, json(l.documento),
      );
    for (const i of itens) this.atualizarItem(i);
  }

  itens(loteId: string) {
    return this.db.prepare('SELECT * FROM itens_lote WHERE lote_id = ? ORDER BY indice').all(loteId).map(itemDaLinha);
  }

  atualizarItem(i: ItemLote) {
    this.db
      .prepare(
        `INSERT INTO itens_lote (lote_id, indice, codigo, classe, dados, origem, motivos, diferencas, pacote_existente_id, decisao, pacote_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT (lote_id, indice) DO UPDATE SET codigo=excluded.codigo, classe=excluded.classe, dados=excluded.dados,
           origem=excluded.origem, motivos=excluded.motivos, diferencas=excluded.diferencas,
           pacote_existente_id=excluded.pacote_existente_id, decisao=excluded.decisao, pacote_id=excluded.pacote_id`,
      )
      .run(
        i.loteId, i.indice, i.codigo, i.classe, json(i.dados), json(i.origem), json(i.motivos), json(i.diferencas),
        i.pacoteExistenteId, i.decisao, i.pacoteId,
      );
  }

  atualizarStatus(id: string, status: StatusLote, confirmadoEm: string | null, confirmadoPor: string | null) {
    this.db.prepare('UPDATE lotes SET status=?, confirmado_em=?, confirmado_por=? WHERE id=?').run(status, confirmadoEm, confirmadoPor, id);
  }
}

class Ajudantes implements RepositorioAjudantes {
  constructor(private db: Db) {}

  private linha = (r: Linha): Ajudante => ({
    id: String(r.id),
    nome: String(r.nome),
    ativo: Number(r.ativo) === 1,
    criadoEm: String(r.criado_em),
    veiculo: str(r.veiculo),
    streetVistoEm: str(r.street_visto_em),
  });

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM ajudantes WHERE id = ?').get(id);
    return r ? this.linha(r) : undefined;
  }

  listar() {
    return this.db.prepare('SELECT * FROM ajudantes ORDER BY lower(nome)').all().map(this.linha);
  }

  criar(a: Ajudante) {
    this.db
      .prepare('INSERT INTO ajudantes (id, nome, ativo, criado_em, veiculo) VALUES (?,?,?,?,?)')
      .run(a.id, a.nome, a.ativo ? 1 : 0, a.criadoEm, a.veiculo);
  }

  atualizar(a: Ajudante) {
    this.db
      .prepare('UPDATE ajudantes SET nome = ?, ativo = ?, veiculo = ? WHERE id = ?')
      .run(a.nome, a.ativo ? 1 : 0, a.veiculo, a.id);
  }

  marcarStreetVisto(id: string, em: string) {
    this.db.prepare('UPDATE ajudantes SET street_visto_em = ? WHERE id = ?').run(em, id);
  }
}

class Dias implements RepositorioDias {
  constructor(private db: Db) {}

  private linha = (r: Linha): Dia => ({
    id: String(r.id),
    dataRef: String(r.data_ref),
    encerradoEm: String(r.encerrado_em),
    encerradoPor: String(r.encerrado_por),
    historico: Number(r.historico) === 1,
    resumo: parse(r.resumo),
    chave: String(r.chave_idempotencia),
  });

  criar(d: Dia) {
    this.db
      .prepare('INSERT INTO dias (id, data_ref, encerrado_em, encerrado_por, historico, resumo, chave_idempotencia) VALUES (?,?,?,?,?,?,?)')
      .run(d.id, d.dataRef, d.encerradoEm, d.encerradoPor, d.historico ? 1 : 0, json(d.resumo), d.chave);
  }
  listar() {
    return this.db.prepare('SELECT * FROM dias ORDER BY encerrado_em DESC, id').all().map(this.linha);
  }
  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM dias WHERE id = ?').get(id);
    return r ? this.linha(r) : undefined;
  }
  porChave(chave: string) {
    const r = this.db.prepare('SELECT * FROM dias WHERE chave_idempotencia = ?').get(chave);
    return r ? this.linha(r) : undefined;
  }
}

class Contas implements RepositorioContas {
  constructor(private db: Db) {}

  private linha = (r: Linha): Conta => ({
    id: String(r.id),
    usuario: String(r.usuario),
    nome: String(r.nome),
    telefone: str(r.telefone),
    veiculo: str(r.veiculo),
    pinHash: str(r.pin_hash),
    situacao: String(r.situacao) as Conta['situacao'],
    papel: str(r.papel) as Conta['papel'],
    master: Number(r.master) === 1,
    ajudanteId: str(r.ajudante_id),
    ativacaoHash: str(r.ativacao_hash),
    ativacaoExpiraEm: str(r.ativacao_expira_em),
    tentativas: Number(r.tentativas),
    bloqueadaAte: str(r.bloqueada_ate),
    criadaEm: String(r.criada_em),
    decididaEm: str(r.decidida_em),
    decididaPor: str(r.decidida_por),
  });

  private sessao = (r: Linha): Sessao => ({
    tokenHash: String(r.token_hash),
    renovarHash: String(r.renovar_hash),
    contaId: String(r.conta_id),
    criadaEm: String(r.criada_em),
    expiraEm: String(r.expira_em),
    renovarExpiraEm: String(r.renovar_expira_em),
    revogadaEm: str(r.revogada_em),
  });

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM contas WHERE id = ?').get(id);
    return r ? this.linha(r) : undefined;
  }
  porUsuario(usuario: string) {
    const r = this.db.prepare('SELECT * FROM contas WHERE usuario = ?').get(usuario);
    return r ? this.linha(r) : undefined;
  }
  porAjudante(ajudanteId: string) {
    const r = this.db.prepare('SELECT * FROM contas WHERE ajudante_id = ?').get(ajudanteId);
    return r ? this.linha(r) : undefined;
  }
  listar() {
    return this.db
      .prepare("SELECT * FROM contas ORDER BY (situacao = 'PENDENTE') DESC, criada_em DESC, id")
      .all()
      .map(this.linha);
  }
  criar(c: Conta) {
    this.db
      .prepare(
        `INSERT INTO contas (id, usuario, nome, telefone, veiculo, pin_hash, situacao, papel, master, ajudante_id,
           ativacao_hash, ativacao_expira_em, tentativas, bloqueada_ate, criada_em, decidida_em, decidida_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        c.id, c.usuario, c.nome, c.telefone, c.veiculo, c.pinHash, c.situacao, c.papel, c.master ? 1 : 0, c.ajudanteId,
        c.ativacaoHash, c.ativacaoExpiraEm, c.tentativas, c.bloqueadaAte, c.criadaEm, c.decididaEm, c.decididaPor,
      );
  }
  atualizar(c: Conta) {
    this.db
      .prepare(
        `UPDATE contas SET nome=?, telefone=?, veiculo=?, pin_hash=?, situacao=?, papel=?, master=?, ajudante_id=?,
           ativacao_hash=?, ativacao_expira_em=?, tentativas=?, bloqueada_ate=?, decidida_em=?, decidida_por=?
         WHERE id=?`,
      )
      .run(
        c.nome, c.telefone, c.veiculo, c.pinHash, c.situacao, c.papel, c.master ? 1 : 0, c.ajudanteId,
        c.ativacaoHash, c.ativacaoExpiraEm, c.tentativas, c.bloqueadaAte, c.decididaEm, c.decididaPor, c.id,
      );
  }
  criarSessao(s: Sessao) {
    this.db
      .prepare('INSERT INTO sessoes (token_hash, renovar_hash, conta_id, criada_em, expira_em, renovar_expira_em, revogada_em) VALUES (?,?,?,?,?,?,?)')
      .run(s.tokenHash, s.renovarHash, s.contaId, s.criadaEm, s.expiraEm, s.renovarExpiraEm, s.revogadaEm);
  }
  sessaoPorToken(tokenHash: string) {
    const r = this.db.prepare('SELECT * FROM sessoes WHERE token_hash = ?').get(tokenHash);
    return r ? this.sessao(r) : undefined;
  }
  sessaoPorRenovar(renovarHash: string) {
    const r = this.db.prepare('SELECT * FROM sessoes WHERE renovar_hash = ?').get(renovarHash);
    return r ? this.sessao(r) : undefined;
  }
  revogarSessao(tokenHash: string, em: string) {
    this.db.prepare('UPDATE sessoes SET revogada_em = ? WHERE token_hash = ? AND revogada_em IS NULL').run(em, tokenHash);
  }
  revogarSessoesDaConta(contaId: string, em: string) {
    this.db.prepare('UPDATE sessoes SET revogada_em = ? WHERE conta_id = ? AND revogada_em IS NULL').run(em, contaId);
  }
  anexarHistorico(e: EventoConta) {
    this.db
      .prepare('INSERT INTO contas_historico (id, conta_id, tipo, dados, ator, ocorrido_em) VALUES (?,?,?,?,?,?)')
      .run(e.id, e.contaId, e.tipo, json(e.dados), e.ator, e.ocorridoEm);
  }
  historico(contaId: string) {
    return this.db
      .prepare('SELECT * FROM contas_historico WHERE conta_id = ? ORDER BY seq')
      .all(contaId)
      .map((r) => ({ id: String(r.id), contaId: String(r.conta_id), tipo: String(r.tipo) as EventoConta['tipo'], dados: parse<Record<string, unknown>>(r.dados), ator: String(r.ator), ocorridoEm: String(r.ocorrido_em) }));
  }
}

class Cargas implements RepositorioCargas {
  constructor(private db: Db) {}

  private montar = (r: Linha): Carga => ({
    id: String(r.id),
    codigo: String(r.codigo),
    ajudante: { id: String(r.ajudante_id), nome: String(r.ajudante_nome) },
    pacoteIds: this.db
      .prepare('SELECT pacote_id FROM cargas_pacotes WHERE carga_id = ? ORDER BY ordem')
      .all(String(r.id))
      .map((x) => String(x.pacote_id)),
    criadaEm: String(r.criada_em),
    criadaPor: String(r.criada_por),
    rotaIniciadaEm: str(r.rota_iniciada_em),
    rotaIniciadaPor: str(r.rota_iniciada_por),
    finalizadaEm: str(r.finalizada_em),
    finalizadaPor: str(r.finalizada_por),
  });

  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM cargas WHERE id = ?').get(id);
    return r ? this.montar(r) : undefined;
  }

  listar() {
    return this.db.prepare('SELECT * FROM cargas ORDER BY criada_em DESC, codigo DESC').all().map(this.montar);
  }

  contarPorPrefixo(prefixo: string) {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM cargas WHERE codigo LIKE ?').get(`${prefixo}%`);
    return Number(r?.n ?? 0);
  }

  criar(c: Carga) {
    this.db
      .prepare('INSERT INTO cargas (id, codigo, ajudante_id, ajudante_nome, criada_em, criada_por) VALUES (?,?,?,?,?,?)')
      .run(c.id, c.codigo, c.ajudante.id, c.ajudante.nome, c.criadaEm, c.criadaPor);
    const ins = this.db.prepare('INSERT INTO cargas_pacotes (carga_id, pacote_id, ordem) VALUES (?,?,?)');
    c.pacoteIds.forEach((p, i) => ins.run(c.id, p, i));
  }

  marcarRotaIniciada(id: string, em: string, por: string) {
    this.db.prepare('UPDATE cargas SET rota_iniciada_em = ?, rota_iniciada_por = ? WHERE id = ? AND rota_iniciada_em IS NULL').run(em, por, id);
  }

  marcarFinalizada(id: string, em: string, por: string) {
    this.db.prepare('UPDATE cargas SET finalizada_em = ?, finalizada_por = ? WHERE id = ? AND finalizada_em IS NULL').run(em, por, id);
  }

  ativaDoAjudante(ajudanteId: string) {
    const r = this.db
      .prepare('SELECT * FROM cargas WHERE ajudante_id = ? AND finalizada_em IS NULL ORDER BY criada_em DESC LIMIT 1')
      .get(ajudanteId);
    return r ? this.montar(r) : undefined;
  }

  idsAtivas() {
    return new Set(this.db.prepare('SELECT id FROM cargas WHERE finalizada_em IS NULL').all().map((r) => String(r.id)));
  }

  adicionarPacotes(cargaId: string, pacoteIds: string[]) {
    const r = this.db.prepare('SELECT COALESCE(MAX(ordem), -1) AS m FROM cargas_pacotes WHERE carga_id = ?').get(cargaId);
    let ordem = Number(r?.m ?? -1) + 1;
    const ins = this.db.prepare('INSERT INTO cargas_pacotes (carga_id, pacote_id, ordem) VALUES (?,?,?) ON CONFLICT DO NOTHING');
    for (const p of pacoteIds) ins.run(cargaId, p, ordem++);
  }

  /** Composição atual da carga (o histórico da mudança fica nos eventos RUA_REMOVIDA/RETIRADO_DA_CARGA). */
  removerPacotes(cargaId: string, pacoteIds: string[]) {
    const del = this.db.prepare('DELETE FROM cargas_pacotes WHERE carga_id = ? AND pacote_id = ?');
    for (const p of pacoteIds) del.run(cargaId, p);
  }

  anexarEvento(e: EventoCarga) {
    this.db
      .prepare('INSERT INTO eventos_carga (id, carga_id, tipo, dados, ator, ocorrido_em, registrado_em) VALUES (?,?,?,?,?,?,?)')
      .run(e.id, e.cargaId, e.tipo, json(e.dados), e.ator, e.ocorridoEm, e.registradoEm);
  }

  eventos(cargaId: string) {
    return this.db
      .prepare('SELECT * FROM eventos_carga WHERE carga_id = ? ORDER BY seq')
      .all(cargaId)
      .map(
        (r) =>
          ({
            id: String(r.id),
            cargaId: String(r.carga_id),
            tipo: String(r.tipo),
            dados: parse(r.dados),
            ator: String(r.ator),
            ocorridoEm: String(r.ocorrido_em),
            registradoEm: String(r.registrado_em),
          }) as EventoCarga,
      );
  }
}

class Regioes implements RepositorioRegioes {
  constructor(private db: Db) {}

  private regiao = (r: Linha): Regiao => ({
    id: String(r.id), nome: String(r.nome), criadaEm: String(r.criada_em), criadaPor: String(r.criada_por),
    repasseUnico: Number(r.repasse_unico ?? 0) === 1,
    numero: str(r.numero),
    ordem: r.ordem === null || r.ordem === undefined ? null : Number(r.ordem),
    paiId: str(r.pai_id),
    responsavel: str(r.responsavel),
  });
  private assoc = (r: Linha): Associacao => ({
    ruaChave: String(r.rua_chave), ruaNome: String(r.rua_nome), regiaoId: str(r.regiao_id),
    prioridade: r.prioridade === null || r.prioridade === undefined ? null : Number(r.prioridade),
    definidaEm: String(r.definida_em), definidaPor: String(r.definida_por),
  });

  listar() {
    return this.db
      .prepare('SELECT * FROM regioes ORDER BY ordem IS NULL, ordem, lower(nome)')
      .all()
      .map(this.regiao);
  }
  porId(id: string) {
    const r = this.db.prepare('SELECT * FROM regioes WHERE id = ?').get(id);
    return r ? this.regiao(r) : undefined;
  }
  porNome(nome: string) {
    const r = this.db.prepare('SELECT * FROM regioes WHERE lower(nome) = lower(?)').get(nome);
    return r ? this.regiao(r) : undefined;
  }
  criar(r: Regiao) {
    this.db
      .prepare('INSERT INTO regioes (id, nome, criada_em, criada_por, repasse_unico, numero, ordem, pai_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(r.id, r.nome, r.criadaEm, r.criadaPor, r.repasseUnico ? 1 : 0, r.numero, r.ordem, r.paiId);
  }
  configurarCaixa(id: string, c: { nome: string; numero: string | null; ordem: number | null; paiId: string | null; repasseUnico: boolean }) {
    this.db
      .prepare('UPDATE regioes SET nome=?, numero=?, ordem=?, pai_id=?, repasse_unico=? WHERE id=?')
      .run(c.nome, c.numero, c.ordem, c.paiId, c.repasseUnico ? 1 : 0, id);
  }
  definirResponsavel(id: string, responsavel: string | null) {
    this.db.prepare('UPDATE regioes SET responsavel = ? WHERE id = ?').run(responsavel, id);
  }
  associacoes() {
    return new Map(this.db.prepare('SELECT * FROM regioes_ruas').all().map((r) => [String(r.rua_chave), this.assoc(r)] as const));
  }
  associacao(ruaChave: string) {
    const r = this.db.prepare('SELECT * FROM regioes_ruas WHERE rua_chave = ?').get(ruaChave);
    return r ? this.assoc(r) : undefined;
  }
  definir(a: Associacao) {
    this.db
      .prepare(
        `INSERT INTO regioes_ruas (rua_chave, rua_nome, regiao_id, definida_em, definida_por, prioridade) VALUES (?,?,?,?,?,?)
         ON CONFLICT (rua_chave) DO UPDATE SET rua_nome=excluded.rua_nome, regiao_id=excluded.regiao_id,
           definida_em=excluded.definida_em, definida_por=excluded.definida_por, prioridade=excluded.prioridade`,
      )
      .run(a.ruaChave, a.ruaNome, a.regiaoId, a.definidaEm, a.definidaPor, a.prioridade);
  }
  anexarEvento(e: EventoRegiao) {
    this.db
      .prepare('INSERT INTO eventos_regiao (id, rua_chave, tipo, dados, ator, ocorrido_em) VALUES (?,?,?,?,?,?)')
      .run(e.id, e.ruaChave, e.tipo, json(e.dados), e.ator, e.ocorridoEm);
  }
  eventos(ruaChave: string) {
    return this.db
      .prepare('SELECT * FROM eventos_regiao WHERE rua_chave = ? ORDER BY seq')
      .all(ruaChave)
      .map((r) => ({
        id: String(r.id), ruaChave: String(r.rua_chave), tipo: String(r.tipo),
        dados: parse(r.dados), ator: String(r.ator), ocorridoEm: String(r.ocorrido_em),
      }) as EventoRegiao);
  }
}

class Pessoas implements RepositorioPessoas {
  constructor(private db: Db) {}

  private linha = (r: Linha): MemoriaPessoa => ({
    chave: String(r.chave), nome: String(r.nome), ruaId: String(r.rua_id), ruaNome: String(r.rua_nome), cep: String(r.cep),
    caixaId: String(r.caixa_id), definidaEm: String(r.definida_em), definidaPor: String(r.definida_por),
  });

  todas() {
    return new Map(this.db.prepare('SELECT * FROM memoria_pessoas').all().map((r) => [String(r.chave), this.linha(r)] as const));
  }
  porChave(chave: string) {
    const r = this.db.prepare('SELECT * FROM memoria_pessoas WHERE chave = ?').get(chave);
    return r ? this.linha(r) : undefined;
  }
  definir(m: MemoriaPessoa) {
    this.db
      .prepare(
        `INSERT INTO memoria_pessoas (chave, nome, rua_id, rua_nome, cep, caixa_id, definida_em, definida_por) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT (chave) DO UPDATE SET nome=excluded.nome, rua_nome=excluded.rua_nome, cep=excluded.cep,
           caixa_id=excluded.caixa_id, definida_em=excluded.definida_em, definida_por=excluded.definida_por`,
      )
      .run(m.chave, m.nome, m.ruaId, m.ruaNome, m.cep, m.caixaId, m.definidaEm, m.definidaPor);
  }
  anexarEvento(e: EventoPessoa) {
    this.db
      .prepare('INSERT INTO eventos_pessoa (id, chave, tipo, dados, ator, ocorrido_em) VALUES (?,?,?,?,?,?)')
      .run(e.id, e.chave, e.tipo, json(e.dados), e.ator, e.ocorridoEm);
  }
  eventos(chave: string) {
    return this.db
      .prepare('SELECT * FROM eventos_pessoa WHERE chave = ? ORDER BY seq')
      .all(chave)
      .map((r) => ({ id: String(r.id), chave: String(r.chave), tipo: 'PESSOA_NA_CAIXA' as const, dados: parse(r.dados), ator: String(r.ator), ocorridoEm: String(r.ocorrido_em) }) as EventoPessoa);
  }
}

export function criarArmazemSqlite(db: Db, dialeto: Dialeto = 'sqlite'): Armazem {
  let profundidade = 0;
  return {
    pacotes: new Pacotes(db, dialeto),
    eventos: new Eventos(db),
    destinos: new Destinos(db),
    lotes: new Lotes(db),
    ajudantes: new Ajudantes(db),
    cargas: new Cargas(db),
    regioes: new Regioes(db),
    pessoas: new Pessoas(db),
    dias: new Dias(db),
    contas: new Contas(db),
    transacao<T>(fn: () => T): T {
      if (profundidade > 0) return fn(); // já dentro de uma transação
      if (dialeto === 'postgres') {
        // Um escritor por vez no banco inteiro (o que o BEGIN IMMEDIATE do SQLite já garante): o HUB pode ter mais de
        // uma instância na Vercel, e o "projete e grave" de cada operação não pode se misturar com a de outra.
        db.exec('BEGIN');
        db.exec('SELECT pg_advisory_xact_lock(7300001)');
      } else {
        db.exec('BEGIN IMMEDIATE');
      }
      profundidade++;
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        profundidade--;
      }
    },
  };
}
